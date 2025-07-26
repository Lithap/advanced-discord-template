const { SlashCommandBuilder } = require('discord.js');
const embedBuilder = require('../../utils/embedBuilder.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Shows information about a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to get information about')
                .setRequired(false)
        ),
    
    category: 'info',
    cooldown: 3,
    
    async execute(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const member = interaction.guild?.members.cache.get(targetUser.id);
        
        await interaction.deferReply();
        
        const embed = embedBuilder.createEmbed({
            color: member?.displayHexColor || '#0099ff'
        });
        
        embed.setTitle(`👤 ${targetUser.tag}`);
        embed.setThumbnail(targetUser.displayAvatarURL({ size: 256 }));
        
        // Basic user information
        embed.addFields(
            {
                name: '🆔 User ID',
                value: targetUser.id,
                inline: true
            },
            {
                name: '📅 Account Created',
                value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:F>\n<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`,
                inline: true
            },
            {
                name: '🤖 Bot Account',
                value: targetUser.bot ? 'Yes' : 'No',
                inline: true
            }
        );
        
        // Server-specific information (if in a guild)
        if (member) {
            embed.addFields(
                {
                    name: '📝 Display Name',
                    value: member.displayName,
                    inline: true
                },
                {
                    name: '📅 Joined Server',
                    value: member.joinedAt 
                        ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>\n<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
                        : 'Unknown',
                    inline: true
                }
            );
            
            // Boost information
            if (member.premiumSince) {
                embed.addFields({
                    name: '💎 Boosting Since',
                    value: `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:F>\n<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`,
                    inline: true
                });
            }
            
            // Roles (excluding @everyone)
            const roles = member.roles.cache
                .filter(role => role.id !== interaction.guild.id)
                .sort((a, b) => b.position - a.position)
                .map(role => role.toString())
                .slice(0, 20); // Limit to 20 roles
            
            if (roles.length > 0) {
                embed.addFields({
                    name: `🎭 Roles (${member.roles.cache.size - 1})`,
                    value: roles.join(', ') + (member.roles.cache.size > 21 ? '...' : ''),
                    inline: false
                });
            }
            
            // Permissions (if user has notable permissions)
            const notablePermissions = this.getNotablePermissions(member);
            if (notablePermissions.length > 0) {
                embed.addFields({
                    name: '🔑 Key Permissions',
                    value: notablePermissions.join(', '),
                    inline: false
                });
            }
            
            // Status and activity
            const presence = member.presence;
            if (presence) {
                embed.addFields(
                    {
                        name: '🟢 Status',
                        value: this.formatStatus(presence.status),
                        inline: true
                    }
                );
                
                // Activities
                if (presence.activities.length > 0) {
                    const activity = presence.activities[0];
                    embed.addFields({
                        name: '🎮 Activity',
                        value: this.formatActivity(activity),
                        inline: true
                    });
                }
            }
        }
        
        // User flags (badges)
        const flags = targetUser.flags?.toArray();
        if (flags && flags.length > 0) {
            embed.addFields({
                name: '🏅 Badges',
                value: flags.map(flag => this.formatFlag(flag)).join(', '),
                inline: false
            });
        }
        
        // Avatar information
        if (targetUser.avatar) {
            embed.addFields({
                name: '🖼️ Avatar',
                value: `[PNG](${targetUser.displayAvatarURL({ format: 'png', size: 1024 })}) | [JPG](${targetUser.displayAvatarURL({ format: 'jpg', size: 1024 })}) | [WEBP](${targetUser.displayAvatarURL({ format: 'webp', size: 1024 })})`,
                inline: true
            });
        }
        
        await interaction.editReply({ embeds: [embed] });
    },

    getNotablePermissions(member) {
        const notable = [
            'Administrator',
            'ManageGuild',
            'ManageRoles',
            'ManageChannels',
            'ManageMessages',
            'BanMembers',
            'KickMembers',
            'ModerateMembers'
        ];
        
        return notable.filter(perm => member.permissions.has(perm));
    },

    formatStatus(status) {
        const statusMap = {
            'online': '🟢 Online',
            'idle': '🟡 Idle',
            'dnd': '🔴 Do Not Disturb',
            'offline': '⚫ Offline'
        };
        
        return statusMap[status] || '❓ Unknown';
    },

    formatActivity(activity) {
        const typeMap = {
            0: 'Playing',
            1: 'Streaming',
            2: 'Listening to',
            3: 'Watching',
            5: 'Competing in'
        };
        
        const type = typeMap[activity.type] || 'Unknown';
        return `${type} ${activity.name}`;
    },

    formatFlag(flag) {
        const flagMap = {
            'Staff': '👨‍💼 Discord Staff',
            'Partner': '🤝 Discord Partner',
            'Hypesquad': '🎉 HypeSquad Events',
            'BugHunterLevel1': '🐛 Bug Hunter',
            'BugHunterLevel2': '🐛 Bug Hunter Gold',
            'HypesquadOnlineHouse1': '🏠 HypeSquad Bravery',
            'HypesquadOnlineHouse2': '🏠 HypeSquad Brilliance',
            'HypesquadOnlineHouse3': '🏠 HypeSquad Balance',
            'PremiumEarlySupporter': '⭐ Early Nitro Supporter',
            'VerifiedDeveloper': '🔧 Verified Bot Developer',
            'CertifiedModerator': '🛡️ Certified Moderator',
            'BotHTTPInteractions': '🤖 HTTP Bot'
        };
        
        return flagMap[flag] || flag;
    }
};
