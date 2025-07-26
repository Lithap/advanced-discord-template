require('dotenv').config();

console.log('🚀 Starting DBL Bot Advanced...');

console.log('🔍 Environment check:');
console.log('- DISCORD_TOKEN:', process.env.DISCORD_TOKEN ? 'Set' : 'Not set');
console.log('- DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'Not set');
if (process.env.DATABASE_URL) {
    console.log('- DATABASE_URL starts with:', process.env.DATABASE_URL.substring(0, 20) + '...');
}

const Application = require('./core/Application.js');
const logger = require('./utils/logger.js');

async function main() {
    try {
        console.log('🌌 Starting main function...');
        logger.info(`Starting DBL Bot Advanced... (PID: ${process.pid})`);
        logger.info('Using new modular architecture with service container');

        console.log('📦 Creating application...');
        const app = new Application();

        console.log('⚡ Initializing application...');
        await app.initialize();

        console.log('🚀 Bot is now online and ready!');
        logger.success('🚀 Bot is now online and ready!');

        const stats = app.getStats();
        console.log('📊 Application Stats:', {
            uptime: `${Math.round(stats.uptime / 1000)}s`,
            memory: `${Math.round(stats.memoryUsage.heapUsed / 1024 / 1024)}MB`,
            guilds: stats.guildsCount,
            users: stats.usersCount,
            ping: `${stats.ping}ms`
        });

        logger.info(`📊 Application Stats:`, {
            uptime: `${Math.round(stats.uptime / 1000)}s`,
            memory: `${Math.round(stats.memoryUsage.heapUsed / 1024 / 1024)}MB`,
            guilds: stats.guildsCount,
            users: stats.usersCount,
            ping: `${stats.ping}ms`
        });

    } catch (error) {
        console.error('❌ Failed to start application:', error);
        logger.error('❌ Failed to start application:', error);

        if (error.message.includes('Discord token')) {
            logger.error('💡 Make sure DISCORD_TOKEN is set in your .env file');
        } else if (error.message.includes('intents')) {
            logger.error('💡 Enable required intents in Discord Developer Portal');
        } else if (error.message.includes('database')) {
            logger.error('💡 Check your database configuration');
        }

        process.exit(1);
    }
}

main().catch(error => {
    console.error('💥 Main function failed:', error);
    process.exit(1);
});