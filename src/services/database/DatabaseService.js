const mongoose = require('mongoose');
const logger = require('../../utils/simple-logger.js');

class DatabaseService {
    constructor(config) {
        this.config = config;
        this.connection = null;
        this.isConnected = false;
        this.models = new Map();
    }

    /**
     * Connect to the database
     */
    async connect() {
        try {
            if (this.isConnected) {
                return this.connection;
            }

            logger.info('🔌 Connecting to MongoDB...');

            const options = {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
                bufferCommands: false
            };

            this.connection = await mongoose.connect(this.config.database.url, options);
            this.isConnected = true;

            logger.success('✅ Connected to MongoDB successfully');

            // Set up connection event listeners
            this.setupEventListeners();

            return this.connection;
        } catch (error) {
            logger.error('❌ Failed to connect to MongoDB:', error);
            throw error;
        }
    }

    /**
     * Disconnect from the database
     */
    async disconnect() {
        try {
            if (this.connection) {
                await mongoose.disconnect();
                this.isConnected = false;
                this.connection = null;
                logger.info('🔌 Disconnected from MongoDB');
            }
        } catch (error) {
            logger.error('❌ Error disconnecting from MongoDB:', error);
            throw error;
        }
    }

    /**
     * Setup connection event listeners
     */
    setupEventListeners() {
        mongoose.connection.on('connected', () => {
            logger.info('📡 MongoDB connection established');
        });

        mongoose.connection.on('error', (error) => {
            logger.error('❌ MongoDB connection error:', error);
        });

        mongoose.connection.on('disconnected', () => {
            logger.warn('⚠️ MongoDB connection lost');
            this.isConnected = false;
        });

        mongoose.connection.on('reconnected', () => {
            logger.info('🔄 MongoDB reconnected');
            this.isConnected = true;
        });
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            readyState: mongoose.connection.readyState,
            host: mongoose.connection.host,
            port: mongoose.connection.port,
            name: mongoose.connection.name
        };
    }

    /**
     * Get database statistics
     */
    async getStats() {
        try {
            if (!this.isConnected) {
                return { error: 'Not connected to database' };
            }

            const admin = mongoose.connection.db.admin();
            const stats = await admin.serverStatus();
            
            return {
                version: stats.version,
                uptime: stats.uptime,
                connections: stats.connections,
                memory: stats.mem,
                network: stats.network,
                opcounters: stats.opcounters
            };
        } catch (error) {
            logger.error('❌ Error getting database stats:', error);
            return { error: error.message };
        }
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            if (!this.isConnected) {
                return { healthy: false, message: 'Not connected to database' };
            }

            // Simple ping test
            await mongoose.connection.db.admin().ping();
            
            return { 
                healthy: true, 
                message: 'Database is healthy',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('❌ Database health check failed:', error);
            return { 
                healthy: false, 
                message: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Register a model
     */
    registerModel(name, schema) {
        try {
            const model = mongoose.model(name, schema);
            this.models.set(name, model);
            logger.debug(`📋 Registered model: ${name}`);
            return model;
        } catch (error) {
            logger.error(`❌ Failed to register model ${name}:`, error);
            throw error;
        }
    }

    /**
     * Get a registered model
     */
    getModel(name) {
        return this.models.get(name) || mongoose.models[name];
    }

    /**
     * Get all registered models
     */
    getModels() {
        return Array.from(this.models.keys());
    }
}

module.exports = DatabaseService;
