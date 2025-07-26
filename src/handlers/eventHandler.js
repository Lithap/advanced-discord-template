const fs = require('fs');
const path = require('path');
const logger = require('../utils/simple-logger.js');

class EventHandler {
    constructor(client) {
        this.client = client;
        this.events = new Map();
    }

    // Load all events from events directory
    async loadEvents() {
        const eventsPath = path.join(__dirname, '../events');
        
        if (!fs.existsSync(eventsPath)) {
            logger.warn('Events directory not found');
            return;
        }

        const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

        for (const file of eventFiles) {
            try {
                const filePath = path.join(eventsPath, file);
                delete require.cache[require.resolve(filePath)]; // Clear cache for hot reload
                const event = require(filePath);

                // Validate event structure
                if (!this.validateEvent(event, file)) continue;

                // Register event
                this.registerEvent(event);
                this.events.set(event.name, event);

                logger.debug(`Loaded event: ${event.name}`);
            } catch (error) {
                logger.error(`Failed to load event ${file}:`, error);
            }
        }

        logger.success(`Loaded ${this.events.size} events`);
    }

    // Validate event structure
    validateEvent(event, filename) {
        if (!event.name || !event.execute) {
            logger.warn(`Event ${filename} is missing required "name" or "execute" property`);
            return false;
        }

        return true;
    }

    // Register event with Discord client
    registerEvent(event) {
        if (event.once) {
            this.client.once(event.name, (...args) => this.executeEvent(event, ...args));
        } else {
            this.client.on(event.name, (...args) => this.executeEvent(event, ...args));
        }
    }

    // Execute event with error handling
    async executeEvent(event, ...args) {
        try {
            await event.execute(this.client, ...args);
            
            // Log event execution (only for important events)
            if (event.log !== false) {
                logger.event(event.name, `Event executed successfully`);
            }
        } catch (error) {
            logger.error(`Error executing event ${event.name}:`, error);
            
            // Emit error event for additional handling
            this.client.emit('eventError', {
                event: event.name,
                error: error,
                args: args
            });
        }
    }

    // Reload a specific event
    async reloadEvent(eventName) {
        const event = this.events.get(eventName);
        if (!event) return false;

        try {
            const eventsPath = path.join(__dirname, '../events');
            const filePath = path.join(eventsPath, `${eventName}.js`);

            // Remove old listeners
            this.client.removeAllListeners(eventName);

            // Clear cache and reload
            delete require.cache[require.resolve(filePath)];
            const newEvent = require(filePath);

            if (!this.validateEvent(newEvent, `${eventName}.js`)) {
                return false;
            }

            // Register new event
            this.registerEvent(newEvent);
            this.events.set(eventName, newEvent);

            logger.success(`Reloaded event: ${eventName}`);
            return true;
        } catch (error) {
            logger.error(`Failed to reload event ${eventName}:`, error);
            return false;
        }
    }

    // Get event by name
    getEvent(name) {
        return this.events.get(name);
    }

    // Get all events
    getAllEvents() {
        return Array.from(this.events.values());
    }

    // Unregister event
    unregisterEvent(eventName) {
        const event = this.events.get(eventName);
        if (!event) return false;

        this.client.removeAllListeners(eventName);
        this.events.delete(eventName);

        logger.info(`Unregistered event: ${eventName}`);
        return true;
    }

    // Register custom event listener
    registerCustomEvent(eventName, listener, options = {}) {
        const event = {
            name: eventName,
            execute: listener,
            once: options.once || false,
            log: options.log !== false
        };

        this.registerEvent(event);
        this.events.set(eventName, event);

        logger.debug(`Registered custom event: ${eventName}`);
    }

    // Get event statistics
    getEventStats() {
        const stats = {
            total: this.events.size,
            once: 0,
            on: 0,
            logged: 0
        };

        for (const event of this.events.values()) {
            if (event.once) stats.once++;
            else stats.on++;
            
            if (event.log !== false) stats.logged++;
        }

        return stats;
    }
}

module.exports = EventHandler;
