const { Collection } = require('discord.js');

/**
 * Button Interaction Handler
 * Manages all button interactions with middleware support
 */
class ButtonHandler {
    constructor(eventBus, logger) {
        this.eventBus = eventBus;
        this.logger = logger;
        this.handlers = new Collection();
        this.middleware = [];
        this.stats = {
            totalInteractions: 0,
            successfulInteractions: 0,
            failedInteractions: 0,
            handlerCounts: new Map()
        };
    }

    /**
     * Register a button handler
     * @param {string} customId - Button custom ID
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
                cooldown: options.cooldown || 0,
                ephemeral: options.ephemeral !== false,
                ...options
            }
        });

        this.logger.debug(`Registered button handler: ${customId}`);
    }

    /**
     * Unregister a button handler
     * @param {string} customId - Button custom ID
     */
    unregister(customId) {
        if (this.handlers.delete(customId)) {
            this.logger.debug(`Unregistered button handler: ${customId}`);
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
        this.logger.debug('Added button handler middleware');
    }

    /**
     * Handle button interaction
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
                this.logger.warn(`No button handler found for: ${handlerId}`);
                return await this.sendUnknownHandlerError(interaction);
            }

            // Update handler stats
            const currentCount = this.stats.handlerCounts.get(handlerId) || 0;
            this.stats.handlerCounts.set(handlerId, currentCount + 1);

            // Create interaction context
            const context = {
                interaction,
                handlerId,
                params,
                options: handlerConfig.options,
                startTime,
                metadata: {}
            };

            // Run middleware
            const middlewareResult = await this.runMiddleware(context);
            if (!middlewareResult.success) {
                return await this.sendMiddlewareError(interaction, middlewareResult.error);
            }

            // Execute handler
            await handlerConfig.handler(interaction, params, context);

            // Update success stats
            this.stats.successfulInteractions++;

            // Emit success event
            this.eventBus.emitEvent('button.interaction.success', {
                handlerId,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                duration: Date.now() - startTime
            }, { source: 'ButtonHandler' });

            this.logger.debug(`Button interaction handled: ${handlerId}`, {
                user: interaction.user.tag,
                duration: Date.now() - startTime
            });

        } catch (error) {
            this.stats.failedInteractions++;
            
            this.logger.error('Error in button handler:', error);
            
            // Emit error event
            this.eventBus.emitEvent('button.interaction.error', {
                error: error.message,
                customId: interaction.customId,
                userId: interaction.user.id,
                guildId: interaction.guildId
            }, { source: 'ButtonHandler' });

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
                this.logger.error('Error in button middleware:', error);
                return {
                    success: false,
                    error: 'Middleware error'
                };
            }
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
                title: '❌ Unknown Button',
                description: 'This button is not recognized or may be outdated.',
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
                description: error || 'You do not have permission to use this button.',
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
     * Send handler error
     * @param {Object} interaction - Discord interaction
     * @param {Error} error - Error object
     */
    async sendHandlerError(interaction, error) {
        try {
            const embed = {
                color: 0xff0000,
                title: '❌ Button Error',
                description: 'An error occurred while processing your request. Please try again.',
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
        this.logger.debug('Cleared all button handlers');
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalInteractions: 0,
            successfulInteractions: 0,
            failedInteractions: 0,
            handlerCounts: new Map()
        };
        this.logger.debug('Reset button handler statistics');
    }

    /**
     * Shutdown the handler
     */
    async shutdown() {
        this.logger.info('Shutting down ButtonHandler...');
        
        this.handlers.clear();
        this.middleware = [];
        this.resetStats();
        
        this.logger.success('ButtonHandler shutdown complete');
    }
}

module.exports = ButtonHandler;
