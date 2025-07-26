const logger = require('../utils/logger.js');

module.exports = {
    name: 'warn',
    async execute(client, warning) {
        logger.warn('Discord client warning:', warning);
    }
};
