/**
 * Saga Orchestration Engine
 * Manages long-running business processes with compensation and error handling
 * Features: State persistence, timeout handling, compensation actions, parallel execution
 */
const { EventEmitter } = require('events');

class SagaOrchestrator extends EventEmitter {
    constructor(eventStore, commandBus, options = {}) {
        super();
        
        this.eventStore = eventStore;
        this.commandBus = commandBus;
        
        this.options = {
            maxRetries: options.maxRetries || 3,
            defaultTimeout: options.defaultTimeout || 300000, // 5 minutes
            compensationTimeout: options.compensationTimeout || 60000, // 1 minute
            persistenceEnabled: options.persistenceEnabled !== false,
            ...options
        };
        
        // Saga definitions registry
        this.sagaDefinitions = new Map(); // sagaType -> definition
        
        // Active saga instances
        this.activeSagas = new Map(); // sagaId -> sagaInstance
        
        // Saga state persistence
        this.sagaStates = new Map(); // sagaId -> persistedState
        
        // Event subscriptions for saga triggers
        this.eventSubscriptions = new Map(); // eventType -> Set<sagaType>
        
        // Timeout management
        this.timeouts = new Map(); // sagaId -> timeoutHandle
        
        // Compensation tracking
        this.compensations = new Map(); // sagaId -> compensationActions[]
        
        // Performance metrics
        this.metrics = {
            sagasStarted: 0,
            sagasCompleted: 0,
            sagasFailed: 0,
            sagasCompensated: 0,
            averageExecutionTime: 0,
            totalExecutionTime: 0,
            activeSagasCount: 0
        };
        
        this.initialize();
    }

    /**
     * Initialize saga orchestrator
     */
    async initialize() {
        // Subscribe to event store for saga triggers
        this.eventStore.subscribe('*', this.handleEvent.bind(this), {
            catchUp: true,
            persistent: true
        });
        
        // Load persisted saga states
        await this.loadPersistedSagas();
        
        this.emit('initialized');
    }

    /**
     * Register saga definition
     * @param {string} sagaType - Saga type identifier
     * @param {Object} definition - Saga definition
     */
    registerSaga(sagaType, definition) {
        this.validateSagaDefinition(definition);
        
        this.sagaDefinitions.set(sagaType, {
            ...definition,
            type: sagaType,
            registeredAt: Date.now()
        });
        
        // Register event triggers
        for (const eventType of definition.triggers || []) {
            if (!this.eventSubscriptions.has(eventType)) {
                this.eventSubscriptions.set(eventType, new Set());
            }
            this.eventSubscriptions.get(eventType).add(sagaType);
        }
        
        this.emit('saga-registered', { sagaType });
    }

    /**
     * Validate saga definition
     * @param {Object} definition - Saga definition to validate
     */
    validateSagaDefinition(definition) {
        if (!definition.steps || !Array.isArray(definition.steps)) {
            throw new Error('Saga definition must have steps array');
        }
        
        if (!definition.triggers || !Array.isArray(definition.triggers)) {
            throw new Error('Saga definition must have triggers array');
        }
        
        for (const step of definition.steps) {
            if (!step.name || !step.action) {
                throw new Error('Each saga step must have name and action');
            }
        }
    }

