const { EventEmitter } = require('events');
const logger = require('../utils/simple-logger.js');

/**
 * Enterprise-grade Event Bus with Advanced Features
 * Supports async/sync events, middleware, filtering, and monitoring
 */
class EventBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(1000); // Enterprise-scale limit
        this.eventHistory = [];
        this.maxHistorySize = 10000;
        this.middleware = [];
        this.interceptors = new Map();
        this.filters = new Map();
        this.rateLimits = new Map();
        this.isEnabled = true;

        // Enhanced event statistics
        this.stats = {
            totalEvents: 0,
            eventCounts: new Map(),
            errors: 0
        };

        // Setup error handling
        this.on('error', this.handleError.bind(this));
    }

    /**
     * Emit an event with metadata
     * @param {string} eventName - Event name
     * @param {Object} data - Event data
     * @param {Object} metadata - Additional metadata
     */
    emitEvent(eventName, data = {}, metadata = {}) {
        try {
            const eventData = {
                name: eventName,
                data,
                metadata: {
                    timestamp: new Date(),
                    source: metadata.source || 'unknown',
                    correlationId: metadata.correlationId || this.generateCorrelationId(),
                    ...metadata
                }
            };

            // Add to history
            this.addToHistory(eventData);

            // Update statistics
            this.updateStats(eventName);

            // Emit the event
            this.emit(eventName, eventData);

            logger.debug(`Event emitted: ${eventName}`, {
                correlationId: eventData.metadata.correlationId,
                source: eventData.metadata.source
            });

            return eventData.metadata.correlationId;
        } catch (error) {
            logger.error(`Error emitting event '${eventName}':`, error);
            this.stats.errors++;
            throw error;
        }
    }

    /**
     * Subscribe to an event with error handling
     * @param {string} eventName - Event name
     * @param {Function} handler - Event handler
     * @param {Object} options - Subscription options
     */
    subscribe(eventName, handler, options = {}) {
        const wrappedHandler = async (eventData) => {
            try {
                await handler(eventData);
            } catch (error) {
                logger.error(`Error in event handler for '${eventName}':`, error);
                this.stats.errors++;
                
                if (options.throwOnError) {
                    throw error;
                }
            }
        };

        this.on(eventName, wrappedHandler);
        logger.debug(`Subscribed to event: ${eventName}`);

        // Return unsubscribe function
        return () => {
            this.off(eventName, wrappedHandler);
            logger.debug(`Unsubscribed from event: ${eventName}`);
        };
    }

    /**
     * Subscribe to an event only once
     * @param {string} eventName - Event name
     * @param {Function} handler - Event handler
     * @param {Object} options - Subscription options
     */
    subscribeOnce(eventName, handler, options = {}) {
        const wrappedHandler = async (eventData) => {
            try {
                await handler(eventData);
            } catch (error) {
                logger.error(`Error in one-time event handler for '${eventName}':`, error);
                this.stats.errors++;
                
                if (options.throwOnError) {
                    throw error;
                }
            }
        };

        this.once(eventName, wrappedHandler);
        logger.debug(`Subscribed once to event: ${eventName}`);
    }

    /**
     * Wait for an event to occur
     * @param {string} eventName - Event name
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise} Promise that resolves with event data
     */
    waitForEvent(eventName, timeout = 30000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.off(eventName, handler);
                reject(new Error(`Timeout waiting for event '${eventName}'`));
            }, timeout);

            const handler = (eventData) => {
                clearTimeout(timer);
                resolve(eventData);
            };

            this.once(eventName, handler);
        });
    }

    /**
     * Get event statistics
     * @returns {Object} Event statistics
     */
    getStats() {
        return {
            ...this.stats,
            eventCounts: Object.fromEntries(this.stats.eventCounts),
            listenerCount: this.eventNames().reduce((total, event) => {
                return total + this.listenerCount(event);
            }, 0)
        };
    }

    /**
     * Get recent event history
     * @param {number} limit - Number of events to return
     * @returns {Array} Recent events
     */
    getHistory(limit = 50) {
        return this.eventHistory.slice(-limit);
    }

    /**
     * Clear event history
     */
    clearHistory() {
        this.eventHistory = [];
        logger.debug('Event history cleared');
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalEvents: 0,
            eventCounts: new Map(),
            errors: 0
        };
        logger.debug('Event statistics reset');
    }

    /**
     * Add event to history
     * @param {Object} eventData - Event data
     */
    addToHistory(eventData) {
        this.eventHistory.push(eventData);
        
        // Trim history if it gets too large
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
        }
    }

    /**
     * Update event statistics
     * @param {string} eventName - Event name
     */
    updateStats(eventName) {
        this.stats.totalEvents++;
        const currentCount = this.stats.eventCounts.get(eventName) || 0;
        this.stats.eventCounts.set(eventName, currentCount + 1);
    }

    /**
     * Generate correlation ID for event tracking
     * @returns {string} Correlation ID
     */
    generateCorrelationId() {
        return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Handle internal errors
     * @param {Error} error - Error object
     */
    handleError(error) {
        logger.error('EventBus internal error:', error);
        this.stats.errors++;
    }

    /**
     * Shutdown the event bus
     */
    async shutdown() {
        logger.info('Shutting down event bus...');
        
        // Remove all listeners
        this.removeAllListeners();
        
        // Clear history and stats
        this.clearHistory();
        this.resetStats();
        
        logger.success('Event bus shutdown complete');
    }
}

module.exports = EventBus;
