const { SlashCommandBuilder } = require('discord.js');
const embedBuilder = require('../../utils/embedBuilder.js');
const { AdvancedComponentBuilder } = require('../../utils/componentBuilder.js');
const DatabaseService = require('../../services/database/DatabaseService.js');
const config = require('../../config/config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('database')
        .setDescription('Shows database connection status and statistics')
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Check database connection status')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('Show database statistics')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('health')
                .setDescription('Perform database health check')
        ),
    
    category: 'info',
    cooldown: 5,
    
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        
        await interaction.deferReply();
        
        switch (subcommand) {
            case 'status':
                await this.showStatus(interaction);
                break;
            case 'stats':
                await this.showStats(interaction);
                break;
            case 'health':
                await this.performHealthCheck(interaction);
                break;
            default:
                await this.showStatus(interaction);
                break;
        }
    },

    async showStatus(interaction) {
        const database = interaction.client.databaseService;
        
        const embed = embedBuilder.createEmbed({ color: '#5865f2' });
        embed.setTitle('📊 Database Status');
        
        if (!database) {
            embed.setDescription('❌ Database not configured');
            embed.addFields({
                name: 'Status',
                value: 'No database connection available',
                inline: false
            });
            embed.setColor('#f04747');
        } else {
            const status = database.getStatus();
            const healthCheck = await database.healthCheck();

            embed.setDescription(`${healthCheck.healthy ? '✅' : '❌'} Database Connection`);

            embed.addFields(
                { name: 'Type', value: 'MongoDB', inline: true },
                { name: 'Status', value: status.isConnected ? 'Connected' : 'Disconnected', inline: true },
                { name: 'Health', value: healthCheck.healthy ? '🟢 Healthy' : '🔴 Unhealthy', inline: true },
                { name: 'Host', value: status.host || 'Unknown', inline: true },
                { name: 'Database', value: status.name || 'Unknown', inline: true },
                { name: 'Ready State', value: this.getReadyStateText(status.readyState), inline: true }
            );

            embed.setColor(healthCheck.healthy ? '#00d26a' : '#f04747');
        }
        
        const components = new AdvancedComponentBuilder()
            .createRow()
            .addRefreshButton('database_refresh')
            .addSecondaryButton('database_stats', 'Statistics', '📈')
            .addSecondaryButton('database_health', 'Health Check', '🔍')
            .build();
        
        embed.setFooter({ text: 'DBL Bot • Database Status' });
        
        await interaction.editReply({ embeds: [embed], components });
    },

    async showStats(interaction) {
        const database = interaction.client.databaseService;

        const embed = embedBuilder.createEmbed({ color: '#5865f2' });
        embed.setTitle('📈 Database Statistics');

        if (!database || !database.isConnected) {
            embed.setDescription('❌ Database not available');
            embed.setColor('#f04747');
        } else {
            try {
                const stats = await database.getStats();

                if (stats && !stats.error) {
                    embed.setDescription('📊 Current database statistics');

                    embed.addFields(
                        { name: '🔢 Version', value: stats.version || 'Unknown', inline: true },
                        { name: '⏱️ Uptime', value: `${Math.floor((stats.uptime || 0) / 3600)}h`, inline: true },
                        { name: '🔗 Connections', value: stats.connections?.current?.toString() || '0', inline: true },
                        { name: '💾 Memory', value: `${Math.round((stats.memory?.resident || 0) / 1024 / 1024)}MB`, inline: true },
                        { name: '📊 Operations', value: stats.opcounters?.query?.toString() || '0', inline: true },
                        { name: '🌐 Network', value: `${Math.round((stats.network?.bytesIn || 0) / 1024)}KB in`, inline: true }
                    );

                    embed.setColor('#00d26a');
                } else {
                    embed.setDescription('❌ Failed to retrieve statistics');
                    embed.addFields({
                        name: 'Error',
                        value: stats?.error || 'Unknown error',
                        inline: false
                    });
                    embed.setColor('#f04747');
                }
            } catch (error) {
                embed.setDescription('❌ Error retrieving statistics');
                embed.addFields({
                    name: 'Error',
                    value: error.message,
                    inline: false
                });
                embed.setColor('#f04747');
            }
        }
        
        const components = new AdvancedComponentBuilder()
            .createRow()
            .addRefreshButton('database_stats_refresh')
            .addSecondaryButton('database_status', 'Status', '📊')
            .addSecondaryButton('database_health', 'Health Check', '🔍')
            .build();
        
        embed.setFooter({ text: 'DBL Bot • Database Statistics' });
        
        await interaction.editReply({ embeds: [embed], components });
    },

    async performHealthCheck(interaction) {
        const database = interaction.client.databaseService;
        
        const embed = embedBuilder.createEmbed({ color: '#5865f2' });
        embed.setTitle('🔍 Database Health Check');
        
        if (!database) {
            embed.setDescription('❌ Database not configured');
            embed.setColor('#f04747');
        } else {
            try {
                const startTime = Date.now();
                const healthCheck = await database.healthCheck();
                const responseTime = Date.now() - startTime;

                embed.setDescription(`${healthCheck.healthy ? '✅ Health check passed' : '❌ Health check failed'}`);

                embed.addFields(
                    { name: 'Connection', value: healthCheck.healthy ? '🟢 Active' : '🔴 Failed', inline: true },
                    { name: 'Response Time', value: `${responseTime}ms`, inline: true },
                    { name: 'Timestamp', value: healthCheck.timestamp || new Date().toLocaleString(), inline: true }
                );

                if (healthCheck.healthy) {
                    embed.addFields({
                        name: 'Status',
                        value: '✅ Database is responding normally\n✅ Connection is stable\n✅ Operations are functional',
                        inline: false
                    });
                } else {
                    embed.addFields({
                        name: 'Issues',
                        value: '❌ Database connection failed\n❌ Health check timeout\n❌ Operations may be affected',
                        inline: false
                    });
                }
                
                embed.setColor(healthCheck.healthy ? '#00d26a' : '#f04747');
            } catch (error) {
                embed.setDescription('❌ Health check error');
                embed.addFields({
                    name: 'Error Details',
                    value: error.message,
                    inline: false
                });
                embed.setColor('#f04747');
            }
        }
        
        const components = new AdvancedComponentBuilder()
            .createRow()
            .addRefreshButton('database_health_refresh')
            .addSecondaryButton('database_status', 'Status', '📊')
            .addSecondaryButton('database_stats', 'Statistics', '📈')
            .build();
        
        embed.setFooter({ text: 'DBL Bot • Database Health Check' });
        
        await interaction.editReply({ embeds: [embed], components });
    }
};
