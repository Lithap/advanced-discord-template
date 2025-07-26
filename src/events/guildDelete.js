const logger = require('../utils/logger.js');
const config = require('../config/config.js');

module.exports = {
    name: 'guildDelete',
    async execute(client, guild) {
        logger.warn(`Left server: ${guild.name} (${guild.id}) - ${guild.memberCount} members`);
        
        // Update activity with new server count
        const activityName = config.bot.activity.name.replace('{servers}', client.guilds.cache.size);
        client.user.setActivity(activityName, { type: config.bot.activity.type });
        
        // Log guild information
        this.logGuildInfo(guild);
        
        // Emit custom event
        client.emit('guildLeft', guild);
    },

    logGuildInfo(guild) {
        const info = {
            name: guild.name,
            id: guild.id,
            memberCount: guild.memberCount,
            leftAt: new Date().toISOString()
        };
        
        logger.info('Left guild information:', info);
    }
};