    /**
     * Start saga instance
     * @param {string} sagaType - Saga type
     * @param {Object} data - Initial saga data
     * @param {Object} context - Execution context
     * @returns {Promise<string>} Saga ID
     */
    async startSaga(sagaType, data = {}, context = {}) {
        const definition = this.sagaDefinitions.get(sagaType);
        if (!definition) {
            throw new Error(`Saga type not registered: ${sagaType}`);
        }
        
        const sagaId = this.generateSagaId();
        const startTime = Date.now();
        
        const sagaInstance = {
            id: sagaId,
            type: sagaType,
            definition,
            data,
            context,
            state: 'started',
            currentStep: 0,
            completedSteps: [],
            failedSteps: [],
            compensatedSteps: [],
            startTime,
            lastActivity: startTime,
            retryCount: 0,
            errors: []
        };
        
        this.activeSagas.set(sagaId, sagaInstance);
        this.metrics.sagasStarted++;
        this.metrics.activeSagasCount++;
        
        // Persist saga state
        if (this.options.persistenceEnabled) {
            await this.persistSagaState(sagaInstance);
        }
        
        // Set timeout if configured
        if (definition.timeout || this.options.defaultTimeout) {
            this.setTimeoutForSaga(sagaId, definition.timeout || this.options.defaultTimeout);
        }
        
        // Start execution
        await this.executeSaga(sagaInstance);
        
        this.emit('saga-started', { sagaId, sagaType, data });
        
        return sagaId;
    }

    /**
     * Handle incoming event for saga triggers
     * @param {Object} event - Event to handle
     */
    async handleEvent(event) {
        const triggeredSagas = this.eventSubscriptions.get(event.eventType) || new Set();
        
        for (const sagaType of triggeredSagas) {
            const definition = this.sagaDefinitions.get(sagaType);
            
            if (definition && this.shouldTriggerSaga(definition, event)) {
                try {
                    await this.startSaga(sagaType, { triggerEvent: event }, {
                        correlationId: event.correlationId,
                        causationId: event.eventId
                    });
                } catch (error) {
                    this.emit('saga-trigger-error', { sagaType, event, error });
                }
            }
        }
        
        // Check if event affects any active sagas
        for (const [sagaId, sagaInstance] of this.activeSagas) {
            if (this.shouldHandleEventInSaga(sagaInstance, event)) {
                await this.handleEventInSaga(sagaInstance, event);
            }
        }
    }

    /**
     * Check if saga should be triggered by event
     * @param {Object} definition - Saga definition
     * @param {Object} event - Triggering event
     * @returns {boolean} Should trigger
     */
    shouldTriggerSaga(definition, event) {
        if (definition.triggerCondition) {
            return definition.triggerCondition(event);
        }
        return true; // Default: trigger on any matching event type
    }

    /**
     * Check if event should be handled by active saga
     * @param {Object} sagaInstance - Saga instance
     * @param {Object} event - Event to check
     * @returns {boolean} Should handle
     */
    shouldHandleEventInSaga(sagaInstance, event) {
        const { definition } = sagaInstance;
        
        // Check if saga is waiting for this event type
        if (definition.eventHandlers && definition.eventHandlers[event.eventType]) {
            return true;
        }
        
        // Check correlation ID match
        if (sagaInstance.context.correlationId === event.correlationId) {
            return true;
        }
        
        return false;
    }

    /**
     * Handle event in active saga
     * @param {Object} sagaInstance - Saga instance
     * @param {Object} event - Event to handle
     */
    async handleEventInSaga(sagaInstance, event) {
        const { definition } = sagaInstance;
        const handler = definition.eventHandlers?.[event.eventType];
        
        if (handler) {
            try {
                // Update saga data based on event
                await handler(sagaInstance.data, event);
                
                // Update last activity
                sagaInstance.lastActivity = Date.now();
                
                // Continue saga execution if it was waiting
                if (sagaInstance.state === 'waiting') {
                    await this.executeSaga(sagaInstance);
                }
                
                // Persist updated state
                if (this.options.persistenceEnabled) {
                    await this.persistSagaState(sagaInstance);
                }
                
            } catch (error) {
                await this.handleSagaError(sagaInstance, error);
            }
        }
    }

