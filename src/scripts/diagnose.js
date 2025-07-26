const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger.js');
const config = require('../config/config.js');

/**
 * Bot Diagnostic Script
 * Comprehensive system diagnostics and health checks
 */
class BotDiagnostics {
    constructor() {
        this.results = {
            system: {},
            discord: {},
            files: {},
            config: {},
            performance: {}
        };
    }

    /**
     * Run system diagnostics
     */
    async runSystemDiagnostics() {
        logger.info('🔍 Running system diagnostics...');

        // Node.js version
        this.results.system.nodeVersion = process.version;
        this.results.system.platform = process.platform;
        this.results.system.arch = process.arch;
        this.results.system.pid = process.pid;
        this.results.system.uptime = process.uptime();

        // Memory usage
        const memUsage = process.memoryUsage();
        this.results.system.memory = {
            rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
            external: Math.round(memUsage.external / 1024 / 1024) + ' MB'
        };

        // CPU usage
        const cpuUsage = process.cpuUsage();
        this.results.system.cpu = {
            user: cpuUsage.user,
            system: cpuUsage.system
        };

        logger.success('✅ System diagnostics complete');
    }

    /**
     * Test Discord connection
     */
    async testDiscordConnection() {
        logger.info('🔍 Testing Discord connection...');

        try {
            const client = new Client({
                intents: config.bot.intents.map(intent => GatewayIntentBits[intent])
            });

            const connectionPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout (30 seconds)'));
                }, 30000);

                client.once('ready', () => {
                    clearTimeout(timeout);
                    resolve(client);
                });

