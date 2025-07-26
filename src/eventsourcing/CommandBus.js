/**
 * CQRS Command Bus Implementation
 * Handles command routing, validation, and execution with middleware support
 * Features: Command validation, authorization, audit logging, retry policies
 */
const { EventEmitter } = require('events');

class CommandBus extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.options = {
            maxRetries: options.maxRetries || 3,
            retryDelay: options.retryDelay || 1000,
            commandTimeout: options.commandTimeout || 30000,
            auditEnabled: options.auditEnabled !== false,
            ...options
        };
        
        // Command handlers registry
        this.handlers = new Map(); // commandType -> handler
        
        // Middleware pipeline
        this.middleware = [];
        
        // Command validation
        this.validators = new Map(); // commandType -> validator
        
        // Authorization policies
        this.authorizationPolicies = new Map(); // commandType -> policy
        
        // Retry policies
        this.retryPolicies = new Map(); // commandType -> retryPolicy
        
        // Command execution tracking
        this.executingCommands = new Map(); // commandId -> execution context
        
        // Audit log
        this.auditLog = [];
        this.maxAuditEntries = 10000;
        
        // Performance metrics
        this.metrics = {
            commandsExecuted: 0,
            commandsFailed: 0,
            commandsRetried: 0,
            averageExecutionTime: 0,
            totalExecutionTime: 0,
            handlerCounts: new Map()
        };
        
        // Circuit breaker for command types
        this.circuitBreakers = new Map();
        
        this.initialize();
    }

    /**
     * Initialize command bus
     */
    initialize() {
        // Setup default middleware
        this.use(this.createAuditMiddleware());
        this.use(this.createValidationMiddleware());
        this.use(this.createAuthorizationMiddleware());
        this.use(this.createRetryMiddleware());
        
        this.emit('initialized');
    }

    /**
     * Register command handler
     * @param {string} commandType - Command type
     * @param {Function} handler - Command handler function
     * @param {Object} options - Handler options
     */
    registerHandler(commandType, handler, options = {}) {
        if (this.handlers.has(commandType)) {
            throw new Error(`Handler already registered for command type: ${commandType}`);
        }
        
        this.handlers.set(commandType, {
            handler,
            options: {
                timeout: options.timeout || this.options.commandTimeout,
                retries: options.retries || this.options.maxRetries,
                ...options
            }
        });
        
        // Initialize metrics for this handler
        this.metrics.handlerCounts.set(commandType, 0);
        
        this.emit('handler-registered', { commandType });
    }

    /**
     * Register command validator
     * @param {string} commandType - Command type
     * @param {Function} validator - Validation function
     */
    registerValidator(commandType, validator) {
        this.validators.set(commandType, validator);
    }

    /**
     * Register authorization policy
     * @param {string} commandType - Command type
     * @param {Function} policy - Authorization policy function
     */
    registerAuthorizationPolicy(commandType, policy) {
        this.authorizationPolicies.set(commandType, policy);
    }

    /**
     * Register retry policy
     * @param {string} commandType - Command type
     * @param {Object} policy - Retry policy configuration
     */
    registerRetryPolicy(commandType, policy) {
        this.retryPolicies.set(commandType, policy);
    }

    /**
     * Add middleware to pipeline
     * @param {Function} middleware - Middleware function
     */
    use(middleware) {
        if (typeof middleware !== 'function') {
            throw new Error('Middleware must be a function');
        }
        
        this.middleware.push(middleware);
    }

    /**
     * Execute command through the bus
     * @param {Object} command - Command to execute
     * @param {Object} context - Execution context
     * @returns {Promise<*>} Command result
     */
    async execute(command, context = {}) {
        const commandId = this.generateCommandId();
        const startTime = process.hrtime.bigint();
        
        // Create execution context
        const executionContext = {
            commandId,
            command,
            context,
            startTime,
            attempts: 0,
            errors: [],
            metadata: {
                userId: context.userId,
                correlationId: context.correlationId || commandId,
                causationId: context.causationId,
                timestamp: Date.now()
            }
        };
        
        this.executingCommands.set(commandId, executionContext);
        
        try {
            // Execute through middleware pipeline
            const result = await this.executeWithMiddleware(executionContext);
            
            // Update metrics
            this.updateSuccessMetrics(command.type, startTime);
            
            // Emit success event
            this.emit('command-executed', {
                commandId,
                commandType: command.type,
                result,
                executionTime: Number(process.hrtime.bigint() - startTime) / 1000000
            });
            
            return result;
            
        } catch (error) {
            // Update error metrics
            this.updateErrorMetrics(command.type, error);
            
            // Emit error event
            this.emit('command-failed', {
                commandId,
                commandType: command.type,
                error: error.message,
                attempts: executionContext.attempts
            });
            
            throw error;
            
        } finally {
            this.executingCommands.delete(commandId);
        }
    }

    /**
     * Execute command through middleware pipeline
     * @param {Object} executionContext - Execution context
     * @returns {Promise<*>} Command result
     */
    async executeWithMiddleware(executionContext) {
        let index = 0;
        
        const next = async () => {
            if (index >= this.middleware.length) {
                // Execute the actual command handler
                return await this.executeHandler(executionContext);
            }
            
            const middleware = this.middleware[index++];
            return await middleware(executionContext, next);
        };
        
        return await next();
    }

    /**
     * Execute command handler
     * @param {Object} executionContext - Execution context
     * @returns {Promise<*>} Command result
     */
    async executeHandler(executionContext) {
        const { command } = executionContext;
        const handlerConfig = this.handlers.get(command.type);
        
        if (!handlerConfig) {
            throw new CommandHandlerNotFoundError(`No handler registered for command type: ${command.type}`);
        }
        
        const { handler, options } = handlerConfig;
        
        // Execute with timeout
        return await this.executeWithTimeout(
            () => handler(command, executionContext.context),
            options.timeout
        );
    }

    /**
     * Execute function with timeout
     * @param {Function} fn - Function to execute
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise<*>} Function result
     */
    async executeWithTimeout(fn, timeout) {
        return new Promise(async (resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                reject(new CommandTimeoutError(`Command execution timed out after ${timeout}ms`));
            }, timeout);
            
            try {
                const result = await fn();
                clearTimeout(timeoutHandle);
                resolve(result);
            } catch (error) {
                clearTimeout(timeoutHandle);
                reject(error);
            }
        });
    }

    /**
     * Create audit middleware
     * @returns {Function} Audit middleware
     */
    createAuditMiddleware() {
        return async (executionContext, next) => {
            if (!this.options.auditEnabled) {
                return await next();
            }
            
            const { commandId, command, metadata } = executionContext;
            
            // Log command start
            this.addAuditEntry({
                type: 'command-started',
                commandId,
                commandType: command.type,
                userId: metadata.userId,
                correlationId: metadata.correlationId,
                timestamp: Date.now(),
                command: this.sanitizeForAudit(command)
            });
            
            try {
                const result = await next();
                
                // Log command success
                this.addAuditEntry({
                    type: 'command-completed',
                    commandId,
                    commandType: command.type,
                    userId: metadata.userId,
                    correlationId: metadata.correlationId,
                    timestamp: Date.now(),
                    success: true
                });
                
                return result;
                
            } catch (error) {
                // Log command failure
                this.addAuditEntry({
                    type: 'command-failed',
                    commandId,
                    commandType: command.type,
                    userId: metadata.userId,
                    correlationId: metadata.correlationId,
                    timestamp: Date.now(),
                    success: false,
                    error: error.message
                });
                
                throw error;
            }
        };
    }

    /**
     * Create validation middleware
     * @returns {Function} Validation middleware
     */
    createValidationMiddleware() {
        return async (executionContext, next) => {
            const { command } = executionContext;
            const validator = this.validators.get(command.type);
            
            if (validator) {
                const validationResult = await validator(command);
                
                if (validationResult !== true) {
                    const errors = Array.isArray(validationResult) ? validationResult : [validationResult];
                    throw new CommandValidationError('Command validation failed', errors);
                }
            }
            
            return await next();
        };
    }

    /**
     * Create authorization middleware
     * @returns {Function} Authorization middleware
     */
    createAuthorizationMiddleware() {
        return async (executionContext, next) => {
            const { command, context } = executionContext;
            const policy = this.authorizationPolicies.get(command.type);
            
            if (policy) {
                const authorized = await policy(command, context);
                
                if (!authorized) {
                    throw new CommandAuthorizationError(`User not authorized to execute command: ${command.type}`);
                }
            }
            
            return await next();
        };
    }

    /**
     * Create retry middleware
     * @returns {Function} Retry middleware
     */
    createRetryMiddleware() {
        return async (executionContext, next) => {
            const { command } = executionContext;
            const retryPolicy = this.retryPolicies.get(command.type) || {
                maxRetries: this.options.maxRetries,
                delay: this.options.retryDelay,
                backoff: 'exponential'
            };
            
            let lastError;
            
            for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt++) {
                executionContext.attempts = attempt + 1;
                
                try {
                    return await next();
                } catch (error) {
                    lastError = error;
                    executionContext.errors.push(error);
                    
                    // Don't retry on certain error types
                    if (this.isNonRetryableError(error) || attempt === retryPolicy.maxRetries) {
                        break;
                    }
                    
                    // Calculate delay
                    const delay = this.calculateRetryDelay(retryPolicy, attempt);
                    await this.sleep(delay);
                    
                    this.metrics.commandsRetried++;
                }
            }
            
            throw lastError;
        };
    }

    /**
     * Check if error is non-retryable
     * @param {Error} error - Error to check
     * @returns {boolean} Is non-retryable
     */
    isNonRetryableError(error) {
        return error instanceof CommandValidationError ||
               error instanceof CommandAuthorizationError ||
               error instanceof CommandHandlerNotFoundError;
    }

    /**
     * Calculate retry delay
     * @param {Object} retryPolicy - Retry policy
     * @param {number} attempt - Attempt number
     * @returns {number} Delay in milliseconds
     */
    calculateRetryDelay(retryPolicy, attempt) {
        const baseDelay = retryPolicy.delay;
        
        switch (retryPolicy.backoff) {
            case 'exponential':
                return baseDelay * Math.pow(2, attempt);
            case 'linear':
                return baseDelay * (attempt + 1);
            case 'fixed':
            default:
                return baseDelay;
        }
    }

    /**
     * Sleep for specified duration
     * @param {number} ms - Milliseconds to sleep
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Add entry to audit log
     * @param {Object} entry - Audit entry
     */
    addAuditEntry(entry) {
        this.auditLog.push(entry);
        
        // Trim audit log if too large
        if (this.auditLog.length > this.maxAuditEntries) {
            this.auditLog.splice(0, this.auditLog.length - this.maxAuditEntries);
        }
    }

    /**
     * Sanitize command for audit logging
     * @param {Object} command - Command to sanitize
     * @returns {Object} Sanitized command
     */
    sanitizeForAudit(command) {
        // Remove sensitive fields
        const sanitized = { ...command };
        const sensitiveFields = ['password', 'token', 'secret', 'key'];
        
        for (const field of sensitiveFields) {
            if (sanitized[field]) {
                sanitized[field] = '[REDACTED]';
            }
        }
        
        return sanitized;
    }

    /**
     * Update success metrics
     * @param {string} commandType - Command type
     * @param {bigint} startTime - Start time
     */
    updateSuccessMetrics(commandType, startTime) {
        this.metrics.commandsExecuted++;
        
        const executionTime = Number(process.hrtime.bigint() - startTime) / 1000000;
        this.metrics.totalExecutionTime += executionTime;
        this.metrics.averageExecutionTime = this.metrics.totalExecutionTime / this.metrics.commandsExecuted;
        
        const handlerCount = this.metrics.handlerCounts.get(commandType) || 0;
        this.metrics.handlerCounts.set(commandType, handlerCount + 1);
    }

    /**
     * Update error metrics
     * @param {string} commandType - Command type
     * @param {Error} error - Error that occurred
     */
    updateErrorMetrics(commandType, error) {
        this.metrics.commandsFailed++;
    }

    /**
     * Generate unique command ID
     * @returns {string} Command ID
     */
    generateCommandId() {
        const crypto = require('crypto');
        return `cmd_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * Get command bus metrics
     * @returns {Object} Metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            handlerCounts: Object.fromEntries(this.metrics.handlerCounts),
            registeredHandlers: this.handlers.size,
            middlewareCount: this.middleware.length,
            executingCommands: this.executingCommands.size,
            auditLogSize: this.auditLog.length,
            successRate: this.metrics.commandsExecuted > 0 
                ? ((this.metrics.commandsExecuted / (this.metrics.commandsExecuted + this.metrics.commandsFailed)) * 100).toFixed(2) + '%'
                : '0%'
        };
    }

    /**
     * Get audit log entries
     * @param {Object} filters - Filter criteria
     * @returns {Array} Audit entries
     */
    getAuditLog(filters = {}) {
        let entries = [...this.auditLog];
        
        if (filters.commandType) {
            entries = entries.filter(entry => entry.commandType === filters.commandType);
        }
        
        if (filters.userId) {
            entries = entries.filter(entry => entry.userId === filters.userId);
        }
        
        if (filters.fromTimestamp) {
            entries = entries.filter(entry => entry.timestamp >= filters.fromTimestamp);
        }
        
        if (filters.toTimestamp) {
            entries = entries.filter(entry => entry.timestamp <= filters.toTimestamp);
        }
        
        return entries.slice(-1000); // Return last 1000 entries
    }

    /**
     * Get executing commands
     * @returns {Array} Currently executing commands
     */
    getExecutingCommands() {
        return Array.from(this.executingCommands.values()).map(context => ({
            commandId: context.commandId,
            commandType: context.command.type,
            attempts: context.attempts,
            startTime: context.startTime,
            duration: Number(process.hrtime.bigint() - context.startTime) / 1000000
        }));
    }

    /**
     * Shutdown command bus
     */
    async shutdown() {
        // Wait for executing commands to complete
        const maxWaitTime = 30000; // 30 seconds
        const startTime = Date.now();
        
        while (this.executingCommands.size > 0 && (Date.now() - startTime) < maxWaitTime) {
            await this.sleep(100);
        }
        
        // Force stop remaining commands
        this.executingCommands.clear();
        
        this.emit('shutdown');
    }
}

// Custom error classes
class CommandHandlerNotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CommandHandlerNotFoundError';
    }
}

class CommandValidationError extends Error {
    constructor(message, errors = []) {
        super(message);
        this.name = 'CommandValidationError';
        this.errors = errors;
    }
}

class CommandAuthorizationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CommandAuthorizationError';
    }
}

class CommandTimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CommandTimeoutError';
    }
}

module.exports = {
    CommandBus,
    CommandHandlerNotFoundError,
    CommandValidationError,
    CommandAuthorizationError,
    CommandTimeoutError
};
