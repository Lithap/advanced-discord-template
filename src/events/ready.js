const { AutoPoster } = require('@top-gg/sdk');
const cron = require('node-cron');
const logger = require('../utils/logger.js');
const config = require('../config/config.js');

module.exports = {
    name: 'ready',
    once: true,
    async execute(client) {
        logger.success(`${client.user.tag} is online! (PID: ${process.pid})`);
        logger.info(`Serving ${client.guilds.cache.size} servers with ${client.users.cache.size} users`);
        
        // Update config with bot avatar
        config.embeds.footer.iconURL = client.user.displayAvatarURL();
        config.embeds.author.iconURL = client.user.displayAvatarURL();
        
        // Set bot activity
        const activityName = config.bot.activity.name.replace('{servers}', client.guilds.cache.size);
        client.user.setActivity(activityName, { type: config.bot.activity.type });
        
        // Initialize Top.gg AutoPoster if token is provided
        if (config.apis.topgg.token && config.features.autoStats) {
            try {
                const ap = AutoPoster(config.apis.topgg.token, client);
                
                ap.on('posted', (stats) => {
                    logger.success(`Posted stats to Top.gg: ${stats.serverCount} servers`);
                });

                ap.on('error', (error) => {
                    logger.error('Error posting to Top.gg:', error);
                });
                
                logger.info('Top.gg AutoPoster initialized');
            } catch (error) {
                logger.error('Failed to initialize Top.gg AutoPoster:', error);
            }
        } else {
            logger.warn('Top.gg AutoPoster disabled (missing token or feature disabled)');
        }
        
        // Schedule periodic tasks
        this.scheduleTasks(client);
        
        // Clean old logs on startup
        logger.clearOldLogs();
        
        // Log startup completion
        logger.success('Bot startup completed successfully');
        
        // Emit custom ready event for other systems
        client.emit('botReady', client);
    },
    
    scheduleTasks(client) {
        // Update activity every 10 minutes
        cron.schedule('*/10 * * * *', () => {
            const activityName = config.bot.activity.name.replace('{servers}', client.guilds.cache.size);
            client.user.setActivity(activityName, { type: config.bot.activity.type });
            logger.debug('Updated bot activity');
        });
        
        // Clean cooldowns every 5 minutes
        cron.schedule('*/5 * * * *', () => {
            if (client.commandHandler) {
                client.commandHandler.cleanupCooldowns();
            }
        });
        
        // Clean old logs daily at midnight
        cron.schedule('0 0 * * *', () => {
            logger.clearOldLogs();
        });
        
        // Log system stats every hour
        cron.schedule('0 * * * *', () => {
            const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
            logger.info(`System Stats - Memory: ${memoryUsage}MB, Guilds: ${client.guilds.cache.size}, Users: ${client.users.cache.size}`);
        });
        
        logger.info('Scheduled tasks initialized');
    }
};
