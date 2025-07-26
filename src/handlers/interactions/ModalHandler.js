const { Collection } = require('discord.js');

/**
 * Modal Interaction Handler
 * Manages all modal interactions with validation and middleware support
 */
class ModalHandler {
    constructor(eventBus, logger) {
        this.eventBus = eventBus;
        this.logger = logger;
        this.handlers = new Collection();
        this.middleware = [];
        this.validators = new Collection();
        this.stats = {
            totalInteractions: 0,
            successfulInteractions: 0,
            failedInteractions: 0,
            validationFailures: 0,
            handlerCounts: new Map()
        };
    }

    /**
     * Register a modal handler
     * @param {string} customId - Modal custom ID
     * @param {Function} handler - Handler function
     * @param {Object} options - Handler options
     */
    register(customId, handler, options = {}) {
        if (typeof handler !== 'function') {
            throw new Error('Handler must be a function');
        }

        this.handlers.set(customId, {
            handler,
            options: {
                requireAuth: options.requireAuth || false,
                permissions: options.permissions || [],
                validation: options.validation || {},
                ephemeral: options.ephemeral !== false,
                ...options
            }
        });

        this.logger.debug(`Registered modal handler: ${customId}`);
    }

    /**
     * Register a field validator
     * @param {string} fieldName - Field name
     * @param {Function} validator - Validator function
     */
    registerValidator(fieldName, validator) {
        if (typeof validator !== 'function') {
            throw new Error('Validator must be a function');
        }

        this.validators.set(fieldName, validator);
        this.logger.debug(`Registered field validator: ${fieldName}`);
    }

    /**
     * Unregister a modal handler
     * @param {string} customId - Modal custom ID
     */
    unregister(customId) {
        if (this.handlers.delete(customId)) {
            this.logger.debug(`Unregistered modal handler: ${customId}`);
            return true;
        }
        return false;
    }

    /**
     * Add middleware
     * @param {Function} middleware - Middleware function
     */
    use(middleware) {
        if (typeof middleware !== 'function') {
            throw new Error('Middleware must be a function');
        }
        this.middleware.push(middleware);
        this.logger.debug('Added modal handler middleware');
    }

    /**
     * Handle modal interaction
     * @param {Object} interaction - Discord interaction
     */
    async handle(interaction) {
        const startTime = Date.now();
        this.stats.totalInteractions++;

        try {
            // Parse custom ID
            const { handlerId, params } = this.parseCustomId(interaction.customId);
            
            // Get handler
            const handlerConfig = this.handlers.get(handlerId);
            if (!handlerConfig) {
                this.logger.warn(`No modal handler found for: ${handlerId}`);
                return await this.sendUnknownHandlerError(interaction);
            }

            // Update handler stats
            const currentCount = this.stats.handlerCounts.get(handlerId) || 0;
            this.stats.handlerCounts.set(handlerId, currentCount + 1);

            // Extract field values
            const fieldValues = this.extractFieldValues(interaction);

            // Create interaction context
            const context = {
                interaction,
                handlerId,
                params,
                fieldValues,
                options: handlerConfig.options,
                startTime,
                metadata: {}
            };

            // Run middleware
            const middlewareResult = await this.runMiddleware(context);
            if (!middlewareResult.success) {
                return await this.sendMiddlewareError(interaction, middlewareResult.error);
            }

            // Validate fields
            const validationResult = await this.validateFields(context);
            if (!validationResult.success) {
                this.stats.validationFailures++;
                return await this.sendValidationError(interaction, validationResult.errors);
            }

            // Execute handler
            await handlerConfig.handler(interaction, params, fieldValues, context);

            // Update success stats
            this.stats.successfulInteractions++;

            // Emit success event
            this.eventBus.emitEvent('modal.interaction.success', {
                handlerId,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                fieldCount: Object.keys(fieldValues).length,
                duration: Date.now() - startTime
            }, { source: 'ModalHandler' });

            this.logger.debug(`Modal interaction handled: ${handlerId}`, {
                user: interaction.user.tag,
                fields: Object.keys(fieldValues).length,
                duration: Date.now() - startTime
            });

        } catch (error) {
            this.stats.failedInteractions++;
            
            this.logger.error('Error in modal handler:', error);
            
            // Emit error event
            this.eventBus.emitEvent('modal.interaction.error', {
                error: error.message,
                customId: interaction.customId,
                userId: interaction.user.id,
                guildId: interaction.guildId
            }, { source: 'ModalHandler' });

            await this.sendHandlerError(interaction, error);
        }
    }

