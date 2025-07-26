const logger = require('../utils/simple-logger.js');
const embedBuilder = require('../utils/embedBuilder.js');
const config = require('../config/config.js');

module.exports = {
    name: 'interactionCreate',
    async execute(client, interaction) {
        console.log('🔄 Interaction received:', interaction?.type, interaction?.commandName || interaction?.customId);
        console.log('🔄 Client exists:', !!client);
        console.log('🔄 Interaction exists:', !!interaction);

        if (!interaction) {
            console.error('💥 No interaction object received');
            return;
        }

        logger.debug('Interaction received:', {
            type: interaction.type,
            commandName: interaction.commandName,
            user: interaction.user?.tag,
            guild: interaction.guild?.name
        });
        // Check if bot is in maintenance mode
        if (config.features.maintenance && interaction.user.id !== config.bot.ownerId) {
            const embed = embedBuilder.warning(
                'Maintenance Mode',
                'The bot is currently under maintenance. Please try again later.'
            );
            
            if (interaction.isRepliable()) {
                return await interaction.reply({ embeds: [embed], flags: 64 });
            }
            return;
        }

        try {
            // Handle different interaction types
            if (interaction.isChatInputCommand()) {
                console.log('⚡ Handling slash command:', interaction.commandName);
                await client.commandHandler.handleSlashCommand(interaction);
            } else if (interaction.isContextMenuCommand()) {
                await client.interactionHandler.handleContextMenuInteraction(interaction);
            } else if (interaction.isButton()) {
                await client.interactionHandler.handleButtonInteraction(interaction);
            } else if (interaction.isAnySelectMenu()) {
                await client.interactionHandler.handleSelectMenuInteraction(interaction);
            } else if (interaction.isModalSubmit()) {
                await client.interactionHandler.handleModalInteraction(interaction);
            } else if (interaction.isAutocomplete()) {
                await client.interactionHandler.handleAutocompleteInteraction(interaction);
            }
        } catch (error) {
            console.error('💥 Error handling interaction:', error);
            logger.error('Error handling interaction:', error);
            
            const embed = embedBuilder.error(
                'Interaction Error',
                'An unexpected error occurred while processing your interaction.'
            );

            try {
                if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                    await interaction.reply({ embeds: [embed], flags: 64 });
                }
            } catch (followUpError) {
                // Don't log interaction already acknowledged errors
                if (followUpError.code !== 40060) {
                    logger.error('Error sending error message:', followUpError);
                }
            }
        }
    }
};