    /**
     * Execute saga steps
     * @param {Object} sagaInstance - Saga instance to execute
     */
    async executeSaga(sagaInstance) {
        const { definition } = sagaInstance;
        
        try {
            while (sagaInstance.currentStep < definition.steps.length) {
                const step = definition.steps[sagaInstance.currentStep];
                
                // Check if step should be executed
                if (step.condition && !step.condition(sagaInstance.data)) {
                    sagaInstance.currentStep++;
                    continue;
                }
                
                // Execute step
                await this.executeStep(sagaInstance, step);
                
                // Check if saga should wait for event
                if (step.waitForEvent) {
                    sagaInstance.state = 'waiting';
                    break;
                }
                
                sagaInstance.currentStep++;
            }
            
            // Check if saga is complete
            if (sagaInstance.currentStep >= definition.steps.length && sagaInstance.state !== 'waiting') {
                await this.completeSaga(sagaInstance);
            }
            
        } catch (error) {
            await this.handleSagaError(sagaInstance, error);
        }
    }

    /**
     * Execute individual saga step
     * @param {Object} sagaInstance - Saga instance
     * @param {Object} step - Step to execute
     */
    async executeStep(sagaInstance, step) {
        const stepStartTime = Date.now();
        
        try {
            // Execute step action
            let result;
            
            if (step.type === 'command') {
                result = await this.executeCommandStep(sagaInstance, step);
            } else if (step.type === 'parallel') {
                result = await this.executeParallelStep(sagaInstance, step);
            } else if (step.type === 'condition') {
                result = await this.executeConditionStep(sagaInstance, step);
            } else {
                result = await step.action(sagaInstance.data, sagaInstance.context);
            }
            
            // Record successful step
            sagaInstance.completedSteps.push({
                name: step.name,
                result,
                executedAt: Date.now(),
                executionTime: Date.now() - stepStartTime
            });
            
            // Store compensation action if provided
            if (step.compensation) {
                if (!this.compensations.has(sagaInstance.id)) {
                    this.compensations.set(sagaInstance.id, []);
                }
                this.compensations.get(sagaInstance.id).unshift({
                    stepName: step.name,
                    compensation: step.compensation,
                    stepResult: result
                });
            }
            
            this.emit('saga-step-completed', {
                sagaId: sagaInstance.id,
                stepName: step.name,
                result
            });
            
        } catch (error) {
            // Record failed step
            sagaInstance.failedSteps.push({
                name: step.name,
                error: error.message,
                failedAt: Date.now(),
                executionTime: Date.now() - stepStartTime
            });
            
            throw error;
        }
    }

    /**
     * Execute command step
     * @param {Object} sagaInstance - Saga instance
     * @param {Object} step - Command step
     * @returns {Promise<*>} Command result
     */
    async executeCommandStep(sagaInstance, step) {
        const command = step.command(sagaInstance.data, sagaInstance.context);
        
        return await this.commandBus.execute(command, {
            ...sagaInstance.context,
            sagaId: sagaInstance.id,
            stepName: step.name
        });
    }

    /**
     * Execute parallel step
     * @param {Object} sagaInstance - Saga instance
     * @param {Object} step - Parallel step
     * @returns {Promise<Array>} Parallel results
     */
    async executeParallelStep(sagaInstance, step) {
        const parallelActions = step.actions || [];
        
        const promises = parallelActions.map(async (action, index) => {
            try {
                return await action(sagaInstance.data, sagaInstance.context);
            } catch (error) {
                throw new Error(`Parallel action ${index} failed: ${error.message}`);
            }
        });
        
        if (step.waitForAll) {
            return await Promise.all(promises);
        } else {
            return await Promise.allSettled(promises);
        }
    }

    /**
     * Execute condition step
     * @param {Object} sagaInstance - Saga instance
     * @param {Object} step - Condition step
     * @returns {Promise<*>} Condition result
     */
    async executeConditionStep(sagaInstance, step) {
        const condition = await step.condition(sagaInstance.data, sagaInstance.context);
        
        if (condition && step.thenAction) {
            return await step.thenAction(sagaInstance.data, sagaInstance.context);
        } else if (!condition && step.elseAction) {
            return await step.elseAction(sagaInstance.data, sagaInstance.context);
        }
        
        return condition;
    }

