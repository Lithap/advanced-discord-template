const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger.js');
const config = require('../config/config.js');

// Initialize REST client
const rest = new REST({ version: '10' }).setToken(config.bot.token);

/**
 * Deploy Commands Script
 * Handles deployment of slash commands to Discord
 */
class CommandDeployer {
    constructor() {
        this.commands = [];
        this.clientId = config.bot.clientId;
        this.guildId = config.bot.testGuildId;
    }

    /**
     * Load all commands from the commands directory
     */
    async loadCommands() {
        const commandsPath = path.join(__dirname, '../commands');
        
        if (!fs.existsSync(commandsPath)) {
            logger.error('Commands directory not found');
            return;
        }

        const categories = fs.readdirSync(commandsPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        for (const category of categories) {
            const categoryPath = path.join(commandsPath, category);
            const commandFiles = fs.readdirSync(categoryPath)
                .filter(file => file.endsWith('.js'));

            for (const file of commandFiles) {
                const filePath = path.join(categoryPath, file);
                try {
                    const command = require(filePath);
                    
                    if ('data' in command && 'execute' in command) {
                        this.commands.push(command.data.toJSON());
                        logger.debug(`Loaded command: ${command.data.name}`);
                    } else {
                        logger.warn(`Command at ${filePath} is missing required "data" or "execute" property`);
                    }
                } catch (error) {
                    logger.error(`Error loading command ${file}:`, error);
                }
            }
        }

        logger.info(`Loaded ${this.commands.length} commands`);
    }

    /**
     * Deploy commands globally
     */
    async deployGlobal() {
        try {
            logger.info('Started refreshing global application (/) commands...');

            const data = await rest.put(
                Routes.applicationCommands(this.clientId),
                { body: this.commands }
            );

            logger.success(`Successfully reloaded ${data.length} global application (/) commands`);
            logger.warn('Global commands may take up to 1 hour to appear in all servers');
        } catch (error) {
            logger.error('Error deploying global commands:', error);
        }
    }

    /**
     * Deploy commands to test guild
     */
    async deployGuild() {
        if (!this.guildId) {
            logger.error('TEST_GUILD_ID not set in environment variables');
            return;
        }

        try {
            logger.info(`Started refreshing guild (${this.guildId}) application (/) commands...`);

            const data = await rest.put(
                Routes.applicationGuildCommands(this.clientId, this.guildId),
                { body: this.commands }
            );

            logger.success(`Successfully reloaded ${data.length} guild application (/) commands`);
        } catch (error) {
            logger.error('Error deploying guild commands:', error);
        }
    }

    /**
     * Clear global commands
     */
    async clearGlobal() {
        try {
            logger.info('Clearing global application (/) commands...');

            const data = await rest.put(
                Routes.applicationCommands(this.clientId),
                { body: [] }
            );

            logger.success('Successfully cleared all global application (/) commands');
        } catch (error) {
            logger.error('Error clearing global commands:', error);
        }
    }

    /**
     * Clear guild commands
     */
    async clearGuild() {
        if (!this.guildId) {
            logger.error('TEST_GUILD_ID not set in environment variables');
            return;
        }

        try {
            logger.info(`Clearing guild (${this.guildId}) application (/) commands...`);

            const data = await rest.put(
                Routes.applicationGuildCommands(this.clientId, this.guildId),
                { body: [] }
            );

            logger.success('Successfully cleared all guild application (/) commands');
        } catch (error) {
            logger.error('Error clearing guild commands:', error);
        }
    }

    /**
     * List current commands
     */
    async listCommands(guildId = null) {
        try {
            const route = guildId 
                ? Routes.applicationGuildCommands(this.clientId, guildId)
                : Routes.applicationCommands(this.clientId);

            const commands = await rest.get(route);
            
            const scope = guildId ? `guild (${guildId})` : 'global';
            logger.info(`Current ${scope} commands (${commands.length}):`);
            
            if (commands.length === 0) {
                logger.info('No commands found');
            } else {
                commands.forEach(cmd => {
                    logger.info(`- /${cmd.name}: ${cmd.description}`);
                });
            }
        } catch (error) {
            logger.error('Error listing commands:', error);
        }
    }

    /**
     * Auto-detect deployment method
     */
    async autoDeploy() {
        if (this.guildId) {
            logger.info('Test guild ID found, deploying to guild for faster updates');
            await this.deployGuild();
        } else {
            logger.info('No test guild ID, deploying globally');
            await this.deployGlobal();
        }
    }
}

/**
 * Main execution
 */
async function main() {
    const deployer = new CommandDeployer();
    
    // Validate configuration
    if (!config.bot.token) {
        logger.error('DISCORD_TOKEN not found in environment variables');
        process.exit(1);
    }
    
    if (!config.bot.clientId) {
        logger.error('CLIENT_ID not found in environment variables');
        process.exit(1);
    }

    // Load commands
    await deployer.loadCommands();
    
    if (deployer.commands.length === 0) {
        logger.warn('No commands found to deploy');
        return;
    }

    // Parse command line arguments
    const args = process.argv.slice(2);
    const command = args[0];
    const guildId = args[1];

    switch (command) {
        case 'global':
            await deployer.deployGlobal();
            break;
        case 'guild':
            await deployer.deployGuild();
            break;
        case 'clear-global':
            await deployer.clearGlobal();
            break;
        case 'clear-guild':
            await deployer.clearGuild();
            break;
        case 'list':
            await deployer.listCommands(guildId);
            break;
        default:
            await deployer.autoDeploy();
            break;
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        logger.error('Deployment failed:', error);
        process.exit(1);
    });
}

module.exports = CommandDeployer;
