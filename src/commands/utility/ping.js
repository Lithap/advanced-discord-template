const { SlashCommandBuilder } = require('discord.js');
const embedBuilder = require('../../utils/embedBuilder.js');
const { AdvancedComponentBuilder } = require('../../utils/componentBuilder.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Shows bot latency and API response time'),

    category: 'utility',
    cooldown: 3,

    async execute(interaction) {
        try {
            const startTime = Date.now();

            await interaction.reply({ content: '🏓 Pinging...' });

            const endTime = Date.now();
            const responseTime = endTime - startTime;

            const embed = embedBuilder.ping(interaction.client, responseTime);

            const ping = interaction.client.ws.ping || 0;
            const status = interaction.client.ws.status || 1;

            embed.addFields(
                {
                    name: '📡 Connection Quality',
                    value: getConnectionQuality(ping),
                    inline: true
                },
                {
                    name: '🌐 WebSocket Status',
                    value: getWebSocketStatus(status),
                    inline: true
                },
                {
                    name: '⚡ Performance',
                    value: getPerformanceRating(ping, responseTime),
                    inline: true
                }
            );

            const components = new AdvancedComponentBuilder()
                .createRow()
                .addRefreshButton('ping_refresh')
                .addSecondaryButton('ping_detailed', 'Detailed Info', '📊')
                .addSecondaryButton('ping_history', 'History', '📈')
                .addDeleteButton('delete_ping')
                .build();

            await interaction.editReply({
                content: null,
                embeds: [embed],
                components
            });
        } catch (error) {
            console.error('Error in ping command:', error);

            const fallbackEmbed = embedBuilder.createEmbed({
                title: '🏓 Pong!',
                description: `Bot Latency: ${interaction.client.ws.ping || 'N/A'}ms`,
                color: '#5865f2'
            });

            if (interaction.replied) {
                await interaction.editReply({ embeds: [fallbackEmbed] });
            } else {
                await interaction.reply({ embeds: [fallbackEmbed] });
            }
        }
    },

};

// Helper functions
function getConnectionQuality(ping) {
    if (ping < 50) return '🟢 Excellent';
    if (ping < 100) return '🟡 Good';
    if (ping < 200) return '🟠 Fair';
    if (ping < 500) return '🔴 Poor';
    return '⚫ Very Poor';
}

function getWebSocketStatus(status) {
    const statusMap = {
        0: '🔴 Connecting',
        1: '🟢 Open',
        2: '🟡 Closing',
        3: '🔴 Closed'
    };

    return statusMap[status] || '❓ Unknown';
}

function getPerformanceRating(apiPing, responsePing) {
    const avgPing = (apiPing + responsePing) / 2;

    if (avgPing < 75) return '⭐⭐⭐⭐⭐ Excellent';
    if (avgPing < 150) return '⭐⭐⭐⭐ Good';
    if (avgPing < 250) return '⭐⭐⭐ Average';
    if (avgPing < 400) return '⭐⭐ Below Average';
    return '⭐ Poor';
}
