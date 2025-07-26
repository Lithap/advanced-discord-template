const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const embedBuilder = require('../../utils/embedBuilder.js');
const { AdvancedComponentBuilder } = require('../../utils/componentBuilder.js');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Message Info')
        .setType(ApplicationCommandType.Message),
    
    category: 'context',
    
    async execute(interaction) {
        const targetMessage = interaction.targetMessage;
        
        await interaction.deferReply({ ephemeral: true });
        
        const embed = embedBuilder.createEmbed({
            color: '#0099ff'
        });
        
        embed.setTitle('📨 Message Information');
        embed.setDescription(`Information about [this message](${targetMessage.url})`);
        
        // Basic message info
        embed.addFields(
            {
                name: '👤 Author',
                value: `${targetMessage.author.tag}\n\`${targetMessage.author.id}\``,
                inline: true
            },
            {
                name: '📅 Created',
                value: `<t:${Math.floor(targetMessage.createdTimestamp / 1000)}:F>\n<t:${Math.floor(targetMessage.createdTimestamp / 1000)}:R>`,
                inline: true
            },
            {
                name: '🆔 Message ID',
                value: `\`${targetMessage.id}\``,
                inline: true
            }
        );
        
        // Message content info
        if (targetMessage.content) {
            const contentLength = targetMessage.content.length;
            const preview = targetMessage.content.length > 100 
                ? targetMessage.content.substring(0, 100) + '...'
                : targetMessage.content;
            
            embed.addFields({
                name: `📝 Content (${contentLength} characters)`,
                value: `\`\`\`${preview}\`\`\``,
                inline: false
            });
        }
        
        // Attachments
        if (targetMessage.attachments.size > 0) {
            const attachmentList = targetMessage.attachments.map(att => 
                `• [${att.name}](${att.url}) (${this.formatBytes(att.size)})`
            ).join('\n');
            
            embed.addFields({
                name: `📎 Attachments (${targetMessage.attachments.size})`,
                value: attachmentList,
                inline: false
            });
        }
        
        // Embeds
        if (targetMessage.embeds.length > 0) {
            embed.addFields({
                name: `🎨 Embeds`,
                value: `${targetMessage.embeds.length} embed(s)`,
                inline: true
            });
        }
        
        // Reactions
        if (targetMessage.reactions.cache.size > 0) {
            const reactionList = targetMessage.reactions.cache.map(reaction => 
                `${reaction.emoji} ${reaction.count}`
            ).join(' ');
            
            embed.addFields({
                name: `😀 Reactions (${targetMessage.reactions.cache.size})`,
                value: reactionList,
                inline: false
            });
        }
        
        // Message flags
        const flags = [];
        if (targetMessage.pinned) flags.push('📌 Pinned');
        if (targetMessage.tts) flags.push('🔊 TTS');
        if (targetMessage.system) flags.push('⚙️ System');
        if (targetMessage.webhookId) flags.push('🪝 Webhook');
        if (targetMessage.editedTimestamp) flags.push('✏️ Edited');
        
        if (flags.length > 0) {
            embed.addFields({
                name: '🏷️ Flags',
                value: flags.join(' '),
                inline: false
            });
        }
        
        // Channel info
        embed.addFields(
            {
                name: '📺 Channel',
                value: `${targetMessage.channel.toString()}\n\`${targetMessage.channel.id}\``,
                inline: true
            },
            {
                name: '🏠 Server',
                value: targetMessage.guild ? `${targetMessage.guild.name}\n\`${targetMessage.guild.id}\`` : 'DM',
                inline: true
            }
        );
        
        // Create action buttons
        const components = new AdvancedComponentBuilder()
            .createRow()
            .addLinkButton({
                label: 'Jump to Message',
                url: targetMessage.url,
                emoji: '🔗'
            })
            .addSecondaryButton('copy_id', 'Copy ID', '📋')
            .addDeleteButton('delete_msginfo')
            .build();
        
        await interaction.editReply({ embeds: [embed], components });
        
        // Register the copy ID handler for this specific interaction
        interaction.client.interactionHandler.registerButtonHandler('copy', async (buttonInteraction, params) => {
            if (params[0] === 'id') {
                await buttonInteraction.reply({
                    content: `Message ID copied: \`${targetMessage.id}\``,
                    ephemeral: true
                });
            }
        });
    },

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
};
