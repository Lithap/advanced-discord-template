let chalk;
try {
    chalk = require('chalk');
    // Test if chalk is working properly
    if (typeof chalk.red !== 'function') {
        throw new Error('Chalk not working properly');
    }
} catch (error) {
    // Fallback to no-color logging if chalk fails
    chalk = {
        red: (text) => text,
        yellow: (text) => text,
        blue: (text) => text,
        green: (text) => text,
        gray: (text) => text,
        cyan: (text) => text,
        magenta: (text) => text
    };
}

const moment = require('moment');
const fs = require('fs');
const path = require('path');
const config = require('../config/config.js');

class Logger {
    constructor() {
        this.logLevel = config.logging.level;
        this.logToFile = config.logging.logToFile;
        this.logDirectory = config.logging.logDirectory;
        
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
        return moment().format('YYYY-MM-DD HH:mm:ss');
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
        
        const filename = `${moment().format('YYYY-MM-DD')}.log`;
        const filepath = path.join(this.logDirectory, filename);
        const logMessage = this.formatMessage(level, message, data) + '\n';
        
        fs.appendFileSync(filepath, logMessage);
    }

    // Error logging
    error(message, data = null) {
        if (!this.shouldLog('error')) return;
        
        const formatted = this.formatMessage('error', message, data);
        console.log(chalk.red(formatted));
        this.writeToFile('error', message, data);
    }

    // Warning logging
    warn(message, data = null) {
        if (!this.shouldLog('warn')) return;
        
        const formatted = this.formatMessage('warn', message, data);
        console.log(chalk.yellow(formatted));
        this.writeToFile('warn', message, data);
    }

    // Info logging
    info(message, data = null) {
        if (!this.shouldLog('info')) return;
        
        const formatted = this.formatMessage('info', message, data);
        console.log(chalk.blue(formatted));
        this.writeToFile('info', message, data);
    }

    // Debug logging
    debug(message, data = null) {
        if (!this.shouldLog('debug')) return;
        
        const formatted = this.formatMessage('debug', message, data);
        console.log(chalk.gray(formatted));
        this.writeToFile('debug', message, data);
    }

    // Success logging (special info)
    success(message, data = null) {
        if (!this.shouldLog('info')) return;
        
        const formatted = this.formatMessage('success', message, data);
        console.log(chalk.green(formatted));
        this.writeToFile('info', message, data);
    }

    // Command logging
    command(user, command, guild = null) {
        const guildInfo = guild ? ` in ${guild.name} (${guild.id})` : ' in DMs';
        const message = `${user.tag} (${user.id}) used command: ${command}${guildInfo}`;
        this.info(message);
    }

    // Event logging
    event(eventName, message, data = null) {
        const formatted = `[${eventName.toUpperCase()}] ${message}`;
        this.debug(formatted, data);
    }

    // API logging
    api(method, endpoint, status, responseTime = null) {
        const timeInfo = responseTime ? ` (${responseTime}ms)` : '';
        const message = `${method} ${endpoint} - ${status}${timeInfo}`;
        
        if (status >= 400) {
            this.warn(message);
        } else {
            this.debug(message);
        }
    }

    // Database logging
    database(operation, table, data = null) {
        const message = `Database ${operation} on ${table}`;
        this.debug(message, data);
    }

    // Clear old log files (keep last 7 days)
    clearOldLogs() {
        if (!this.logToFile || !fs.existsSync(this.logDirectory)) return;
        
        const files = fs.readdirSync(this.logDirectory);
        const cutoffDate = moment().subtract(7, 'days');
        
        files.forEach(file => {
            const filePath = path.join(this.logDirectory, file);
            const fileDate = moment(file.replace('.log', ''), 'YYYY-MM-DD');
            
            if (fileDate.isBefore(cutoffDate)) {
                fs.unlinkSync(filePath);
                this.debug(`Deleted old log file: ${file}`);
            }
        });
    }
}

// Export singleton instance
module.exports = new Logger();
