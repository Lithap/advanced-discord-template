const { GatewayIntentBits, Partials, ActivityType } = require('discord.js');
require('dotenv').config();

module.exports = {
    bot: {
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.CLIENT_ID,
        ownerId: process.env.OWNER_ID,
        testGuildId: process.env.TEST_GUILD_ID,

        embedColor: '#0099ff',
        errorColor: '#ff0000',
        successColor: '#00ff00',
        warningColor: '#ffff00',

        activity: {
            name: '/help | {servers} servers | Slash Commands Only',
            type: ActivityType.Watching
        },

        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ],

        partials: [
            Partials.Message,
            Partials.Channel,
            Partials.Reaction,
            Partials.User,
            Partials.GuildMember
        ]
    },

    apis: {
        topgg: {
            token: process.env.TOPGG_TOKEN,
            webhookAuth: process.env.TOPGG_WEBHOOK_AUTH,
            webhookPort: process.env.TOPGG_WEBHOOK_PORT || 3000
        }
    },

    database: {
        url: process.env.DATABASE_URL,
        type: process.env.DATABASE_TYPE || 'mongodb',
        name: process.env.DATABASE_NAME || 'dbl_bot'
    },

    logging: {
        level: process.env.LOG_LEVEL || 'info',
        logToFile: process.env.LOG_TO_FILE === 'true',
        logDirectory: './logs',
        maxSize: process.env.LOG_MAX_SIZE || '100m',
        maxFiles: process.env.LOG_MAX_FILES || '30',
        structured: process.env.LOG_STRUCTURED === 'true',
        elasticsearch: {
            enabled: process.env.ELASTICSEARCH_ENABLED === 'true',
            host: process.env.ELASTICSEARCH_HOST,
            index: process.env.ELASTICSEARCH_INDEX || 'discord-bot-logs'
        }
    },

    // Enterprise Performance Configuration
    performance: {
        monitoring: {
            enabled: process.env.PERFORMANCE_MONITORING !== 'false',
            sampleInterval: parseInt(process.env.PERFORMANCE_SAMPLE_INTERVAL) || 1000,
            historySize: parseInt(process.env.PERFORMANCE_HISTORY_SIZE) || 3600,
            anomalyDetection: process.env.ANOMALY_DETECTION !== 'false',
            predictiveAnalytics: process.env.PREDICTIVE_ANALYTICS === 'true'
        },
        circuitBreaker: {
            enabled: process.env.CIRCUIT_BREAKER_ENABLED !== 'false',
            failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD) || 5,
            recoveryTimeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT) || 30000,
            adaptiveThresholds: process.env.ADAPTIVE_THRESHOLDS !== 'false'
        }
    },

    // Enterprise Security Configuration
    security: {
        quantumResistant: process.env.QUANTUM_RESISTANT_CRYPTO === 'true',
        sidechannelProtection: process.env.SIDECHANNEL_PROTECTION !== 'false',
        threatDetection: process.env.THREAT_DETECTION !== 'false',
        encryption: {
            algorithm: process.env.ENCRYPTION_ALGORITHM || 'aes-256-gcm',
            keyDerivationRounds: parseInt(process.env.KEY_DERIVATION_ROUNDS) || 100000
        },
        rateLimiting: {
            enabled: process.env.RATE_LIMITING !== 'false',
            windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000,
            maxRequests: parseInt(process.env.RATE_LIMIT_MAX) || 100
        }
    },

    // Enterprise Cache Configuration
    cache: {
        enabled: process.env.CACHE_ENABLED !== 'false',
        type: process.env.CACHE_TYPE || 'memory', // memory, redis, hybrid
        maxSize: parseInt(process.env.CACHE_MAX_SIZE) || 100000,
        ttl: parseInt(process.env.CACHE_TTL) || 3600000, // 1 hour
        policy: process.env.CACHE_POLICY || 'arc', // lru, lfu, arc
        redis: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT) || 6379,
            password: process.env.REDIS_PASSWORD,
            db: parseInt(process.env.REDIS_DB) || 0
        }
    },

    // Command Configuration
    commands: {
        globalDeploy: process.env.GLOBAL_DEPLOY === 'true',
        guildDeploy: process.env.GUILD_DEPLOY === 'true',
        deleteUnused: process.env.DELETE_UNUSED_COMMANDS === 'true'
    },

    // Feature Flags
    features: {
        autoStats: process.env.AUTO_STATS !== 'false',
        webhooks: process.env.ENABLE_WEBHOOKS === 'true',
        analytics: process.env.ENABLE_ANALYTICS === 'true',
        maintenance: process.env.MAINTENANCE_MODE === 'true'
    },

    // Rate Limiting
    rateLimits: {
        commands: {
            global: 5, // commands per 10 seconds globally
            user: 3    // commands per 10 seconds per user
        }
    },

    // Embed Templates
    embeds: {
        footer: {
            text: 'Advanced DBL Bot • Cutting-Edge Discord.js v14',
            iconURL: null // Will be set to bot avatar when ready
        },
        author: {
            name: 'Advanced DBL Bot',
            iconURL: null // Will be set to bot avatar when ready
        }
    },

    // Component Configuration
    components: {
        maxButtonsPerRow: 5,
        maxSelectOptions: 25,
        maxActionRows: 5,
        defaultSelectPlaceholder: 'Select an option...',
        confirmationTimeout: 30000, // 30 seconds
        paginationTimeout: 300000   // 5 minutes
    },

    // Advanced Features
    advanced: {
        enableHotReload: process.env.NODE_ENV !== 'production',
        enableMetrics: process.env.ENABLE_METRICS === 'true',
        enableProfiling: process.env.ENABLE_PROFILING === 'true',
        maxCacheSize: parseInt(process.env.MAX_CACHE_SIZE) || 1000,
        componentCacheTimeout: 600000, // 10 minutes
        interactionTimeout: 15000 // 15 seconds
    },

    // Validation
    validate() {
        const required = [
            'DISCORD_TOKEN',
            'CLIENT_ID'
        ];

        const missing = required.filter(key => !process.env[key]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }

        // Validate token format
        if (!process.env.DISCORD_TOKEN.match(/^[A-Za-z0-9._-]+$/)) {
            throw new Error('Invalid Discord token format');
        }

        // Validate client ID format
        if (!process.env.CLIENT_ID.match(/^\d{17,19}$/)) {
            throw new Error('Invalid Client ID format');
        }

        return true;
    }
};
