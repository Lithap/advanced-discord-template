// Server-optimized entry point
require('dotenv').config();

console.log('🚀 Starting Discord Bot on Server...');
console.log('Node.js version:', process.version);
console.log('Environment:', process.env.NODE_ENV || 'production');

// Import the application
const Application = require('./src/core/Application.js');

async function startBot() {
    try {
        console.log('📦 Creating application instance...');
        const app = new Application();
        
        console.log('⚡ Initializing bot...');
        await app.initialize();
        
        console.log('🎉 Bot started successfully!');
        console.log('Bot is now running and ready to receive commands.');
        
        // Keep the process alive
        process.on('SIGINT', () => {
            console.log('🛑 Received SIGINT, shutting down gracefully...');
            process.exit(0);
        });
        
        process.on('SIGTERM', () => {
            console.log('🛑 Received SIGTERM, shutting down gracefully...');
            process.exit(0);
        });
        
    } catch (error) {
        console.error('💥 Failed to start bot:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Start the bot
startBot();
