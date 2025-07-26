const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const embedBuilder = require('../../utils/embedBuilder.js');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('User Info')
        .setType(ApplicationCommandType.User),
    
    category: 'context',
    
    async execute(interaction) {
        const targetUser = interaction.targetUser;
        const member = interaction.guild?.members.cache.get(targetUser.id);
        
        await interaction.deferReply({ ephemeral: true });
        
        const embed = embedBuilder.createEmbed({
            color: member?.displayHexColor || '#0099ff'
        });
        
        embed.setTitle(`👤 ${targetUser.tag}`);
        embed.setThumbnail(targetUser.displayAvatarURL({ size: 256 }));
        
        // Basic user information
        embed.addFields(
            {
                name: '🆔 User ID',
                value: `\`${targetUser.id}\``,
                inline: true
            },
            {
                name: '📅 Account Created',
                value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`,
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
                        ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
                        : 'Unknown',
                    inline: true
                }
            );
            
            // Boost information
            if (member.premiumSince) {
                embed.addFields({
                    name: '💎 Boosting Since',
                    value: `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`,
                    inline: true
                });
            }
            
            // Top roles (limit to 5)
            const roles = member.roles.cache
                .filter(role => role.id !== interaction.guild.id)
                .sort((a, b) => b.position - a.position)
                .first(5);
            
            if (roles.length > 0) {
                embed.addFields({
                    name: `🎭 Top Roles (${member.roles.cache.size - 1} total)`,
                    value: roles.map(role => role.toString()).join(' '),
                    inline: false
                });
            }
            
            // Key permissions
            const keyPerms = this.getKeyPermissions(member);
            if (keyPerms.length > 0) {
                embed.addFields({
                    name: '🔑 Key Permissions',
                    value: keyPerms.join(', '),
                    inline: false
                });
            }
        }
        
        // User flags (badges)
        const flags = targetUser.flags?.toArray();
        if (flags && flags.length > 0) {
            embed.addFields({
                name: '🏅 Badges',
                value: flags.map(flag => this.formatFlag(flag)).join(' '),
                inline: false
            });
        }
        
        await interaction.editReply({ embeds: [embed] });
    },

    getKeyPermissions(member) {
        const keyPerms = [
            'Administrator',
            'ManageGuild',
            'ManageRoles',
            'ManageChannels',
            'ManageMessages',
            'BanMembers',
            'KickMembers',
            'ModerateMembers'
        ];
        
        return keyPerms.filter(perm => member.permissions.has(perm));
    },

    formatFlag(flag) {
        const flagEmojis = {
            'Staff': '👨‍💼',
            'Partner': '🤝',
            'Hypesquad': '🎉',
            'BugHunterLevel1': '🐛',
            'BugHunterLevel2': '🐛',
            'HypesquadOnlineHouse1': '🟦',
            'HypesquadOnlineHouse2': '🟪',
            'HypesquadOnlineHouse3': '🟩',
            'PremiumEarlySupporter': '⭐',
            'VerifiedDeveloper': '🔧',
            'CertifiedModerator': '🛡️',
            'BotHTTPInteractions': '🤖'
        };
        
        return flagEmojis[flag] || '🏷️';
    }
};
