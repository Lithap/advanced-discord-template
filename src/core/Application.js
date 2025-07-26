const { Client, GatewayIntentBits } = require('discord.js');
const logger = require('../utils/simple-logger.js');
const config = require('../config/config.js');

const CommandHandler = require('../handlers/commandHandler.js');
const EventHandler = require('../handlers/eventHandler.js');
const InteractionHandler = require('../handlers/interactionHandler.js');

const DatabaseService = require('../services/database/DatabaseService.js');

const EnterpriseServiceContainer = require('./EnterpriseServiceContainer.js');
const EventBus = require('./EventBus.js');
const PerformanceMonitor = require('./PerformanceMonitor.js');
const SecurityManager = require('./SecurityManager.js');
const CacheManager = require('./CacheManager.js');
const CircuitBreaker = require('./CircuitBreaker.js');

class Application {
    constructor() {
        this.client = null;
        this.isInitialized = false;
        this.isShuttingDown = false;
        this.startTime = Date.now();

        // Initialize enterprise components with error handling
        try {
            this.container = new EnterpriseServiceContainer();
            this.eventBus = new EventBus();
            this.performanceMonitor = new PerformanceMonitor({
                sampleInterval: 1000,
                anomalyDetection: true,
                predictiveAnalytics: true
            });
            this.securityManager = new SecurityManager({
                quantumResistant: true,
                sidechannelProtection: true,
                threatDetection: true
            });
            this.cacheManager = new CacheManager({
                maxSize: 100000,
                policy: 'arc',
                distributedMode: false
            });
            this.circuitBreaker = new CircuitBreaker({
                name: 'discord-api',
                failureThreshold: 5,
                recoveryTimeout: 30000,
                adaptiveThresholds: true
            });

            console.log('✅ Enterprise components created successfully');
        } catch (error) {
            console.error('⚠️ Error creating enterprise components:', error.message);
            console.log('🔄 Falling back to basic mode...');

            // Create fallback components
            this.container = {
                registerSingleton: () => this,
                initialize: async () => {},
                getServices: () => [],
                getMetrics: () => ({}),
                dispose: async () => {}
            };
            this.eventBus = new (require('events').EventEmitter)();
            this.eventBus.getStats = () => ({});
            this.performanceMonitor = {
                start: async () => {},
                stop: async () => {},
                getStats: () => ({}),
                on: () => {}
            };
            this.securityManager = { on: () => {} };
            this.cacheManager = {
                start: async () => {},
                shutdown: async () => {},
                getStats: () => ({})
            };
            this.circuitBreaker = {
                shutdown: async () => {},
                getStats: () => ({}),
                on: () => {}
            };
        }

        // Handler instances will be created after client is ready
        this.commandHandler = null;
        this.eventHandler = null;
        this.interactionHandler = null;

        // Service instances
        this.databaseService = null;

        // Bind shutdown handlers
        this.setupGracefulShutdown();

        // Initialize enterprise monitoring
        this.initializeEnterpriseMonitoring();
    }

    /**
     * Initialize the application
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        try {
            console.log('🚀 Starting Quantum Discord Bot...');
            logger.info('🚀 Starting Quantum Discord Bot...');

            // Validate configuration
            console.log('🔍 Validating configuration...');
            await this.validateConfiguration();

            // Initialize enterprise components
            console.log('🏢 Initializing enterprise components...');
            await this.initializeEnterpriseComponents();

            // Initialize database (non-blocking)
            console.log('🗄️ Initializing database...');
            await this.initializeDatabase();

            // Create Discord client
            console.log('🤖 Creating Discord client...');
            await this.createDiscordClient();

            // Load commands and events
            console.log('⚡ Loading commands...');
            await this.loadCommands();

            console.log('📡 Loading events...');
            await this.loadEvents();

            // Connect to Discord
            console.log('🌐 Connecting to Discord...');
            await this.connectToDiscord();

            this.isInitialized = true;
            console.log('🌌 Quantum Discord Bot initialized successfully!');
            logger.success('🌌 Quantum Discord Bot initialized successfully!');

        } catch (error) {
            console.error('💥 Failed to initialize application:', error);
            logger.error('💥 Failed to initialize application:', error);
            throw error;
        }
    }

    /**
     * Validate configuration
     */
    async validateConfiguration() {
        logger.debug('🔍 Validating configuration...');

        if (!config.bot?.token) {
            throw new Error('Discord token is required');
        }

        if (!config.bot?.clientId) {
            throw new Error('Client ID is required');
        }

        if (!config.bot?.intents || !Array.isArray(config.bot.intents)) {
            throw new Error('Bot intents must be an array');
        }

        logger.debug('✅ Configuration validation passed');
    }