    /**
     * Parse custom ID into handler ID and parameters
     * @param {string} customId - Custom ID
     * @returns {Object} Parsed result
     */
    parseCustomId(customId) {
        const parts = customId.split('_');
        const handlerId = parts[0];
        const params = parts.slice(1);

        return { handlerId, params };
    }

    /**
     * Extract field values from modal interaction
     * @param {Object} interaction - Discord interaction
     * @returns {Object} Field values
     */
    extractFieldValues(interaction) {
        const fieldValues = {};
        
        for (const row of interaction.components) {
            for (const component of row.components) {
                if (component.customId && component.value !== undefined) {
                    fieldValues[component.customId] = component.value;
                }
            }
        }

        return fieldValues;
    }

    /**
     * Run middleware chain
     * @param {Object} context - Interaction context
     * @returns {Promise<Object>} Middleware result
     */
    async runMiddleware(context) {
        for (const middleware of this.middleware) {
            try {
                const result = await middleware(context);
                if (result === false || (result && result.success === false)) {
                    return {
                        success: false,
                        error: result?.error || 'Middleware rejected interaction'
                    };
                }
            } catch (error) {
                this.logger.error('Error in modal middleware:', error);
                return {
                    success: false,
                    error: 'Middleware error'
                };
            }
        }

        return { success: true };
    }

    /**
     * Validate field values
     * @param {Object} context - Interaction context
     * @returns {Promise<Object>} Validation result
     */
    async validateFields(context) {
        const { fieldValues, options } = context;
        const errors = [];

        // Run built-in validations
        if (options.validation) {
            for (const [fieldName, rules] of Object.entries(options.validation)) {
                const value = fieldValues[fieldName];
                
                // Required validation
                if (rules.required && (!value || value.trim() === '')) {
                    errors.push(`${fieldName} is required`);
                    continue;
                }

                // Skip other validations if field is empty and not required
                if (!value || value.trim() === '') {
                    continue;
                }

                // Length validation
                if (rules.minLength && value.length < rules.minLength) {
                    errors.push(`${fieldName} must be at least ${rules.minLength} characters`);
                }
                if (rules.maxLength && value.length > rules.maxLength) {
                    errors.push(`${fieldName} must be no more than ${rules.maxLength} characters`);
                }

                // Pattern validation
                if (rules.pattern && !rules.pattern.test(value)) {
                    errors.push(`${fieldName} format is invalid`);
                }

                // Custom validation
                if (rules.custom && typeof rules.custom === 'function') {
                    try {
                        const customResult = await rules.custom(value, fieldValues);
                        if (customResult !== true) {
                            errors.push(customResult || `${fieldName} validation failed`);
                        }
                    } catch (error) {
                        this.logger.error(`Custom validation error for ${fieldName}:`, error);
                        errors.push(`${fieldName} validation error`);
                    }
                }
            }
        }

        // Run registered validators
        for (const [fieldName, value] of Object.entries(fieldValues)) {
            const validator = this.validators.get(fieldName);
            if (validator) {
                try {
                    const result = await validator(value, fieldValues, context);
                    if (result !== true) {
                        errors.push(result || `${fieldName} validation failed`);
                    }
                } catch (error) {
                    this.logger.error(`Validator error for ${fieldName}:`, error);
                    errors.push(`${fieldName} validation error`);
                }
            }
        }

        return {
            success: errors.length === 0,
            errors
        };
    }

