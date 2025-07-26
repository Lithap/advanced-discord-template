const { Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/simple-logger.js');
const functions = require('../utils/functions.js');
const embedBuilder = require('../utils/embedBuilder.js');

class CommandHandler {
    constructor(client) {
        this.client = client;
        this.commands = new Collection();
        this.categories = new Collection();
        this.aliases = new Collection();
        this.cooldowns = new Collection();
    }

    // Load all commands from commands directory
    async loadCommands() {
        const commandsPath = path.join(__dirname, '../commands');
        
        if (!fs.existsSync(commandsPath)) {
            logger.warn('Commands directory not found');
            return;
        }

        const categories = fs.readdirSync(commandsPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        // If no categories, load from root commands folder
        if (categories.length === 0) {
            await this.loadCommandsFromDirectory(commandsPath, 'general');
        } else {
            // Load commands from each category
            for (const category of categories) {
                const categoryPath = path.join(commandsPath, category);
                await this.loadCommandsFromDirectory(categoryPath, category);
            }
        }

        logger.success(`Loaded ${this.commands.size} commands across ${this.categories.size} categories`);
    }

    // Load commands from specific directory
    async loadCommandsFromDirectory(dirPath, category) {
        const commandFiles = fs.readdirSync(dirPath).filter(file => file.endsWith('.js'));
        
        if (!this.categories.has(category)) {
            this.categories.set(category, []);
        }

        for (const file of commandFiles) {
            try {
                const filePath = path.join(dirPath, file);
                delete require.cache[require.resolve(filePath)]; // Clear cache for hot reload
                const command = require(filePath);

                // Validate command structure
                if (!this.validateCommand(command, file)) continue;

                // Set category
                command.category = category;

                // Add to collections
                this.commands.set(command.data.name, command);
                this.categories.get(category).push(command.data.name);

                // Handle aliases if they exist
                if (command.aliases) {
                    command.aliases.forEach(alias => {
                        this.aliases.set(alias, command.data.name);
                    });
                }

                logger.debug(`Loaded command: ${command.data.name} (${category})`);
            } catch (error) {
                logger.error(`Failed to load command ${file}:`, error);
            }
        }
    }

    // Validate command structure
    validateCommand(command, filename) {
        if (!command.data || !command.execute) {
            logger.warn(`Command ${filename} is missing required "data" or "execute" property`);
            return false;
        }

        // Context menu commands have different structure
        if (command.data.type && (command.data.type === 2 || command.data.type === 3)) {
            // Context menu command - only needs name and type
            if (!command.data.name) {
                logger.warn(`Context menu command ${filename} is missing name`);
                return false;
            }
        } else {
            // Slash command - needs name and description
            if (!command.data.name || !command.data.description) {
                logger.warn(`Slash command ${filename} is missing name or description`);
                return false;
            }
        }

        return true;
    }

    // Handle slash command interaction
    async handleSlashCommand(interaction) {
        const command = this.commands.get(interaction.commandName);
        
        if (!command) {
            logger.warn(`Unknown command: ${interaction.commandName}`);
            return;
        }

        try {
            // Check if command is disabled
            if (command.disabled) {
                const embed = embedBuilder.error('Command Disabled', 'This command is currently disabled.');
                return await interaction.reply({ embeds: [embed], flags: 64 });
            }

            // Check permissions
            if (!await this.checkPermissions(interaction, command)) {
                return; // Error already sent in checkPermissions
            }

            // Check cooldown
            if (!await this.checkCooldown(interaction, command)) {
                return; // Error already sent in checkCooldown
            }

            // Execute command
            await command.execute(interaction);
            
            // Log command usage
            logger.command(interaction.user, `/${interaction.commandName}`, interaction.guild);

        } catch (error) {
            logger.error(`Error executing command ${interaction.commandName}:`, error);

            // Only try to respond if the interaction hasn't been handled yet
            try {
                const embed = embedBuilder.error(
                    'Command Error',
                    'There was an error while executing this command!'
                );

                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ embeds: [embed], flags: 64 });
                } else {
                    await interaction.reply({ embeds: [embed], flags: 64 });
                }
            } catch (responseError) {
                // If we can't respond, just log it
                logger.error('Failed to send error response:', responseError.message);
            }
        }
    }

    // Check user permissions
    async checkPermissions(interaction, command) {
        // Owner bypass
        if (functions.isOwner(interaction.user.id, require('../config/config.js'))) {
            return true;
        }

        // Check if command requires permissions
        if (!command.permissions || command.permissions.length === 0) {
            return true;
        }

        // Check if user has required permissions
        const member = interaction.member;
        if (!member) return true; // DM commands

        const missingPermissions = command.permissions.filter(permission => 
            !functions.hasPermission(member, permission)
        );

        if (missingPermissions.length > 0) {
            const embed = embedBuilder.error(
                'Missing Permissions',
                `You need the following permissions to use this command:\n${missingPermissions.join(', ')}`
            );
            
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return false;
        }

        return true;
    }

    // Check command cooldown
    async checkCooldown(interaction, command) {
        if (!command.cooldown) return true;

        const cooldownTime = command.cooldown * 1000; // Convert to milliseconds
        const cooldownCheck = functions.isInCooldown(
            interaction.user.id, 
            command.data.name, 
            cooldownTime
        );

        if (cooldownCheck.inCooldown) {
            const embed = embedBuilder.warning(
                'Command Cooldown',
                `Please wait ${cooldownCheck.timeLeft.toFixed(1)} more seconds before using this command again.`
            );
            
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return false;
        }

        return true;
    }

    // Handle context menu commands
    async handleContextMenu(interaction) {
        const command = this.commands.get(interaction.commandName);

        if (!command) {
            logger.warn(`Unknown context menu command: ${interaction.commandName}`);
            return;
        }

        try {
            // Check permissions for context menu commands too
            if (!await this.checkPermissions(interaction, command)) {
                return;
            }

            // Check cooldown for context menu commands
            if (!await this.checkCooldown(interaction, command)) {
                return;
            }

            await command.execute(interaction);
            logger.command(interaction.user, `[Context] ${interaction.commandName}`, interaction.guild);
        } catch (error) {
            logger.error(`Error executing context menu command ${interaction.commandName}:`, error);

            const embed = embedBuilder.error(
                'Command Error',
                'There was an error while executing this command!'
            );

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [embed], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
    }

    // Get command by name or alias
    getCommand(name) {
        return this.commands.get(name) || this.commands.get(this.aliases.get(name));
    }

    // Get commands by category
    getCommandsByCategory(category) {
        return this.categories.get(category)?.map(name => this.commands.get(name)) || [];
    }

    // Get all categories
    getCategories() {
        return Array.from(this.categories.keys());
    }

    // Reload a specific command
    async reloadCommand(commandName) {
        const command = this.commands.get(commandName);
        if (!command) return false;

        try {
            const commandsPath = path.join(__dirname, '../commands');
            const categoryPath = path.join(commandsPath, command.category);
            const filePath = path.join(categoryPath, `${commandName}.js`);

            delete require.cache[require.resolve(filePath)];
            const newCommand = require(filePath);

            if (!this.validateCommand(newCommand, `${commandName}.js`)) {
                return false;
            }

            newCommand.category = command.category;
            this.commands.set(commandName, newCommand);

            logger.success(`Reloaded command: ${commandName}`);
            return true;
        } catch (error) {
            logger.error(`Failed to reload command ${commandName}:`, error);
            return false;
        }
    }

    // Clean up expired cooldowns periodically
    cleanupCooldowns() {
        functions.cleanCooldowns();
        logger.debug('Cleaned up expired cooldowns');
    }
}

module.exports = CommandHandler;
