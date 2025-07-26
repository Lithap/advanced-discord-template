const { SlashCommandBuilder } = require('discord.js');
const embedBuilder = require('../../utils/embedBuilder.js');
const { AdvancedComponentBuilder } = require('../../utils/componentBuilder.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Shows all available commands')
        .addStringOption(option =>
            option.setName('command')
                .setDescription('Get detailed help for a specific command')
                .setRequired(false)
                .setAutocomplete(true)
        ),
    
    category: 'general',
    cooldown: 3,
    
    async execute(interaction) {
        const commandName = interaction.options.getString('command');
        
        if (commandName) {
            return await this.showCommandHelp(interaction, commandName);
        }
        
        return await this.showGeneralHelp(interaction);
    },

    async showCommandHelp(interaction, commandName) {
        const command = interaction.client.commandHandler.getCommand(commandName);
        
        if (!command) {
            const embed = embedBuilder.error('Command Not Found', `No command found with the name \`${commandName}\`.`);
            return await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const embed = embedBuilder.helpCommand(command);

        // Add action buttons using advanced component builder
        const components = new AdvancedComponentBuilder()
            .createRow()
            .addSecondaryButton('back_help', 'Back to Help', '⬅️')
            .addDeleteButton('delete_help')
            .build();

        await interaction.reply({ embeds: [embed], components });
    },

    async showGeneralHelp(interaction) {
        const commandHandler = interaction.client.commandHandler;
        const categories = commandHandler.getCategories();

        const embed = embedBuilder.createEmbed({
            color: '#5865f2' // Discord blurple
        });

        embed.setTitle('🤖 DBL Bot Help');
        embed.setDescription(`Welcome to DBL Bot! Here are all available commands.\n\n**${commandHandler.commands.size} commands** available • Use \`/help <command>\` for details`);
        embed.setThumbnail(interaction.client.user.displayAvatarURL({ size: 256 }));

        // Add category information
        for (const category of categories) {
            const commands = commandHandler.getCommandsByCategory(category);
            const commandList = commands.map(cmd => `\`/${cmd.data.name}\``).join(', ');

            embed.addFields({
                name: `${this.getCategoryEmoji(category)} ${this.capitalize(category)} (${commands.length})`,
                value: commandList || 'No commands',
                inline: false
            });
        }

        // Add statistics
        embed.addFields(
            { name: '⚡ Commands', value: commandHandler.commands.size.toString(), inline: true },
            { name: '🏠 Servers', value: interaction.client.guilds.cache.size.toString(), inline: true },
            { name: '👥 Users', value: interaction.client.users.cache.size.toString(), inline: true }
        );

        embed.setFooter({
            text: 'DBL Bot • Select category below',
            iconURL: interaction.client.user.displayAvatarURL({ size: 64 })
        });

        embed.setFooter({
            text: '✨ Advanced Discord Bot • Made with Discord.js v14',
            iconURL: interaction.client.user.displayAvatarURL()
        });
        
        // Create components using advanced component builder
        const components = new AdvancedComponentBuilder()
            .createRow()
            .addStringSelect({
                id: 'help_category',
                placeholder: 'Select a category for detailed help',
                options: categories.map(category => ({
                    label: this.capitalize(category),
                    value: category,
                    description: `View ${category} commands`,
                    emoji: this.getCategoryEmoji(category)
                }))
            })
            .createRow()
            .addLinkButton({
                label: 'GitHub Repository',
                url: 'https://github.com/Lithap',
                emoji: '💻'
            })
            .createRow()
            .addPrimaryButton('help_refresh', 'Refresh', '🔄')
            .addSecondaryButton('help_categories', 'All Categories', '📁')
            .addDeleteButton('delete_help')
            .build();

        await interaction.reply({
            embeds: [embed],
            components
        });
    },

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        const commands = interaction.client.commandHandler.commands;
        
        const filtered = Array.from(commands.values())
            .filter(command => command.data.name.startsWith(focusedValue.toLowerCase()))
            .slice(0, 25)
            .map(command => ({
                name: `/${command.data.name} - ${command.data.description}`,
                value: command.data.name
            }));

        await interaction.respond(filtered);
    },

    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    },

    getCategoryEmoji(category) {
        const emojis = {
            general: '📋',
            info: '📊',
            utility: '🔧',
            fun: '🎉',
            moderation: '🛡️',
            music: '🎵',
            admin: '⚙️'
        };
        
        return emojis[category] || '📁';
    }
};
