const logger = require('../utils/logger.js');
const embedBuilder = require('../utils/embedBuilder.js');
const { AdvancedComponentBuilder } = require('../utils/componentBuilder.js');
const config = require('../config/config.js');

module.exports = {
    name: 'guildCreate',
    async execute(client, guild) {
        logger.success(`Joined new server: ${guild.name} (${guild.id}) - ${guild.memberCount} members`);

        // Update activity with new server count
        const activityName = config.bot.activity.name.replace('{servers}', client.guilds.cache.size);
        client.user.setActivity(activityName, { type: config.bot.activity.type });

        // Try to send welcome message
        await this.sendWelcomeMessage(guild);

        // Log guild information
        this.logGuildInfo(guild);

        // Emit custom event
        client.emit('guildJoined', guild);
    },

    async sendWelcomeMessage(guild) {
        try {
            // Find the best channel to send welcome message
            const channel = this.findWelcomeChannel(guild);

            if (!channel) {
                logger.debug(`No suitable channel found in ${guild.name} for welcome message`);
                return;
            }

            const embed = embedBuilder.welcome(guild);

            // Add interactive components
            const components = new AdvancedComponentBuilder()
                .createRow()
                .addLinkButton({
                    label: 'GitHub Repository',
                    url: 'https://github.com/Lithap',
                    emoji: '💻'
                })
                .addPrimaryButton('welcome_help', 'Get Started', '🚀')
                .build();

            // Send initial message
            const message = await channel.send({ embeds: [embed], components });

            // Create "animation" effect with progressive updates
            await this.animateWelcomeMessage(message, guild);

            logger.info(`Sent animated welcome message to ${guild.name} in #${channel.name}`);

        } catch (error) {
            logger.error(`Failed to send welcome message to ${guild.name}:`, error);
        }
    },

    async animateWelcomeMessage(message, guild) {
        try {
            // Wait 2 seconds then add a "loading" effect
            await new Promise(resolve => setTimeout(resolve, 2000));

            const loadingEmbed = embedBuilder.createEmbed({ color: '#5865f2' });
            loadingEmbed.setTitle('🔄 Setting up...');
            loadingEmbed.setDescription('Initializing bot features...\n\n████████████████████████ 100%\n\n✅ Setup complete!');

            await message.edit({ embeds: [loadingEmbed] });

            // Wait 1.5 seconds then show final welcome
            await new Promise(resolve => setTimeout(resolve, 1500));

            const finalEmbed = embedBuilder.welcome(guild);
            finalEmbed.addFields({
                name: '✅ Ready to go!',
                value: 'All systems online and ready for action!',
                inline: false
            });

            const components = new AdvancedComponentBuilder()
                .createRow()
                .addLinkButton({
                    label: 'GitHub Repository',
                    url: 'https://github.com/Lithap',
                    emoji: '💻'
                })
                .addPrimaryButton('welcome_help', 'Get Started', '🚀')
                .build();

            await message.edit({ embeds: [finalEmbed], components });

        } catch (error) {
            logger.error(`Failed to animate welcome message:`, error);
        }
    },

    findWelcomeChannel(guild) {
        // Priority order for welcome channels
        const channelNames = [
            'general', 'welcome', 'bot-commands', 'commands', 
            'main', 'chat', 'lobby', 'lounge'
        ];
        
        // First try system channel
        if (guild.systemChannel && guild.systemChannel.permissionsFor(guild.members.me).has(['SendMessages', 'EmbedLinks'])) {
            return guild.systemChannel;
        }
        
        // Try to find channel by name
        for (const name of channelNames) {
            const channel = guild.channels.cache.find(ch => 
                ch.name.toLowerCase().includes(name) && 
                ch.type === 0 && // Text channel
                ch.permissionsFor(guild.members.me).has(['SendMessages', 'EmbedLinks'])
            );
            
            if (channel) return channel;
        }
        
        // Find first available text channel
        const availableChannel = guild.channels.cache.find(ch => 
            ch.type === 0 && // Text channel
            ch.permissionsFor(guild.members.me).has(['SendMessages', 'EmbedLinks'])
        );
        
        return availableChannel;
    },

    logGuildInfo(guild) {
        const info = {
            name: guild.name,
            id: guild.id,
            memberCount: guild.memberCount,
            owner: guild.ownerId,
            createdAt: guild.createdAt.toISOString(),
            features: guild.features,
            boostLevel: guild.premiumTier,
            boostCount: guild.premiumSubscriptionCount,
            channels: guild.channels.cache.size,
            roles: guild.roles.cache.size,
            emojis: guild.emojis.cache.size
        };
        
        logger.info('New guild information:', info);
    }
};