    /**
     * Complete saga successfully
     * @param {Object} sagaInstance - Saga instance
     */
    async completeSaga(sagaInstance) {
        sagaInstance.state = 'completed';
        sagaInstance.completedAt = Date.now();
        
        // Clear timeout
        this.clearTimeoutForSaga(sagaInstance.id);
        
        // Update metrics
        this.metrics.sagasCompleted++;
        this.metrics.activeSagasCount--;
        
        const executionTime = sagaInstance.completedAt - sagaInstance.startTime;
        this.metrics.totalExecutionTime += executionTime;
        this.metrics.averageExecutionTime = this.metrics.totalExecutionTime / this.metrics.sagasCompleted;
        
        // Clean up
        this.activeSagas.delete(sagaInstance.id);
        this.compensations.delete(sagaInstance.id);
        
        // Persist final state
        if (this.options.persistenceEnabled) {
            await this.persistSagaState(sagaInstance);
        }
        
        this.emit('saga-completed', {
            sagaId: sagaInstance.id,
            sagaType: sagaInstance.type,
            executionTime
        });
    }

    /**
     * Handle saga error and potentially compensate
     * @param {Object} sagaInstance - Saga instance
     * @param {Error} error - Error that occurred
     */
    async handleSagaError(sagaInstance, error) {
        sagaInstance.errors.push({
            error: error.message,
            step: sagaInstance.currentStep,
            timestamp: Date.now()
        });
        
        // Check if we should retry
        if (sagaInstance.retryCount < this.options.maxRetries) {
            sagaInstance.retryCount++;
            sagaInstance.state = 'retrying';
            
            // Wait before retry
            await this.sleep(1000 * sagaInstance.retryCount);
            
            // Retry execution
            await this.executeSaga(sagaInstance);
            return;
        }
        
        // Start compensation
        await this.compensateSaga(sagaInstance, error);
    }

    /**
     * Compensate saga by executing compensation actions
     * @param {Object} sagaInstance - Saga instance
     * @param {Error} originalError - Original error that caused compensation
     */
    async compensateSaga(sagaInstance, originalError) {
        sagaInstance.state = 'compensating';
        
        const compensationActions = this.compensations.get(sagaInstance.id) || [];
        
        for (const compensation of compensationActions) {
            try {
                await this.executeCompensation(sagaInstance, compensation);
                
                sagaInstance.compensatedSteps.push({
                    stepName: compensation.stepName,
                    compensatedAt: Date.now()
                });
                
            } catch (compensationError) {
                this.emit('saga-compensation-failed', {
                    sagaId: sagaInstance.id,
                    stepName: compensation.stepName,
                    error: compensationError.message
                });
            }
        }
        
        // Mark saga as failed
        sagaInstance.state = 'failed';
        sagaInstance.failedAt = Date.now();
        sagaInstance.originalError = originalError.message;
        
        // Update metrics
        this.metrics.sagasFailed++;
        this.metrics.sagasCompensated++;
        this.metrics.activeSagasCount--;
        
        // Clean up
        this.clearTimeoutForSaga(sagaInstance.id);
        this.activeSagas.delete(sagaInstance.id);
        this.compensations.delete(sagaInstance.id);
        
        // Persist final state
        if (this.options.persistenceEnabled) {
            await this.persistSagaState(sagaInstance);
        }
        
        this.emit('saga-failed', {
            sagaId: sagaInstance.id,
            sagaType: sagaInstance.type,
            error: originalError.message,
            compensatedSteps: sagaInstance.compensatedSteps.length
        });
    }

