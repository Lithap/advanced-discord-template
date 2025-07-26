// Simple logger without chalk dependency for server environments
const fs = require('fs');
const path = require('path');

class SimpleLogger {
    constructor() {
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.logToFile = process.env.LOG_TO_FILE === 'true';
        this.logDirectory = process.env.LOG_DIRECTORY || './logs';
        
        // Create logs directory if it doesn't exist
        if (this.logToFile && !fs.existsSync(this.logDirectory)) {
            fs.mkdirSync(this.logDirectory, { recursive: true });
        }
        
        // Log levels
        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
    }

    // Get current timestamp
    getTimestamp() {
        return new Date().toISOString();
    }

    // Check if message should be logged based on level
    shouldLog(level) {
        return this.levels[level] <= this.levels[this.logLevel];
    }

    // Format log message
    formatMessage(level, message, data = null) {
        const timestamp = this.getTimestamp();
        let formatted = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        
        if (data) {
            formatted += `\n${JSON.stringify(data, null, 2)}`;
        }
        
        return formatted;
    }

    // Write to file
    writeToFile(level, message, data = null) {
        if (!this.logToFile) return;
        
        try {
            const logFile = path.join(this.logDirectory, `${level}.log`);
            const formatted = this.formatMessage(level, message, data);
            fs.appendFileSync(logFile, formatted + '\n');
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    // Error logging
    error(message, data = null) {
        if (!this.shouldLog('error')) return;
        
        const formatted = this.formatMessage('error', message, data);
        console.error(formatted);
        this.writeToFile('error', message, data);
    }

    // Warning logging
    warn(message, data = null) {
        if (!this.shouldLog('warn')) return;
        
        const formatted = this.formatMessage('warn', message, data);
        console.warn(formatted);
        this.writeToFile('warn', message, data);
    }

    // Info logging
    info(message, data = null) {
        if (!this.shouldLog('info')) return;
        
        const formatted = this.formatMessage('info', message, data);
        console.log(formatted);
        this.writeToFile('info', message, data);
    }

    // Debug logging
    debug(message, data = null) {
        if (!this.shouldLog('debug')) return;
        
        const formatted = this.formatMessage('debug', message, data);
        console.log(formatted);
        this.writeToFile('debug', message, data);
    }

    // Success logging (alias for info with green color indicator)
    success(message, data = null) {
        if (!this.shouldLog('info')) return;
        
        const formatted = this.formatMessage('success', message, data);
        console.log(formatted);
        this.writeToFile('info', message, data);
    }

    // Event logging (alias for debug)
    event(eventName, message, data = null) {
        this.debug(`[${eventName}] ${message}`, data);
    }
}

module.exports = new SimpleLogger();