    /**
     * Initialize enterprise monitoring and analytics
     */
    initializeEnterpriseMonitoring() {
        try {
            // Setup performance monitoring
            if (this.performanceMonitor && typeof this.performanceMonitor.on === 'function') {
                this.performanceMonitor.on('anomaly', (anomaly) => {
                    logger.warn('🚨 Performance anomaly detected:', anomaly);
                    if (this.eventBus && typeof this.eventBus.emit === 'function') {
                        this.eventBus.emit('performance.anomaly', anomaly);
                    }
                });
            }

            // Setup security monitoring
            if (this.securityManager && typeof this.securityManager.on === 'function') {
                this.securityManager.on('threat', (threat) => {
                    logger.error('🛡️ Security threat detected:', threat);
                    if (this.eventBus && typeof this.eventBus.emit === 'function') {
                        this.eventBus.emit('security.threat', threat);
                    }
                });
            }

            // Setup circuit breaker monitoring
            if (this.circuitBreaker && typeof this.circuitBreaker.on === 'function') {
                this.circuitBreaker.on('open', () => {
                    logger.warn('⚡ Circuit breaker opened - API calls suspended');
                    if (this.eventBus && typeof this.eventBus.emit === 'function') {
                        this.eventBus.emit('circuit.breaker.open');
                    }
                });

                this.circuitBreaker.on('halfOpen', () => {
                    logger.info('🔄 Circuit breaker half-open - testing API calls');
                    if (this.eventBus && typeof this.eventBus.emit === 'function') {
                        this.eventBus.emit('circuit.breaker.halfOpen');
                    }
                });

                this.circuitBreaker.on('close', () => {
                    logger.success('✅ Circuit breaker closed - API calls resumed');
                    if (this.eventBus && typeof this.eventBus.emit === 'function') {
                        this.eventBus.emit('circuit.breaker.close');
                    }
                });
            }

            logger.debug('🏢 Enterprise monitoring initialized');
        } catch (error) {
            logger.warn('⚠️ Enterprise monitoring initialization error:', error.message);
        }
    }

    /**
     * Initialize enterprise components
     */
    async initializeEnterpriseComponents() {
        console.log('🏗️ Starting enterprise service container...');
        logger.info('🏗️ Starting enterprise service container...');

        try {
            // Register core services in container
            this.container.registerSingleton('eventBus', () => this.eventBus);
            this.container.registerSingleton('performanceMonitor', () => this.performanceMonitor);
            this.container.registerSingleton('securityManager', () => this.securityManager);
            this.container.registerSingleton('cacheManager', () => this.cacheManager);
            this.container.registerSingleton('circuitBreaker', () => this.circuitBreaker);
            this.container.registerSingleton('logger', () => logger);
            this.container.registerSingleton('config', () => config);

            // Initialize container
            await this.container.initialize();

            // Start performance monitoring
            console.log('📊 Starting performance monitoring...');
            if (this.performanceMonitor && typeof this.performanceMonitor.start === 'function') {
                await this.performanceMonitor.start();
            }

            // Start cache manager
            console.log('💾 Starting cache manager...');
            if (this.cacheManager && typeof this.cacheManager.start === 'function') {
                await this.cacheManager.start();
            }

            console.log('✅ Enterprise components initialized');
            logger.success('✅ Enterprise components initialized');
        } catch (error) {
            console.log('⚠️ Some enterprise components failed to initialize:', error.message);
            logger.warn('⚠️ Enterprise component initialization error:', error);
            console.log('🔄 Continuing with available components...');
        }
    }





    /**
     * Initialize database service
     */
    async initializeDatabase() {
        console.log('🗄️ Setting up database connection...');
        logger.debug('🗄️ Setting up database connection...');

        // Debug database configuration
        console.log('🔍 Database URL:', config.database?.url ? 'Set' : 'Not set');
        console.log('🔍 Database config:', JSON.stringify({
            ...config.database,
            url: config.database?.url ? config.database.url.replace(/:[^:@]*@/, ':****@') : 'Not set'
        }, null, 2));

        try {
            this.databaseService = new DatabaseService(config);
            await this.databaseService.connect();

            console.log('✅ Database initialized successfully');
            logger.debug('✅ Database initialized successfully');
        } catch (error) {
            console.error('💥 Error initializing database:', error.message);
            logger.error('💥 Error initializing database:', error);

            // Don't crash the bot, just continue without database
            console.log('⚠️ Continuing without database connection...');
            this.databaseService = null;
        }
    }

    /**
     * Create Discord client
     */
    async createDiscordClient() {
        logger.debug('🤖 Creating Discord client...');

        this.client = new Client({
            intents: config.bot.intents.map(intent => GatewayIntentBits[intent]),
            presence: config.bot.presence || {
                status: 'online',
                activities: [{
                    name: 'with quantum mechanics',
                    type: 0 // PLAYING
                }]
            }
        });

        // Store application reference for backward compatibility (use different property name)
        this.client.app = this;

        // Create handler instances
        this.commandHandler = new CommandHandler(this.client);
        this.eventHandler = new EventHandler(this.client);
        this.interactionHandler = new InteractionHandler(this.client);

        // Attach handlers and services to client for interaction handling
        this.client.commandHandler = this.commandHandler;
        this.client.eventHandler = this.eventHandler;
        this.client.interactionHandler = this.interactionHandler;
        this.client.databaseService = this.databaseService;

        // Attach enterprise services
        this.client.container = this.container;
        this.client.eventBus = this.eventBus;
        this.client.performanceMonitor = this.performanceMonitor;
        this.client.securityManager = this.securityManager;
        this.client.cacheManager = this.cacheManager;
        this.client.circuitBreaker = this.circuitBreaker;

        logger.debug('✅ Discord client created');
    }

