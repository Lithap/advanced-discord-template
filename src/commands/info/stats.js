const { SlashCommandBuilder } = require('discord.js');
const embedBuilder = require('../../utils/embedBuilder.js');
const functions = require('../../utils/functions.js');
const { AdvancedComponentBuilder } = require('../../utils/componentBuilder.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Shows detailed bot statistics')
        .addBooleanOption(option =>
            option.setName('detailed')
                .setDescription('Show detailed system information')
                .setRequired(false)
        ),
    
    category: 'info',
    cooldown: 5,
    
    async execute(interaction) {
        const detailed = interaction.options.getBoolean('detailed') || false;
        
        await interaction.deferReply();
        
        const embed = embedBuilder.stats(interaction.client);
        
        if (detailed) {
            await this.addDetailedStats(embed, interaction.client);
        }
        
        // Add action buttons using advanced component builder
        const components = new AdvancedComponentBuilder()
            .createRow()
            .addRefreshButton('refresh_stats')
            .addSecondaryButton('detailed_stats', detailed ? 'Simple View' : 'Detailed View', '📊')
            .addSecondaryButton('export_stats', 'Export', '📤')
            .addDeleteButton('delete_stats')
            .build();

        await interaction.editReply({ embeds: [embed], components });
    },

    async addDetailedStats(embed, client) {
        // System information
        const memoryUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        embed.addFields(
            { 
                name: '💾 Memory Details', 
                value: [
                    `**Heap Used:** ${functions.formatBytes(memoryUsage.heapUsed)}`,
                    `**Heap Total:** ${functions.formatBytes(memoryUsage.heapTotal)}`,
                    `**RSS:** ${functions.formatBytes(memoryUsage.rss)}`,
                    `**External:** ${functions.formatBytes(memoryUsage.external)}`
                ].join('\n'), 
                inline: true 
            },
            { 
                name: '⚙️ System Info', 
                value: [
                    `**Platform:** ${process.platform}`,
                    `**Architecture:** ${process.arch}`,
                    `**Node.js:** ${process.version}`,
                    `**Discord.js:** v${require('discord.js').version}`
                ].join('\n'), 
                inline: true 
            },
            { 
                name: '📈 Cache Stats', 
                value: [
                    `**Guilds:** ${client.guilds.cache.size}`,
                    `**Users:** ${client.users.cache.size}`,
                    `**Channels:** ${client.channels.cache.size}`,
                    `**Roles:** ${client.guilds.cache.reduce((acc, guild) => acc + guild.roles.cache.size, 0)}`
                ].join('\n'), 
                inline: true 
            }
        );
        
        // Command statistics
        if (client.commandHandler) {
            const commands = client.commandHandler.commands;
            const categories = client.commandHandler.getCategories();
            
            embed.addFields({
                name: '🔧 Command Stats',
                value: [
                    `**Total Commands:** ${commands.size}`,
                    `**Categories:** ${categories.length}`,
                    `**Most Used:** N/A` // Would need usage tracking
                ].join('\n'),
                inline: true
            });
        }
        
        // Shard information (if sharded)
        if (client.shard) {
            embed.addFields({
                name: '🔀 Shard Info',
                value: [
                    `**Shard ID:** ${client.shard.ids.join(', ')}`,
                    `**Total Shards:** ${client.shard.count}`,
                    `**Shard Guilds:** ${client.guilds.cache.size}`
                ].join('\n'),
                inline: true
            });
        }
        
        // Performance metrics
        const startTime = Date.now();
        await new Promise(resolve => setTimeout(resolve, 1));
        const endTime = Date.now();
        
        embed.addFields({
            name: '⚡ Performance',
            value: [
                `**API Latency:** ${client.ws.ping}ms`,
                `**Response Time:** ${endTime - startTime}ms`,
                `**Uptime:** ${embedBuilder.formatUptime(client.uptime)}`
            ].join('\n'),
            inline: true
        });
    }
};
