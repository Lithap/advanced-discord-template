const { SlashCommandBuilder, ChannelType } = require('discord.js');
const embedBuilder = require('../../utils/embedBuilder.js');
const functions = require('../../utils/functions.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Shows detailed information about the current server'),
    
    category: 'info',
    cooldown: 5,
    
    async execute(interaction) {
        if (!interaction.guild) {
            const embed = embedBuilder.error('Server Only', 'This command can only be used in a server.');
            return await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        await interaction.deferReply();

        const guild = interaction.guild;
        
        // Fetch additional guild data
        const owner = await guild.fetchOwner().catch(() => null);
        
        const embed = embedBuilder.createEmbed({
            color: '#0099ff'
        });
        
        embed.setTitle(`📋 ${guild.name}`);
        embed.setThumbnail(guild.iconURL({ size: 256 }));
        
        if (guild.bannerURL()) {
            embed.setImage(guild.bannerURL({ size: 1024 }));
        }
        
        // Basic information
        embed.addFields(
            {
                name: '🆔 Server ID',
                value: guild.id,
                inline: true
            },
            {
                name: '👑 Owner',
                value: owner ? `${owner.user.tag}\n(${owner.user.id})` : 'Unknown',
                inline: true
            },
            {
                name: '📅 Created',
                value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>\n<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,
                inline: true
            }
        );
        
        // Member statistics
        const members = guild.members.cache;
        const bots = members.filter(member => member.user.bot).size;
        const humans = members.size - bots;
        
        embed.addFields(
            {
                name: '👥 Members',
                value: [
                    `**Total:** ${guild.memberCount}`,
                    `**Humans:** ${humans}`,
                    `**Bots:** ${bots}`
                ].join('\n'),
                inline: true
            }
        );
        
        // Channel statistics
        const channels = guild.channels.cache;
        const textChannels = channels.filter(c => c.type === ChannelType.GuildText).size;
        const voiceChannels = channels.filter(c => c.type === ChannelType.GuildVoice).size;
        const categories = channels.filter(c => c.type === ChannelType.GuildCategory).size;
        
        embed.addFields(
            {
                name: '📺 Channels',
                value: [
                    `**Total:** ${channels.size}`,
                    `**Text:** ${textChannels}`,
                    `**Voice:** ${voiceChannels}`,
                    `**Categories:** ${categories}`
                ].join('\n'),
                inline: true
            }
        );
        
        // Server features
        const features = guild.features.length > 0 
            ? guild.features.map(feature => this.formatFeature(feature)).join(', ')
            : 'None';
        
        embed.addFields(
            {
                name: '✨ Features',
                value: functions.truncate(features, 1024),
                inline: false
            }
        );
        
        // Boost information
        if (guild.premiumTier > 0) {
            embed.addFields(
                {
                    name: '💎 Nitro Boost',
                    value: [
                        `**Level:** ${guild.premiumTier}`,
                        `**Boosts:** ${guild.premiumSubscriptionCount}`,
                        `**Boosters:** ${guild.members.cache.filter(m => m.premiumSince).size}`
                    ].join('\n'),
                    inline: true
                }
            );
        }
        
        // Role information
        embed.addFields(
            {
                name: '🎭 Roles',
                value: `${guild.roles.cache.size} roles`,
                inline: true
            },
            {
                name: '😀 Emojis',
                value: `${guild.emojis.cache.size} emojis`,
                inline: true
            }
        );
        
        // Verification and content filter
        embed.addFields(
            {
                name: '🛡️ Security',
                value: [
                    `**Verification:** ${this.getVerificationLevel(guild.verificationLevel)}`,
                    `**Content Filter:** ${this.getContentFilterLevel(guild.explicitContentFilter)}`,
                    `**MFA Required:** ${guild.mfaLevel ? 'Yes' : 'No'}`
                ].join('\n'),
                inline: false
            }
        );
        
        await interaction.editReply({ embeds: [embed] });
    },

    formatFeature(feature) {
        const featureMap = {
            'ANIMATED_BANNER': 'Animated Banner',
            'ANIMATED_ICON': 'Animated Icon',
            'BANNER': 'Banner',
            'COMMERCE': 'Commerce',
            'COMMUNITY': 'Community',
            'DISCOVERABLE': 'Discoverable',
            'FEATURABLE': 'Featurable',
            'INVITE_SPLASH': 'Invite Splash',
            'MEMBER_VERIFICATION_GATE_ENABLED': 'Member Verification',
            'NEWS': 'News Channels',
            'PARTNERED': 'Partnered',
            'PREVIEW_ENABLED': 'Preview Enabled',
            'VANITY_URL': 'Vanity URL',
            'VERIFIED': 'Verified',
            'VIP_REGIONS': 'VIP Regions',
            'WELCOME_SCREEN_ENABLED': 'Welcome Screen'
        };
        
        return featureMap[feature] || feature.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
    },

    getVerificationLevel(level) {
        const levels = {
            0: 'None',
            1: 'Low',
            2: 'Medium',
            3: 'High',
            4: 'Very High'
        };
        
        return levels[level] || 'Unknown';
    },

    getContentFilterLevel(level) {
        const levels = {
            0: 'Disabled',
            1: 'Members without roles',
            2: 'All members'
        };
        
        return levels[level] || 'Unknown';
    }
};