                client.once('error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });

            client.login(config.bot.token);
            const readyClient = await connectionPromise;

            this.results.discord = {
                connected: true,
                botTag: readyClient.user.tag,
                botId: readyClient.user.id,
                guilds: readyClient.guilds.cache.size,
                users: readyClient.users.cache.size,
                channels: readyClient.channels.cache.size,
                ping: readyClient.ws.ping,
                readyAt: readyClient.readyAt
            };

            await readyClient.destroy();
            logger.success('✅ Discord connection test passed');

        } catch (error) {
            this.results.discord = {
                connected: false,
                error: error.message
            };
            logger.error('❌ Discord connection test failed:', error.message);
        }
    }

    /**
     * Check file integrity
     */
    async checkFileIntegrity() {
        logger.info('🔍 Checking file integrity...');

        const requiredFiles = [
            'src/index.js',
            'src/config/config.js',
            'src/utils/logger.js',
            'src/handlers/commandHandler.js',
            'src/handlers/eventHandler.js',
            'package.json',
            '.env.example'
        ];

        const requiredDirectories = [
            'src',
            'src/commands',
            'src/events',
            'src/handlers',
            'src/utils',
            'src/config'
        ];

        this.results.files = {
            requiredFiles: {},
            requiredDirectories: {},
            commands: {},
            events: {}
        };

        // Check required files
        for (const file of requiredFiles) {
            const exists = fs.existsSync(file);
            this.results.files.requiredFiles[file] = {
                exists,
                size: exists ? fs.statSync(file).size : 0
            };
        }

        // Check required directories
        for (const dir of requiredDirectories) {
            const exists = fs.existsSync(dir);
            this.results.files.requiredDirectories[dir] = {
                exists,
                files: exists ? fs.readdirSync(dir).length : 0
            };
        }

        // Check commands
        const commandsPath = 'src/commands';
        if (fs.existsSync(commandsPath)) {
            const categories = fs.readdirSync(commandsPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            for (const category of categories) {
                const categoryPath = path.join(commandsPath, category);
                const commands = fs.readdirSync(categoryPath)
                    .filter(file => file.endsWith('.js'));
                
                this.results.files.commands[category] = commands.length;
            }
        }

        // Check events
        const eventsPath = 'src/events';
        if (fs.existsSync(eventsPath)) {
            const events = fs.readdirSync(eventsPath)
                .filter(file => file.endsWith('.js'));
            
            this.results.files.events.count = events.length;
            this.results.files.events.files = events;
        }

        logger.success('✅ File integrity check complete');
    }

    /**
     * Validate configuration
     */
    async validateConfiguration() {
        logger.info('🔍 Validating configuration...');

        this.results.config = {
            valid: true,
            errors: [],
            warnings: []
        };

        try {
            // Check bot configuration
            if (!config.bot) {
                this.results.config.errors.push('Missing bot configuration');
                this.results.config.valid = false;
            } else {
                if (!config.bot.token) {
                    this.results.config.errors.push('Missing bot token');
                    this.results.config.valid = false;
                }
                if (!config.bot.clientId) {
                    this.results.config.errors.push('Missing client ID');
                    this.results.config.valid = false;
                }
                if (!config.bot.intents || !Array.isArray(config.bot.intents)) {
                    this.results.config.errors.push('Invalid intents configuration');
                    this.results.config.valid = false;
                }
            }

            // Check environment variables
            const envVars = ['DISCORD_TOKEN', 'CLIENT_ID'];
            for (const envVar of envVars) {
                if (!process.env[envVar]) {
                    this.results.config.warnings.push(`Missing environment variable: ${envVar}`);
                }
            }

        } catch (error) {
            this.results.config.errors.push(`Configuration error: ${error.message}`);
            this.results.config.valid = false;
        }

        logger.success('✅ Configuration validation complete');
    }

    /**
     * Run performance tests
     */
    async runPerformanceTests() {
        logger.info('🔍 Running performance tests...');

        const startTime = process.hrtime.bigint();

        // Test file I/O performance
        const testFile = 'temp_perf_test.txt';
        const testData = 'x'.repeat(1024); // 1KB of data

        try {
            // Write test
            const writeStart = process.hrtime.bigint();
            fs.writeFileSync(testFile, testData);
            const writeTime = Number(process.hrtime.bigint() - writeStart) / 1000000;

            // Read test
            const readStart = process.hrtime.bigint();
            fs.readFileSync(testFile);
            const readTime = Number(process.hrtime.bigint() - readStart) / 1000000;

            // Cleanup
            fs.unlinkSync(testFile);

            this.results.performance = {
                fileIO: {
                    writeTime: `${writeTime.toFixed(2)}ms`,
                    readTime: `${readTime.toFixed(2)}ms`
                }
            };

        } catch (error) {
            this.results.performance.fileIO = {
                error: error.message
            };
        }

        // Test JSON parsing performance
        const jsonData = JSON.stringify({ test: 'data', array: new Array(1000).fill('test') });
        const jsonStart = process.hrtime.bigint();
        JSON.parse(jsonData);
        const jsonTime = Number(process.hrtime.bigint() - jsonStart) / 1000000;

        this.results.performance.jsonParsing = `${jsonTime.toFixed(2)}ms`;

        const totalTime = Number(process.hrtime.bigint() - startTime) / 1000000;
        this.results.performance.totalTestTime = `${totalTime.toFixed(2)}ms`;

        logger.success('✅ Performance tests complete');
    }

    /**
     * Generate diagnostic report
     */
    generateReport() {
        logger.info('\n📋 Bot Diagnostic Report');
        logger.info('='.repeat(60));

        // System Information
        logger.info('\n🖥️ SYSTEM INFORMATION:');
        logger.info(`Node.js Version: ${this.results.system.nodeVersion}`);
        logger.info(`Platform: ${this.results.system.platform} (${this.results.system.arch})`);
        logger.info(`Process ID: ${this.results.system.pid}`);
        logger.info(`Uptime: ${Math.round(this.results.system.uptime)}s`);
        logger.info(`Memory Usage: ${this.results.system.memory.heapUsed} / ${this.results.system.memory.heapTotal}`);

        // Discord Connection
        logger.info('\n🤖 DISCORD CONNECTION:');
        if (this.results.discord.connected) {
            logger.success(`✅ Connected as ${this.results.discord.botTag}`);
            logger.info(`Bot ID: ${this.results.discord.botId}`);
            logger.info(`Guilds: ${this.results.discord.guilds}`);
            logger.info(`Users: ${this.results.discord.users}`);
            logger.info(`Channels: ${this.results.discord.channels}`);
            logger.info(`Ping: ${this.results.discord.ping}ms`);
        } else {
            logger.error(`❌ Connection failed: ${this.results.discord.error}`);
        }

        // File Integrity
        logger.info('\n📁 FILE INTEGRITY:');
        const missingFiles = Object.entries(this.results.files.requiredFiles)
            .filter(([file, info]) => !info.exists);
        
        if (missingFiles.length === 0) {
            logger.success('✅ All required files present');
        } else {
            logger.error(`❌ Missing files: ${missingFiles.map(([file]) => file).join(', ')}`);
        }

        // Commands and Events
        const totalCommands = Object.values(this.results.files.commands).reduce((sum, count) => sum + count, 0);
        logger.info(`Commands: ${totalCommands} total across ${Object.keys(this.results.files.commands).length} categories`);
        logger.info(`Events: ${this.results.files.events.count || 0} handlers`);

        // Configuration
        logger.info('\n⚙️ CONFIGURATION:');
        if (this.results.config.valid) {
            logger.success('✅ Configuration valid');
        } else {
            logger.error(`❌ Configuration errors: ${this.results.config.errors.join(', ')}`);
        }

        if (this.results.config.warnings.length > 0) {
            logger.warn(`⚠️ Warnings: ${this.results.config.warnings.join(', ')}`);
        }

        // Performance
        logger.info('\n⚡ PERFORMANCE:');
        if (this.results.performance.fileIO && !this.results.performance.fileIO.error) {
            logger.info(`File I/O: Write ${this.results.performance.fileIO.writeTime}, Read ${this.results.performance.fileIO.readTime}`);
        }
        logger.info(`JSON Parsing: ${this.results.performance.jsonParsing}`);
        logger.info(`Total Test Time: ${this.results.performance.totalTestTime}`);

        // Overall Status
        logger.info('\n📊 OVERALL STATUS:');
        const isHealthy = this.results.discord.connected && 
                         this.results.config.valid && 
                         missingFiles.length === 0;

        if (isHealthy) {
            logger.success('🎉 Bot is healthy and ready to run!');
        } else {
            logger.error('💥 Bot has issues that need to be addressed');
        }

        return {
            healthy: isHealthy,
            results: this.results
        };
    }

    /**
     * Run all diagnostics
     */
    async runDiagnostics() {
        logger.info('🚀 Starting bot diagnostics...\n');

        await this.runSystemDiagnostics();
        await this.testDiscordConnection();
        await this.checkFileIntegrity();
        await this.validateConfiguration();
        await this.runPerformanceTests();

        return this.generateReport();
    }
}

/**
 * Main execution
 */
async function main() {
    const diagnostics = new BotDiagnostics();
    const result = await diagnostics.runDiagnostics();
    
    // Exit with error code if unhealthy
    if (!result.healthy) {
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        logger.error('Diagnostics failed:', error);
        process.exit(1);
    });
}

module.exports = BotDiagnostics;
