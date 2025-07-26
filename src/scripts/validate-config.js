const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger.js');
const config = require('../config/config.js');

/**
 * Configuration Validation Script
 * Validates bot configuration and environment setup
 */
class ConfigValidator {
    constructor() {
        this.errors = [];
        this.warnings = [];
        this.info = [];
    }

    /**
     * Validate environment variables
     */
    validateEnvironment() {
        logger.info('🔍 Validating environment variables...');

        // Required variables
        const required = [
            { key: 'DISCORD_TOKEN', value: process.env.DISCORD_TOKEN, description: 'Discord bot token' },
            { key: 'CLIENT_ID', value: process.env.CLIENT_ID, description: 'Discord application client ID' }
        ];

        // Optional but recommended variables
        const recommended = [
            { key: 'OWNER_ID', value: process.env.OWNER_ID, description: 'Bot owner Discord user ID' },
            { key: 'TEST_GUILD_ID', value: process.env.TEST_GUILD_ID, description: 'Test guild ID for faster command deployment' }
        ];

        // Optional variables
        const optional = [
            { key: 'TOPGG_TOKEN', value: process.env.TOPGG_TOKEN, description: 'Top.gg API token for stats posting' },
            { key: 'TOPGG_WEBHOOK_AUTH', value: process.env.TOPGG_WEBHOOK_AUTH, description: 'Top.gg webhook authorization' },
            { key: 'LOG_LEVEL', value: process.env.LOG_LEVEL, description: 'Logging level (error, warn, info, debug)' }
        ];

        // Check required variables
        for (const variable of required) {
            if (!variable.value) {
                this.errors.push(`❌ Missing required environment variable: ${variable.key} (${variable.description})`);
            } else {
                this.info.push(`✅ ${variable.key}: Set`);
            }
        }

        // Check recommended variables
        for (const variable of recommended) {
            if (!variable.value) {
                this.warnings.push(`⚠️ Missing recommended environment variable: ${variable.key} (${variable.description})`);
            } else {
                this.info.push(`✅ ${variable.key}: Set`);
            }
        }

        // Check optional variables
        for (const variable of optional) {
            if (variable.value) {
                this.info.push(`✅ ${variable.key}: Set`);
            }
        }
    }

    /**
     * Validate configuration structure
     */
    validateConfig() {
        logger.info('🔍 Validating configuration structure...');

        try {
            // Check if config loads without errors
            const configPath = path.join(__dirname, '../config/config.js');
            if (!fs.existsSync(configPath)) {
                this.errors.push('❌ Configuration file not found: src/config/config.js');
                return;
            }

            // Validate config structure
            if (!config.bot) {
                this.errors.push('❌ Missing bot configuration section');
            } else {
                this.info.push('✅ Bot configuration section found');
                
                // Check bot token
                if (!config.bot.token) {
                    this.errors.push('❌ Bot token not configured');
                } else if (config.bot.token.length < 50) {
                    this.warnings.push('⚠️ Bot token appears to be invalid (too short)');
                } else {
                    this.info.push('✅ Bot token configured');
                }

                // Check client ID
                if (!config.bot.clientId) {
                    this.errors.push('❌ Client ID not configured');
                } else if (!/^\d{17,19}$/.test(config.bot.clientId)) {
                    this.warnings.push('⚠️ Client ID format appears invalid');
                } else {
                    this.info.push('✅ Client ID configured');
                }

                // Check intents
                if (!config.bot.intents || !Array.isArray(config.bot.intents)) {
                    this.errors.push('❌ Bot intents not properly configured');
                } else {
                    this.info.push(`✅ Bot intents configured (${config.bot.intents.length} intents)`);
                }
            }

            // Check other sections
            if (config.apis) {
                this.info.push('✅ APIs configuration section found');
            }

            if (config.logging) {
                this.info.push('✅ Logging configuration section found');
            }

            if (config.features) {
                this.info.push('✅ Features configuration section found');
            }

        } catch (error) {
            this.errors.push(`❌ Error loading configuration: ${error.message}`);
        }
    }

