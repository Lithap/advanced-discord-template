const { Collection } = require('discord.js');

/**
 * Select Menu Interaction Handler
 * Manages all select menu interactions with multi-value support
 */
class SelectHandler {
    constructor(eventBus, logger) {
        this.eventBus = eventBus;
        this.logger = logger;
        this.handlers = new Collection();
        this.middleware = [];
        this.stats = {
            totalInteractions: 0,
            successfulInteractions: 0,
            failedInteractions: 0,
            handlerCounts: new Map(),
            valueStats: {
                totalValues: 0,
                averageValues: 0
            }
        };
    }

    /**
     * Register a select menu handler
     * @param {string} customId - Select menu custom ID
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
                minValues: options.minValues || 1,
                maxValues: options.maxValues || 1,
                allowedValues: options.allowedValues || null,
                ephemeral: options.ephemeral !== false,
                ...options
            }
        });

        this.logger.debug(`Registered select handler: ${customId}`);
    }

    /**
     * Unregister a select menu handler
     * @param {string} customId - Select menu custom ID
     */
    unregister(customId) {
        if (this.handlers.delete(customId)) {
            this.logger.debug(`Unregistered select handler: ${customId}`);
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
        this.logger.debug('Added select handler middleware');
    }

    /**
     * Handle select menu interaction
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
                this.logger.warn(`No select handler found for: ${handlerId}`);
                return await this.sendUnknownHandlerError(interaction);
            }

            // Update handler stats
            const currentCount = this.stats.handlerCounts.get(handlerId) || 0;
            this.stats.handlerCounts.set(handlerId, currentCount + 1);

            // Update value stats
            this.stats.valueStats.totalValues += interaction.values.length;
            this.stats.valueStats.averageValues = this.stats.valueStats.totalValues / this.stats.totalInteractions;

            // Create interaction context
            const context = {
                interaction,
                handlerId,
                params,
                values: interaction.values,
                options: handlerConfig.options,
                startTime,
                metadata: {}
            };

            // Run middleware
            const middlewareResult = await this.runMiddleware(context);
            if (!middlewareResult.success) {
                return await this.sendMiddlewareError(interaction, middlewareResult.error);
            }

            // Validate selection
            const validationResult = this.validateSelection(context);
            if (!validationResult.success) {
                return await this.sendValidationError(interaction, validationResult.error);
            }

            // Execute handler
            await handlerConfig.handler(interaction, interaction.values, params, context);

            // Update success stats
            this.stats.successfulInteractions++;

            // Emit success event
            this.eventBus.emitEvent('select.interaction.success', {
                handlerId,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                valueCount: interaction.values.length,
                values: interaction.values,
                duration: Date.now() - startTime
            }, { source: 'SelectHandler' });

            this.logger.debug(`Select interaction handled: ${handlerId}`, {
                user: interaction.user.tag,
                values: interaction.values.length,
                duration: Date.now() - startTime
            });

        } catch (error) {
            this.stats.failedInteractions++;
            
            this.logger.error('Error in select handler:', error);
            
            // Emit error event
            this.eventBus.emitEvent('select.interaction.error', {
                error: error.message,
                customId: interaction.customId,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                values: interaction.values
            }, { source: 'SelectHandler' });

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
                this.logger.error('Error in select middleware:', error);
                return {
                    success: false,
                    error: 'Middleware error'
                };
            }
        }

        return { success: true };
    }

    /**
     * Validate selection values
     * @param {Object} context - Interaction context
     * @returns {Object} Validation result
     */
    validateSelection(context) {
        const { values, options } = context;

        // Check value count
        if (values.length < options.minValues) {
            return {
                success: false,
                error: `Please select at least ${options.minValues} option${options.minValues > 1 ? 's' : ''}.`
            };
        }

        if (values.length > options.maxValues) {
            return {
                success: false,
                error: `Please select no more than ${options.maxValues} option${options.maxValues > 1 ? 's' : ''}.`
            };
        }

        // Check allowed values
        if (options.allowedValues && Array.isArray(options.allowedValues)) {
            for (const value of values) {
                if (!options.allowedValues.includes(value)) {
                    return {
                        success: false,
                        error: `Invalid selection: ${value}`
                    };
                }
            }
        }

        // Check for duplicates (shouldn't happen with Discord's UI, but just in case)
        const uniqueValues = [...new Set(values)];
        if (uniqueValues.length !== values.length) {
            return {
                success: false,
                error: 'Duplicate selections are not allowed.'
            };
        }

        return { success: true };
    }

    /**
     * Send unknown handler error
     * @param {Object} interaction - Discord interaction
     */
    async sendUnknownHandlerError(interaction) {
        try {
            const embed = {
                color: 0xff0000,
                title: '❌ Unknown Select Menu',
                description: 'This select menu is not recognized or may be outdated.',
                timestamp: new Date().toISOString()
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [embed], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
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
                description: error || 'You do not have permission to use this select menu.',
                timestamp: new Date().toISOString()
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [embed], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        } catch (error) {
            this.logger.error('Error sending middleware error:', error);
        }
    }

    /**
     * Send validation error
     * @param {Object} interaction - Discord interaction
     * @param {string} error - Error message
     */
    async sendValidationError(interaction, error) {
        try {
            const embed = {
                color: 0xff0000,
                title: '❌ Invalid Selection',
                description: error,
                timestamp: new Date().toISOString()
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [embed], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
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
                title: '❌ Select Menu Error',
                description: 'An error occurred while processing your selection. Please try again.',
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
            middlewareCount: this.middleware.length,
            successRate: this.stats.totalInteractions > 0 
                ? (this.stats.successfulInteractions / this.stats.totalInteractions * 100).toFixed(2) + '%'
                : '0%',
            valueStats: {
                ...this.stats.valueStats,
                averageValues: this.stats.totalInteractions > 0 
                    ? (this.stats.valueStats.totalValues / this.stats.totalInteractions).toFixed(2)
                    : '0'
            }
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
     * Check if handler exists
     * @param {string} customId - Custom ID
     * @returns {boolean} Handler exists
     */
    hasHandler(customId) {
        return this.handlers.has(customId);
    }

    /**
     * Clear all handlers
     */
    clear() {
        this.handlers.clear();
        this.logger.debug('Cleared all select handlers');
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalInteractions: 0,
            successfulInteractions: 0,
            failedInteractions: 0,
            handlerCounts: new Map(),
            valueStats: {
                totalValues: 0,
                averageValues: 0
            }
        };
        this.logger.debug('Reset select handler statistics');
    }

    /**
     * Shutdown the handler
     */
    async shutdown() {
        this.logger.info('Shutting down SelectHandler...');
        
        this.handlers.clear();
        this.middleware = [];
        this.resetStats();
        
        this.logger.success('SelectHandler shutdown complete');
    }
}

module.exports = SelectHandler;
