const logger = require('../utils/logger.js');

module.exports = {
    name: 'messageCreate',
    async execute(client, message) {
        // Ignore bot messages
        if (message.author.bot) return;

        // Basic message processing - no draft system
        logger.debug(`Message received from ${message.author.tag}: ${message.content}`);

        // Add any future message processing logic here
    }
};