    /**
     * Send unknown handler error
     * @param {Object} interaction - Discord interaction
     */
    async sendUnknownHandlerError(interaction) {
        try {
            const embed = {
                color: 0xff0000,
                title: '❌ Unknown Modal',
                description: 'This modal is not recognized or may be outdated.',
                timestamp: new Date().toISOString()
            };

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            this.logger.error('Error sending unknown handler error:', error);
        }
    }

    /**
     * Send middleware error
     * @param {Object} interaction - Discord interaction
     * @param {string} error - Error message
     */
    async sendMiddlewareError(interaction, error) {
        try {
            const embed = {
                color: 0xff0000,
                title: '❌ Access Denied',
                description: error || 'You do not have permission to submit this modal.',
                timestamp: new Date().toISOString()
            };

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            this.logger.error('Error sending middleware error:', error);
        }
    }

    /**
     * Send validation error
     * @param {Object} interaction - Discord interaction
     * @param {Array} errors - Validation errors
     */
    async sendValidationError(interaction, errors) {
        try {
            const embed = {
                color: 0xff0000,
                title: '❌ Validation Error',
                description: 'Please correct the following errors:\n\n' + errors.map(error => `• ${error}`).join('\n'),
                timestamp: new Date().toISOString()
            };

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            this.logger.error('Error sending validation error:', error);
        }
    }

    /**
     * Send handler error
     * @param {Object} interaction - Discord interaction
     * @param {Error} error - Error object
     */
    async sendHandlerError(interaction, error) {
        try {
            const embed = {
                color: 0xff0000,
                title: '❌ Modal Error',
                description: 'An error occurred while processing your submission. Please try again.',
                timestamp: new Date().toISOString()
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [embed], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        } catch (followUpError) {
            this.logger.error('Error sending handler error:', followUpError);
        }
    }

    /**
     * Get handler statistics
     * @returns {Object} Handler statistics
     */
    getStats() {
        return {
            ...this.stats,
            handlerCounts: Object.fromEntries(this.stats.handlerCounts),
            registeredHandlers: this.handlers.size,
            registeredValidators: this.validators.size,
            middlewareCount: this.middleware.length,
            successRate: this.stats.totalInteractions > 0 
                ? (this.stats.successfulInteractions / this.stats.totalInteractions * 100).toFixed(2) + '%'
                : '0%',
            validationFailureRate: this.stats.totalInteractions > 0
                ? (this.stats.validationFailures / this.stats.totalInteractions * 100).toFixed(2) + '%'
                : '0%'
        };
    }

    /**
     * Get registered handlers
     * @returns {Array} Handler names
     */
    getRegisteredHandlers() {
        return Array.from(this.handlers.keys());
    }

    /**
     * Get registered validators
     * @returns {Array} Validator names
     */
    getRegisteredValidators() {
        return Array.from(this.validators.keys());
    }

    /**
     * Check if handler exists
     * @param {string} customId - Custom ID
     * @returns {boolean} Handler exists
     */
    hasHandler(customId) {
        return this.handlers.has(customId);
    }

    /**
     * Clear all handlers and validators
     */
    clear() {
        this.handlers.clear();
        this.validators.clear();
        this.logger.debug('Cleared all modal handlers and validators');
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalInteractions: 0,
            successfulInteractions: 0,
            failedInteractions: 0,
            validationFailures: 0,
            handlerCounts: new Map()
        };
        this.logger.debug('Reset modal handler statistics');
    }

    /**
     * Shutdown the handler
     */
    async shutdown() {
        this.logger.info('Shutting down ModalHandler...');
        
        this.handlers.clear();
        this.validators.clear();
        this.middleware = [];
        this.resetStats();
        
        this.logger.success('ModalHandler shutdown complete');
    }
}

module.exports = ModalHandler;