    /**
     * Execute compensation action
     * @param {Object} sagaInstance - Saga instance
     * @param {Object} compensation - Compensation to execute
     */
    async executeCompensation(sagaInstance, compensation) {
        const timeout = this.options.compensationTimeout;
        
        return await this.executeWithTimeout(
            () => compensation.compensation(sagaInstance.data, sagaInstance.context, compensation.stepResult),
            timeout
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
                reject(new Error(`Operation timed out after ${timeout}ms`));
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
     * Set timeout for saga
     * @param {string} sagaId - Saga ID
     * @param {number} timeout - Timeout in milliseconds
     */
    setTimeoutForSaga(sagaId, timeout) {
        const timeoutHandle = setTimeout(async () => {
            const sagaInstance = this.activeSagas.get(sagaId);
            if (sagaInstance) {
                await this.handleSagaError(sagaInstance, new Error('Saga timeout'));
            }
        }, timeout);
        
        this.timeouts.set(sagaId, timeoutHandle);
    }

    /**
     * Clear timeout for saga
     * @param {string} sagaId - Saga ID
     */
    clearTimeoutForSaga(sagaId) {
        const timeoutHandle = this.timeouts.get(sagaId);
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            this.timeouts.delete(sagaId);
        }
    }

    /**
     * Persist saga state
     * @param {Object} sagaInstance - Saga instance
     */
    async persistSagaState(sagaInstance) {
        const streamId = `saga-${sagaInstance.id}`;
        const event = {
            eventType: 'SagaStateChanged',
            data: {
                sagaId: sagaInstance.id,
                state: sagaInstance.state,
                currentStep: sagaInstance.currentStep,
                data: sagaInstance.data,
                completedSteps: sagaInstance.completedSteps,
                failedSteps: sagaInstance.failedSteps,
                compensatedSteps: sagaInstance.compensatedSteps,
                retryCount: sagaInstance.retryCount,
                lastActivity: sagaInstance.lastActivity
            },
            metadata: {
                sagaType: sagaInstance.type,
                correlationId: sagaInstance.context.correlationId
            }
        };
        
        await this.eventStore.appendToStream(streamId, [event]);
        this.sagaStates.set(sagaInstance.id, sagaInstance);
    }

    /**
     * Load persisted sagas
     */
    async loadPersistedSagas() {
        // This would typically load from event store
        // For now, just initialize empty
        this.sagaStates.clear();
    }

    /**
     * Generate unique saga ID
     * @returns {string} Saga ID
     */
    generateSagaId() {
        const crypto = require('crypto');
        return `saga_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
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
     * Get saga orchestrator metrics
     * @returns {Object} Metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            registeredSagas: this.sagaDefinitions.size,
            activeSagas: this.activeSagas.size,
            persistedSagas: this.sagaStates.size,
            activeTimeouts: this.timeouts.size
        };
    }

    /**
     * Get active sagas
     * @returns {Array} Active saga instances
     */
    getActiveSagas() {
        return Array.from(this.activeSagas.values()).map(saga => ({
            id: saga.id,
            type: saga.type,
            state: saga.state,
            currentStep: saga.currentStep,
            startTime: saga.startTime,
            lastActivity: saga.lastActivity,
            retryCount: saga.retryCount
        }));
    }

    /**
     * Get saga by ID
     * @param {string} sagaId - Saga ID
     * @returns {Object|null} Saga instance
     */
    getSaga(sagaId) {
        return this.activeSagas.get(sagaId) || this.sagaStates.get(sagaId) || null;
    }

    /**
     * Shutdown saga orchestrator
     */
    async shutdown() {
        // Clear all timeouts
        for (const timeoutHandle of this.timeouts.values()) {
            clearTimeout(timeoutHandle);
        }
        this.timeouts.clear();
        
        // Wait for active sagas to complete or timeout
        const maxWaitTime = 30000; // 30 seconds
        const startTime = Date.now();
        
        while (this.activeSagas.size > 0 && (Date.now() - startTime) < maxWaitTime) {
            await this.sleep(1000);
        }
        
        // Force stop remaining sagas
        for (const [sagaId, sagaInstance] of this.activeSagas) {
            await this.handleSagaError(sagaInstance, new Error('System shutdown'));
        }
        
        this.emit('shutdown');
    }
}

module.exports = SagaOrchestrator;
