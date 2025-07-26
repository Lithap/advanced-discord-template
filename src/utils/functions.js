const ms = require('ms');

class UtilityFunctions {
    constructor() {
        this.cooldowns = new Map();
    }

    // Format numbers with commas
    formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // Capitalize first letter
    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    // Truncate text to specified length
    truncate(text, length = 100, suffix = '...') {
        if (text.length <= length) return text;
        return text.substring(0, length - suffix.length) + suffix;
    }

    // Parse time string to milliseconds
    parseTime(timeString) {
        try {
            return ms(timeString);
        } catch (error) {
            return null;
        }
    }

    // Format milliseconds to human readable time
    formatTime(milliseconds) {
        return ms(milliseconds, { long: true });
    }

    // Check if user has permission
    hasPermission(member, permission) {
        if (!member || !member.permissions) return false;
        return member.permissions.has(permission);
    }

    // Check if user is bot owner
    isOwner(userId, config) {
        return userId === config.bot.ownerId;
    }

    // Check if user is in cooldown
    isInCooldown(userId, commandName, cooldownTime) {
        const key = `${userId}-${commandName}`;
        const now = Date.now();
        
        if (this.cooldowns.has(key)) {
            const expirationTime = this.cooldowns.get(key) + cooldownTime;
            
            if (now < expirationTime) {
                const timeLeft = (expirationTime - now) / 1000;
                return { inCooldown: true, timeLeft };
            }
        }
        
        this.cooldowns.set(key, now);
        return { inCooldown: false };
    }

    // Clean expired cooldowns
    cleanCooldowns() {
        const now = Date.now();
        const maxAge = 10 * 60 * 1000; // 10 minutes
        
        for (const [key, timestamp] of this.cooldowns.entries()) {
            if (now - timestamp > maxAge) {
                this.cooldowns.delete(key);
            }
        }
    }

    // Generate random string
    generateRandomString(length = 10) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        return result;
    }

    // Validate Discord ID
    isValidDiscordId(id) {
        return /^\d{17,19}$/.test(id);
    }

    // Validate URL
    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    // Get user mention from ID
    getUserMention(userId) {
        return `<@${userId}>`;
    }

    // Get channel mention from ID
    getChannelMention(channelId) {
        return `<#${channelId}>`;
    }

    // Get role mention from ID
    getRoleMention(roleId) {
        return `<@&${roleId}>`;
    }

    // Parse mentions to get IDs
    parseMention(mention) {
        const userMatch = mention.match(/^<@!?(\d+)>$/);
        if (userMatch) return { type: 'user', id: userMatch[1] };
        
        const channelMatch = mention.match(/^<#(\d+)>$/);
        if (channelMatch) return { type: 'channel', id: channelMatch[1] };
        
        const roleMatch = mention.match(/^<@&(\d+)>$/);
        if (roleMatch) return { type: 'role', id: roleMatch[1] };
        
        return null;
    }

    // Chunk array into smaller arrays
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    // Shuffle array
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    // Get random element from array
    getRandomElement(array) {
        return array[Math.floor(Math.random() * array.length)];
    }

    // Deep clone object
    deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    // Check if object is empty
    isEmpty(obj) {
        return Object.keys(obj).length === 0;
    }

    // Merge objects deeply
    deepMerge(target, source) {
        const output = { ...target };
        
        if (this.isObject(target) && this.isObject(source)) {
            Object.keys(source).forEach(key => {
                if (this.isObject(source[key])) {
                    if (!(key in target)) {
                        Object.assign(output, { [key]: source[key] });
                    } else {
                        output[key] = this.deepMerge(target[key], source[key]);
                    }
                } else {
                    Object.assign(output, { [key]: source[key] });
                }
            });
        }
        
        return output;
    }

    // Check if value is object
    isObject(item) {
        return item && typeof item === 'object' && !Array.isArray(item);
    }

    // Escape markdown
    escapeMarkdown(text) {
        return text.replace(/([*_`~\\])/g, '\\$1');
    }

    // Clean code blocks
    cleanCodeBlock(text) {
        if (text.startsWith('```') && text.endsWith('```')) {
            return text.slice(3, -3);
        }
        if (text.startsWith('`') && text.endsWith('`')) {
            return text.slice(1, -1);
        }
        return text;
    }

    // Get file extension
    getFileExtension(filename) {
        return filename.slice((filename.lastIndexOf('.') - 1 >>> 0) + 2);
    }

    // Format bytes to human readable
    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    // Wait for specified time
    async wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Retry function with exponential backoff
    async retry(fn, maxRetries = 3, baseDelay = 1000) {
        let lastError;
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                
                if (i < maxRetries - 1) {
                    const delay = baseDelay * Math.pow(2, i);
                    await this.wait(delay);
                }
            }
        }
        
        throw lastError;
    }
}

// Export singleton instance
module.exports = new UtilityFunctions();