    /**
     * Load commands
     */
    async loadCommands() {
        console.log('⚡ Loading commands...');
        logger.debug('⚡ Loading commands...');
        try {
            await this.commandHandler.loadCommands();
            console.log('✅ Commands loaded successfully');
            logger.debug('✅ Commands loaded successfully');
        } catch (error) {
            console.error('💥 Error loading commands:', error);
            throw error;
        }
    }

    /**
     * Load events
     */
    async loadEvents() {
        console.log('📡 Loading events...');
        logger.debug('📡 Loading events...');
        try {
            await this.eventHandler.loadEvents();
            console.log('✅ Events loaded successfully');
            logger.debug('✅ Events loaded successfully');
        } catch (error) {
            console.error('💥 Error loading events:', error);
            throw error;
        }
    }

    /**
     * Connect to Discord
     */
    async connectToDiscord() {
        logger.info('🌐 Connecting to Discord...');

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout after 30 seconds'));
            }, 30000);

            this.client.once('ready', () => {
                clearTimeout(timeout);
                logger.success(`🎉 Connected as ${this.client.user.tag}!`);
                resolve();
            });

            this.client.once('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });

            this.client.login(config.bot.token);
        });
    }

    /**
     * Setup graceful shutdown handlers
     */
    setupGracefulShutdown() {
        const shutdownHandler = async (signal) => {
            if (this.isShuttingDown) {
                return;
            }

            logger.info(`🛑 Received ${signal}, shutting down gracefully...`);
            this.isShuttingDown = true;

            try {
                // Shutdown Discord client
                if (this.client) {
                    await this.client.destroy();
                    logger.info('🤖 Discord client disconnected');
                }

                // Shutdown database
                if (this.databaseService) {
                    await this.databaseService.disconnect();
                    logger.info('🗄️ Database disconnected');
                }

                // Shutdown enterprise components
                try {
                    if (this.performanceMonitor && typeof this.performanceMonitor.stop === 'function') {
                        await this.performanceMonitor.stop();
                        logger.info('📊 Performance monitor stopped');
                    }
                } catch (error) {
                    logger.warn('Performance monitor shutdown error:', error.message);
                }

                try {
                    if (this.cacheManager && typeof this.cacheManager.shutdown === 'function') {
                        await this.cacheManager.shutdown();
                        logger.info('💾 Cache manager shutdown');
                    }
                } catch (error) {
                    logger.warn('Cache manager shutdown error:', error.message);
                }

                try {
                    if (this.circuitBreaker && typeof this.circuitBreaker.shutdown === 'function') {
                        await this.circuitBreaker.shutdown();
                        logger.info('⚡ Circuit breaker shutdown');
                    }
                } catch (error) {
                    logger.warn('Circuit breaker shutdown error:', error.message);
                }

                try {
                    if (this.container && typeof this.container.dispose === 'function') {
                        await this.container.dispose();
                        logger.info('🏗️ Service container disposed');
                    }
                } catch (error) {
                    logger.warn('Service container disposal error:', error.message);
                }

                logger.success('🌌 Enterprise Discord Bot shutdown complete');
                process.exit(0);
            } catch (error) {
                logger.error('💥 Error during shutdown:', error);
                process.exit(1);
            }
        };

        process.on('SIGINT', shutdownHandler);
        process.on('SIGTERM', shutdownHandler);
        process.on('uncaughtException', (error) => {
            logger.error('💥 Uncaught exception:', error);
            shutdownHandler('uncaughtException');
        });
        process.on('unhandledRejection', (reason, promise) => {
            console.error('💥 Unhandled rejection:', reason);
            logger.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
            shutdownHandler('unhandledRejection');
        });
    }

    /**
     * Get comprehensive application statistics
     */
    getStats() {
        const baseStats = {
            uptime: Date.now() - this.startTime,
            memoryUsage: process.memoryUsage(),
            guildsCount: this.client?.guilds?.cache?.size || 0,
            usersCount: this.client?.users?.cache?.size || 0,
            channelsCount: this.client?.channels?.cache?.size || 0,
            ping: this.client?.ws?.ping || 0
        };

        // Add enterprise metrics
        if (this.performanceMonitor) {
            baseStats.performance = this.performanceMonitor.getStats();
        }

        if (this.cacheManager) {
            baseStats.cache = this.cacheManager.getStats();
        }

        if (this.circuitBreaker) {
            baseStats.circuitBreaker = this.circuitBreaker.getStats();
        }

        if (this.container) {
            baseStats.services = {
                registered: this.container.getServices().length,
                metrics: this.container.getMetrics()
            };
        }

        if (this.eventBus) {
            baseStats.events = this.eventBus.getStats();
        }

        return baseStats;
    }


}

module.exports = Application;