    /**
     * Validate file structure
     */
    validateFileStructure() {
        logger.info('🔍 Validating file structure...');

        const requiredFiles = [
            'src/index.js',
            'src/config/config.js',
            'src/utils/logger.js',
            'src/handlers/commandHandler.js',
            'src/handlers/eventHandler.js'
        ];

        const requiredDirectories = [
            'src/commands',
            'src/events',
            'src/handlers',
            'src/utils'
        ];

        // Check required files
        for (const file of requiredFiles) {
            if (fs.existsSync(file)) {
                this.info.push(`✅ Required file found: ${file}`);
            } else {
                this.errors.push(`❌ Missing required file: ${file}`);
            }
        }

        // Check required directories
        for (const dir of requiredDirectories) {
            if (fs.existsSync(dir)) {
                this.info.push(`✅ Required directory found: ${dir}`);
            } else {
                this.errors.push(`❌ Missing required directory: ${dir}`);
            }
        }

        // Check commands directory structure
        const commandsPath = 'src/commands';
        if (fs.existsSync(commandsPath)) {
            const categories = fs.readdirSync(commandsPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            if (categories.length === 0) {
                this.warnings.push('⚠️ No command categories found in src/commands');
            } else {
                this.info.push(`✅ Found ${categories.length} command categories: ${categories.join(', ')}`);
                
                // Count commands in each category
                let totalCommands = 0;
                for (const category of categories) {
                    const categoryPath = path.join(commandsPath, category);
                    const commands = fs.readdirSync(categoryPath)
                        .filter(file => file.endsWith('.js'));
                    totalCommands += commands.length;
                }
                
                this.info.push(`✅ Found ${totalCommands} total commands`);
            }
        }

        // Check events directory
        const eventsPath = 'src/events';
        if (fs.existsSync(eventsPath)) {
            const events = fs.readdirSync(eventsPath)
                .filter(file => file.endsWith('.js'));
            
            if (events.length === 0) {
                this.warnings.push('⚠️ No event handlers found in src/events');
            } else {
                this.info.push(`✅ Found ${events.length} event handlers`);
            }
        }
    }

    /**
     * Validate package.json and dependencies
     */
    validateDependencies() {
        logger.info('🔍 Validating dependencies...');

        try {
            const packagePath = path.join(process.cwd(), 'package.json');
            if (!fs.existsSync(packagePath)) {
                this.errors.push('❌ package.json not found');
                return;
            }

            const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            
            // Check required dependencies
            const requiredDeps = [
                'discord.js',
                'dotenv'
            ];

            const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

            for (const dep of requiredDeps) {
                if (dependencies[dep]) {
                    this.info.push(`✅ Required dependency found: ${dep}@${dependencies[dep]}`);
                } else {
                    this.errors.push(`❌ Missing required dependency: ${dep}`);
                }
            }

            // Check Discord.js version
            if (dependencies['discord.js']) {
                const version = dependencies['discord.js'].replace(/[^\d.]/g, '');
                const majorVersion = parseInt(version.split('.')[0]);
                
                if (majorVersion < 14) {
                    this.warnings.push(`⚠️ Discord.js version ${version} is outdated. Version 14+ recommended.`);
                } else {
                    this.info.push(`✅ Discord.js version ${version} is compatible`);
                }
            }

            this.info.push(`✅ Package.json validation complete`);

        } catch (error) {
            this.errors.push(`❌ Error reading package.json: ${error.message}`);
        }
    }

    /**
     * Generate validation report
     */
    generateReport() {
        logger.info('\n📋 Configuration Validation Report');
        logger.info('='.repeat(50));

        // Show errors
        if (this.errors.length > 0) {
            logger.error(`\n❌ ERRORS (${this.errors.length}):`);
            this.errors.forEach(error => logger.error(error));
        }

        // Show warnings
        if (this.warnings.length > 0) {
            logger.warn(`\n⚠️ WARNINGS (${this.warnings.length}):`);
            this.warnings.forEach(warning => logger.warn(warning));
        }

        // Show info
        if (this.info.length > 0) {
            logger.info(`\n✅ PASSED CHECKS (${this.info.length}):`);
            this.info.forEach(info => logger.info(info));
        }

        // Summary
        logger.info('\n📊 SUMMARY:');
        logger.info(`✅ Passed: ${this.info.length}`);
        logger.warn(`⚠️ Warnings: ${this.warnings.length}`);
        logger.error(`❌ Errors: ${this.errors.length}`);

        if (this.errors.length === 0) {
            logger.success('\n🎉 Configuration validation passed! Your bot should be ready to run.');
        } else {
            logger.error('\n💥 Configuration validation failed! Please fix the errors above before running the bot.');
        }

        return {
            passed: this.errors.length === 0,
            errors: this.errors.length,
            warnings: this.warnings.length,
            info: this.info.length
        };
    }

    /**
     * Run all validations
     */
    async validate() {
        logger.info('🚀 Starting configuration validation...\n');

        this.validateEnvironment();
        this.validateConfig();
        this.validateFileStructure();
        this.validateDependencies();

        return this.generateReport();
    }
}

/**
 * Main execution
 */
async function main() {
    const validator = new ConfigValidator();
    const result = await validator.validate();
    
    // Exit with error code if validation failed
    if (!result.passed) {
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        logger.error('Validation failed:', error);
        process.exit(1);
    });
}

module.exports = ConfigValidator;
