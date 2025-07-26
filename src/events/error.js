const logger = require('../utils/logger.js');

module.exports = {
    name: 'error',
    async execute(client, error) {
        logger.error('Discord client error:', error);
        
        // Emit custom event for additional error handling
        client.emit('clientError', error);
    }
};
