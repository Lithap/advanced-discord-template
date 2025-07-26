/**
 * Enterprise Configuration Management System
 * Hot-reloading, environment-aware, schema validation, encryption support
 * Features: Multi-source configuration, runtime updates, audit logging
 */
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class AdvancedConfig extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.environment = options.environment || process.env.NODE_ENV || 'development';
        this.configDir = options.configDir || path.join(__dirname, '../config');
        this.secretsDir = options.secretsDir || path.join(__dirname, '../secrets');
        this.hotReload = options.hotReload !== false;
        this.encryptionKey = options.encryptionKey || process.env.CONFIG_ENCRYPTION_KEY;
        
        // Configuration sources (priority order)
        this.sources = [
            'environment',    // Environment variables (highest priority)
            'secrets',        // Encrypted secrets
            'local',          // Local overrides
            'environment-specific', // Environment-specific configs
            'default'         // Default configuration (lowest priority)
        ];
        
        // Configuration cache
        this.cache = new Map();
        this.watchers = new Map();
        this.lastModified = new Map();
        
        // Schema validation
        this.schemas = new Map();
        this.validators = new Map();
        
        // Audit logging
        this.auditLog = [];
        this.maxAuditEntries = 1000;
        
        // Configuration metadata
        this.metadata = {
            loadTime: null,
            sources: {},
            validationErrors: [],
            hotReloadCount: 0
        };
        
        // Initialize
        this.initialize();
    }

    /**
     * Initialize configuration system
     */
    async initialize() {
        try {
            // Load configuration schemas
            await this.loadSchemas();
            
            // Load configuration from all sources
            await this.loadConfiguration();
            
            // Setup hot reloading
            if (this.hotReload) {
                await this.setupHotReloading();
            }
            
            // Validate configuration
            await this.validateConfiguration();
            
            this.metadata.loadTime = new Date();
            this.emit('initialized');
            
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Load configuration schemas
     */
    async loadSchemas() {
        const schemaDir = path.join(this.configDir, 'schemas');
        
        try {
            const files = await fs.readdir(schemaDir);
            
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const schemaPath = path.join(schemaDir, file);
                    const schemaContent = await fs.readFile(schemaPath, 'utf8');
                    const schema = JSON.parse(schemaContent);
                    
                    const schemaName = path.basename(file, '.json');
                    this.schemas.set(schemaName, schema);
                }
            }
        } catch (error) {
            // Schemas are optional
            console.warn('No configuration schemas found:', error.message);
        }
    }

    /**
     * Load configuration from all sources
     */
    async loadConfiguration() {
        const config = {};
        
        // Load in reverse priority order (so higher priority overwrites)
        for (const source of [...this.sources].reverse()) {
            const sourceConfig = await this.loadFromSource(source);
            this.deepMerge(config, sourceConfig);
            
            this.metadata.sources[source] = {
                loaded: true,
                keys: Object.keys(sourceConfig).length,
                lastModified: new Date()
            };
        }
        
        // Cache the merged configuration
        this.cache.set('merged', config);
        
        // Emit configuration loaded event
        this.emit('loaded', config);
    }

    /**
     * Load configuration from specific source
     * @param {string} source - Configuration source
     * @returns {Object} Configuration object
     */
    async loadFromSource(source) {
        switch (source) {
            case 'environment':
                return this.loadFromEnvironment();
            
            case 'secrets':
                return await this.loadFromSecrets();
            
            case 'local':
                return await this.loadFromFile('local.json');
            
            case 'environment-specific':
                return await this.loadFromFile(`${this.environment}.json`);
            
            case 'default':
                return await this.loadFromFile('default.json');
            
            default:
                return {};
        }
    }

    /**
     * Load configuration from environment variables
     * @returns {Object} Environment configuration
     */
    loadFromEnvironment() {
        const config = {};
        
        // Map environment variables to configuration structure
        const envMappings = {
            'DISCORD_TOKEN': 'bot.token',
            'DATABASE_URL': 'database.url',
            'REDIS_URL': 'cache.redis.url',
            'LOG_LEVEL': 'logging.level',
            'NODE_ENV': 'environment',
            'PORT': 'server.port'
        };
        
        for (const [envVar, configPath] of Object.entries(envMappings)) {
            const value = process.env[envVar];
            if (value !== undefined) {
                this.setNestedValue(config, configPath, this.parseValue(value));
            }
        }
        
        // Load all environment variables with specific prefix
        const prefix = 'DBL_';
        for (const [key, value] of Object.entries(process.env)) {
            if (key.startsWith(prefix)) {
                const configKey = key.substring(prefix.length).toLowerCase().replace(/_/g, '.');
                this.setNestedValue(config, configKey, this.parseValue(value));
            }
        }
        
        return config;
    }

    /**
     * Load encrypted secrets
     * @returns {Object} Decrypted secrets
     */
    async loadFromSecrets() {
        if (!this.encryptionKey) {
            return {};
        }
        
        try {
            const secretsFile = path.join(this.secretsDir, 'secrets.enc');
            const encryptedData = await fs.readFile(secretsFile);
            
            return this.decryptSecrets(encryptedData);
        } catch (error) {
            // Secrets file is optional
            return {};
        }
    }

    /**
     * Load configuration from JSON file
     * @param {string} filename - Configuration filename
     * @returns {Object} Configuration object
     */
    async loadFromFile(filename) {
        try {
            const filePath = path.join(this.configDir, filename);
            const content = await fs.readFile(filePath, 'utf8');
            
            // Track file modification time
            const stats = await fs.stat(filePath);
            this.lastModified.set(filename, stats.mtime);
            
            return JSON.parse(content);
        } catch (error) {
            // Configuration files are optional
            return {};
        }
    }

    /**
     * Decrypt secrets using AES-256-GCM
     * @param {Buffer} encryptedData - Encrypted data
     * @returns {Object} Decrypted secrets
     */
    decryptSecrets(encryptedData) {
        const algorithm = 'aes-256-gcm';
        const keyBuffer = Buffer.from(this.encryptionKey, 'hex');
        
        // Extract IV and auth tag
        const iv = encryptedData.subarray(0, 16);
        const authTag = encryptedData.subarray(16, 32);
        const encrypted = encryptedData.subarray(32);
        
        // Decrypt
        const decipher = crypto.createDecipherGCM(algorithm, keyBuffer);
        decipher.setIV(iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encrypted, null, 'utf8');
        decrypted += decipher.final('utf8');
        
        return JSON.parse(decrypted);
    }

    /**
     * Setup hot reloading for configuration files
     */
    async setupHotReloading() {
        const configFiles = [
            'default.json',
            `${this.environment}.json`,
            'local.json'
        ];
        
        for (const filename of configFiles) {
            const filePath = path.join(this.configDir, filename);
            
            try {
                const watcher = fs.watch(filePath, async (eventType) => {
                    if (eventType === 'change') {
                        await this.handleFileChange(filename);
                    }
                });
                
                this.watchers.set(filename, watcher);
            } catch (error) {
                // File doesn't exist, skip watching
            }
        }
    }

    /**
     * Handle configuration file change
     * @param {string} filename - Changed filename
     */
    async handleFileChange(filename) {
        try {
            const filePath = path.join(this.configDir, filename);
            const stats = await fs.stat(filePath);
            
            // Check if file was actually modified
            const lastMod = this.lastModified.get(filename);
            if (lastMod && stats.mtime <= lastMod) {
                return;
            }
            
            // Reload configuration
            await this.loadConfiguration();
            
            this.metadata.hotReloadCount++;
            this.emit('reloaded', { filename, timestamp: new Date() });
            
            this.auditLog.push({
                action: 'hot_reload',
                filename,
                timestamp: new Date(),
                user: 'system'
            });
            
        } catch (error) {
            this.emit('error', error);
        }
    }

    /**
     * Get configuration value
     * @param {string} key - Configuration key (dot notation)
     * @param {*} defaultValue - Default value if key not found
     * @returns {*} Configuration value
     */
    get(key, defaultValue = undefined) {
        const config = this.cache.get('merged') || {};
        const value = this.getNestedValue(config, key);
        
        // Audit access
        this.auditLog.push({
            action: 'get',
            key,
            timestamp: new Date(),
            found: value !== undefined
        });
        
        // Trim audit log if too large
        if (this.auditLog.length > this.maxAuditEntries) {
            this.auditLog.splice(0, this.auditLog.length - this.maxAuditEntries);
        }
        
        return value !== undefined ? value : defaultValue;
    }

    /**
     * Set configuration value (runtime only)
     * @param {string} key - Configuration key
     * @param {*} value - Configuration value
     */
    set(key, value) {
        const config = this.cache.get('merged') || {};
        this.setNestedValue(config, key, value);
        this.cache.set('merged', config);
        
        // Audit change
        this.auditLog.push({
            action: 'set',
            key,
            value: typeof value === 'object' ? '[object]' : value,
            timestamp: new Date(),
            user: 'runtime'
        });
        
        this.emit('changed', { key, value });
    }

    /**
     * Validate configuration against schemas
     */
    async validateConfiguration() {
        const config = this.cache.get('merged') || {};
        const errors = [];
        
        for (const [schemaName, schema] of this.schemas) {
            try {
                const validator = this.getValidator(schemaName, schema);
                const valid = validator(config);
                
                if (!valid) {
                    errors.push({
                        schema: schemaName,
                        errors: validator.errors || []
                    });
                }
            } catch (error) {
                errors.push({
                    schema: schemaName,
                    error: error.message
                });
            }
        }
        
        this.metadata.validationErrors = errors;
        
        if (errors.length > 0) {
            this.emit('validation-error', errors);
        }
    }

    /**
     * Get or create validator for schema
     * @param {string} name - Schema name
     * @param {Object} schema - JSON schema
     * @returns {Function} Validator function
     */
    getValidator(name, schema) {
        if (this.validators.has(name)) {
            return this.validators.get(name);
        }
        
        // Simple validation function (in production, use ajv or similar)
        const validator = (data) => {
            return this.validateAgainstSchema(data, schema);
        };
        
        this.validators.set(name, validator);
        return validator;
    }

    /**
     * Simple schema validation
     * @param {*} data - Data to validate
     * @param {Object} schema - JSON schema
     * @returns {boolean} Is valid
     */
    validateAgainstSchema(data, schema) {
        // Simplified validation - in production use proper JSON schema validator
        if (schema.type && typeof data !== schema.type) {
            return false;
        }
        
        if (schema.required) {
            for (const field of schema.required) {
                if (!(field in data)) {
                    return false;
                }
            }
        }
        
        return true;
    }

    /**
     * Get nested value using dot notation
     * @param {Object} obj - Object to search
     * @param {string} path - Dot notation path
     * @returns {*} Value or undefined
     */
    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : undefined;
        }, obj);
    }

    /**
     * Set nested value using dot notation
     * @param {Object} obj - Object to modify
     * @param {string} path - Dot notation path
     * @param {*} value - Value to set
     */
    setNestedValue(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        
        const target = keys.reduce((current, key) => {
            if (!current[key] || typeof current[key] !== 'object') {
                current[key] = {};
            }
            return current[key];
        }, obj);
        
        target[lastKey] = value;
    }

    /**
     * Parse string value to appropriate type
     * @param {string} value - String value
     * @returns {*} Parsed value
     */
    parseValue(value) {
        // Boolean
        if (value === 'true') return true;
        if (value === 'false') return false;
        
        // Number
        if (/^\d+$/.test(value)) return parseInt(value, 10);
        if (/^\d*\.\d+$/.test(value)) return parseFloat(value);
        
        // JSON
        if (value.startsWith('{') || value.startsWith('[')) {
            try {
                return JSON.parse(value);
            } catch {
                // Not valid JSON, return as string
            }
        }
        
        return value;
    }

    /**
     * Deep merge objects
     * @param {Object} target - Target object
     * @param {Object} source - Source object
     */
    deepMerge(target, source) {
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                if (!target[key]) target[key] = {};
                this.deepMerge(target[key], source[key]);
            } else {
                target[key] = source[key];
            }
        }
    }

    /**
     * Get configuration metadata
     * @returns {Object} Metadata
     */
    getMetadata() {
        return {
            ...this.metadata,
            cacheSize: this.cache.size,
            watchersCount: this.watchers.size,
            auditLogSize: this.auditLog.length
        };
    }

    /**
     * Get audit log
     * @param {number} limit - Maximum entries to return
     * @returns {Array} Audit log entries
     */
    getAuditLog(limit = 100) {
        return this.auditLog.slice(-limit);
    }

    /**
     * Shutdown configuration system
     */
    async shutdown() {
        // Close file watchers
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        
        this.watchers.clear();
        this.cache.clear();
        this.schemas.clear();
        this.validators.clear();
        this.auditLog.length = 0;
        
        this.emit('shutdown');
    }
}

module.exports = AdvancedConfig;
