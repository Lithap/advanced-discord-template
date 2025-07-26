const { Collection } = require('discord.js');
const logger = require('../utils/logger.js');
const embedBuilder = require('../utils/embedBuilder.js');
const config = require('../config/config.js');

class AdvancedInteractionHandler {
    constructor(client) {
        this.client = client;
        this.buttonHandlers = new Collection();
        this.selectMenuHandlers = new Collection();
        this.modalHandlers = new Collection();
        this.contextMenuHandlers = new Collection();
        this.autocompleteHandlers = new Collection();
        
        // Initialize built-in handlers
        this.initializeBuiltInHandlers();
    }

    // REGISTRATION METHODS
    registerButtonHandler(id, handler) {
        this.buttonHandlers.set(id, handler);
        logger.debug(`Registered button handler: ${id}`);
    }

    registerSelectMenuHandler(id, handler) {
        this.selectMenuHandlers.set(id, handler);
        logger.debug(`Registered select menu handler: ${id}`);
    }

    registerModalHandler(id, handler) {
        this.modalHandlers.set(id, handler);
        logger.debug(`Registered modal handler: ${id}`);
    }

    registerContextMenuHandler(name, handler) {
        this.contextMenuHandlers.set(name, handler);
        logger.debug(`Registered context menu handler: ${name}`);
    }

    registerAutocompleteHandler(commandName, handler) {
        this.autocompleteHandlers.set(commandName, handler);
        logger.debug(`Registered autocomplete handler: ${commandName}`);
    }

    // INTERACTION HANDLING
    async handleButtonInteraction(interaction) {
        const [handlerId, ...params] = interaction.customId.split('_');
        const handler = this.buttonHandlers.get(handlerId);

        if (!handler) {
            logger.warn(`No button handler found for: ${handlerId}`);
            return this.sendUnknownInteractionError(interaction);
        }

        try {
            await handler(interaction, params, this.client);
            logger.debug(`Button interaction handled: ${handlerId}`, { user: interaction.user.tag });
        } catch (error) {
            logger.error(`Error in button handler ${handlerId}:`, error);
            await this.sendInteractionError(interaction, error);
        }
    }

    async handleSelectMenuInteraction(interaction) {
        const [handlerId, ...params] = interaction.customId.split('_');
        const handler = this.selectMenuHandlers.get(handlerId);

        if (!handler) {
            logger.warn(`No select menu handler found for: ${handlerId}`);
            return this.sendUnknownInteractionError(interaction);
        }

        try {
            await handler(interaction, params, this.client);
            logger.debug(`Select menu interaction handled: ${handlerId}`, { 
                user: interaction.user.tag,
                values: interaction.values 
            });
        } catch (error) {
            logger.error(`Error in select menu handler ${handlerId}:`, error);
            await this.sendInteractionError(interaction, error);
        }
    }

    async handleModalInteraction(interaction) {
        const [handlerId, ...params] = interaction.customId.split('_');
        const handler = this.modalHandlers.get(handlerId);

        if (!handler) {
            logger.warn(`No modal handler found for: ${handlerId}`);
            return this.sendUnknownInteractionError(interaction);
        }

        try {
            await handler(interaction, params, this.client);
            logger.debug(`Modal interaction handled: ${handlerId}`, { user: interaction.user.tag });
        } catch (error) {
            logger.error(`Error in modal handler ${handlerId}:`, error);
            await this.sendInteractionError(interaction, error);
        }
    }

    async handleContextMenuInteraction(interaction) {
        const handler = this.contextMenuHandlers.get(interaction.commandName);

        if (!handler) {
            logger.warn(`No context menu handler found for: ${interaction.commandName}`);
            return this.sendUnknownInteractionError(interaction);
        }

        try {
            await handler(interaction, this.client);
            logger.debug(`Context menu interaction handled: ${interaction.commandName}`, { 
                user: interaction.user.tag 
            });
        } catch (error) {
            logger.error(`Error in context menu handler ${interaction.commandName}:`, error);
            await this.sendInteractionError(interaction, error);
        }
    }

    async handleAutocompleteInteraction(interaction) {
        const handler = this.autocompleteHandlers.get(interaction.commandName);

        if (!handler) {
            // Silently ignore - not all commands need autocomplete
            return;
        }

        try {
            await handler(interaction, this.client);
        } catch (error) {
            logger.error(`Error in autocomplete handler ${interaction.commandName}:`, error);
            // Don't send error to user for autocomplete failures
        }
    }

    // ERROR HANDLING
    async sendInteractionError(interaction, error) {
        const embed = embedBuilder.error(
            'Interaction Error',
            'An error occurred while processing your interaction.'
        );

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [embed], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        } catch (followUpError) {
            logger.error('Failed to send interaction error message:', followUpError);
        }
    }

    async sendUnknownInteractionError(interaction) {
        const embed = embedBuilder.warning(
            'Unknown Interaction',
            'This interaction is no longer available or has expired.'
        );

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [embed], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        } catch (error) {
            logger.error('Failed to send unknown interaction error:', error);
        }
    }

    // BUILT-IN HANDLERS
    initializeBuiltInHandlers() {
        // Universal delete button
        this.registerButtonHandler('delete', async (interaction) => {
            // Check if user can delete (message author or has manage messages permission)
            const canDelete = interaction.user.id === interaction.message.interaction?.user.id ||
                             interaction.member?.permissions.has('ManageMessages');

            if (!canDelete) {
                const embed = embedBuilder.error('No Permission', 'You cannot delete this message.');
                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }

            await interaction.message.delete();
        });

        // Universal refresh button
        this.registerButtonHandler('refresh', async (interaction, params) => {
            await interaction.deferUpdate();

            // Emit refresh event for the original command to handle
            this.client.emit('refreshInteraction', interaction, params);
        });

        // Welcome help button
        this.registerButtonHandler('welcome', async (interaction, params) => {
            if (params[0] === 'help') {
                const embed = embedBuilder.createEmbed({ color: '#5865f2' });
                embed.setTitle('🚀 DBL Bot Quick Start');
                embed.setDescription('Welcome to DBL Bot! Here\'s how to get started.');

                embed.addFields(
                    { name: '⚡ Essential Commands', value: '`/help` - View all commands\n`/ping` - Check bot latency\n`/stats` - View bot statistics\n`/showcase` - See features', inline: true },
                    { name: '🎯 Features', value: '• Modern slash commands\n• Interactive components\n• Clean, responsive design\n• Regular updates', inline: true }
                );

                embed.setFooter({
                    text: 'DBL Bot • Modern Discord Bot',
                    iconURL: interaction.client.user.displayAvatarURL({ size: 64 })
                });

                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        });

        // Help command button handlers
        this.registerButtonHandler('help', async (interaction, params) => {
            const [action] = params;

            if (action === 'refresh') {
                await interaction.deferUpdate();

                // Re-execute help command logic
                const commandHandler = this.client.commandHandler;
                const categories = commandHandler.getCategories();

                const embed = embedBuilder.createEmbed({ color: '#5865f2' });
                embed.setTitle('🤖 DBL Bot Help');
                embed.setDescription(`Welcome to DBL Bot! Here are all available commands.\n\n**${commandHandler.commands.size} commands** available • Use \`/help <command>\` for details`);
                embed.setThumbnail(interaction.client.user.displayAvatarURL({ size: 256 }));

                // Add categories
                for (const category of categories) {
                    const commands = commandHandler.getCommandsByCategory(category);
                    const commandList = commands.map(cmd => `\`/${cmd.data.name}\``).join(', ');

                    embed.addFields({
                        name: `${this.getCategoryEmoji(category)} ${this.capitalize(category)} (${commands.length})`,
                        value: commandList || 'No commands',
                        inline: false
                    });
                }

                embed.addFields(
                    { name: '⚡ Commands', value: commandHandler.commands.size.toString(), inline: true },
                    { name: '🏠 Servers', value: interaction.client.guilds.cache.size.toString(), inline: true },
                    { name: '👥 Users', value: interaction.client.users.cache.size.toString(), inline: true }
                );

                embed.setFooter({
                    text: 'DBL Bot • Select category below',
                    iconURL: interaction.client.user.displayAvatarURL({ size: 64 })
                });

                await interaction.editReply({ embeds: [embed] });
            } else if (action === 'categories') {
                await interaction.deferUpdate();
                // Show all categories in a clean format
                const commandHandler = this.client.commandHandler;
                const categories = commandHandler.getCategories();

                const embed = embedBuilder.createEmbed({ color: '#5865f2' });
                embed.setTitle('📁 All Command Categories');
                embed.setDescription('Here are all available command categories:');

                for (const category of categories) {
                    const commands = commandHandler.getCommandsByCategory(category);
                    embed.addFields({
                        name: `${this.getCategoryEmoji(category)} ${this.capitalize(category)}`,
                        value: `${commands.length} commands available`,
                        inline: true
                    });
                }

                embed.setFooter({ text: 'DBL Bot • Command Categories' });

                await interaction.editReply({ embeds: [embed] });
            }
        });

        // Help category select menu
        this.registerSelectMenuHandler('help', async (interaction, params) => {
            const selectedCategory = interaction.values[0];
            const commandHandler = this.client.commandHandler;
            const commands = commandHandler.getCommandsByCategory(selectedCategory);
            
            const embed = embedBuilder.createEmbed({
                color: '#0099ff'
            });
            
            embed.setTitle(`📁 ${this.capitalize(selectedCategory)} Commands`);
            embed.setDescription(`Here are all commands in the **${selectedCategory}** category:`);
            
            if (commands.length === 0) {
                embed.addFields({ name: 'No Commands', value: 'This category has no commands.', inline: false });
            } else {
                for (const command of commands) {
                    embed.addFields({
                        name: `/${command.data.name}`,
                        value: command.data.description,
                        inline: true
                    });
                }
            }
            
            await interaction.reply({ embeds: [embed], ephemeral: true });
        });

        // Showcase select menu handler
        this.registerSelectMenuHandler('showcase', async (interaction, params) => {
            const [action] = params;
            const selectedDemo = interaction.values[0];

            if (action === 'demo') {
                await interaction.deferUpdate();

                let embed;
                const { AdvancedComponentBuilder } = require('../utils/componentBuilder.js');

                switch (selectedDemo) {
                    case 'buttons':
                        embed = embedBuilder.createEmbed({ color: '#5865f2' });
                        embed.setTitle('🔘 Button Demo');
                        embed.setDescription('This demonstrates all button styles available in Discord.js v14.');

                        const buttonComponents = new AdvancedComponentBuilder()
                            .createRow()
                            .addPrimaryButton('showcase_primary', 'Primary', '🟦')
                            .addSecondaryButton('showcase_secondary', 'Secondary', '⚪')
                            .addSuccessButton('showcase_success', 'Success', '🟢')
                            .addDangerButton('showcase_danger', 'Danger', '🔴')
                            .build();

                        await interaction.editReply({ embeds: [embed], components: buttonComponents });
                        break;

                    case 'selects':
                        embed = embedBuilder.createEmbed({ color: '#5865f2' });
                        embed.setTitle('📋 Select Menu Demo');
                        embed.setDescription('This demonstrates select menus available in Discord.js v14.');

                        const selectComponents = new AdvancedComponentBuilder()
                            .createRow()
                            .addStringSelect({
                                id: 'demo_select',
                                placeholder: 'Choose an option...',
                                options: [
                                    { label: 'Option 1', value: 'opt1', emoji: '1️⃣' },
                                    { label: 'Option 2', value: 'opt2', emoji: '2️⃣' },
                                    { label: 'Option 3', value: 'opt3', emoji: '3️⃣' }
                                ]
                            })
                            .build();

                        await interaction.editReply({ embeds: [embed], components: selectComponents });
                        break;

                    case 'modals':
                        embed = embedBuilder.createEmbed({ color: '#5865f2' });
                        embed.setTitle('📝 Modal Demo');
                        embed.setDescription('Click the button below to open a modal form.');

                        const modalComponents = new AdvancedComponentBuilder()
                            .createRow()
                            .addPrimaryButton('showcase_modal', 'Open Modal', '📝')
                            .build();

                        await interaction.editReply({ embeds: [embed], components: modalComponents });
                        break;

                    case 'pagination':
                        embed = embedBuilder.createEmbed({ color: '#5865f2' });
                        embed.setTitle('📄 Pagination Demo - Page 1/3');
                        embed.setDescription('This demonstrates pagination with navigation controls.');
                        embed.addFields({ name: 'Page 1', value: 'This is the first page of content.', inline: false });

                        const paginationComponents = new AdvancedComponentBuilder()
                            .createRow()
                            .addSecondaryButton('page_prev', 'Previous', '⬅️', true)
                            .addPrimaryButton('page_info', 'Page 1/3', 'ℹ️', true)
                            .addSecondaryButton('page_next', 'Next', '➡️')
                            .build();

                        await interaction.editReply({ embeds: [embed], components: paginationComponents });
                        break;

                    case 'confirmations':
                        embed = embedBuilder.createEmbed({ color: '#5865f2' });
                        embed.setTitle('✅ Confirmation Demo');
                        embed.setDescription('This demonstrates confirmation dialogs.');

                        const confirmComponents = new AdvancedComponentBuilder()
                            .createRow()
                            .addSuccessButton('showcase_safe', 'Safe Action', '✅')
                            .addDangerButton('showcase_dangerous', 'Dangerous Action', '⚠️')
                            .build();

                        await interaction.editReply({ embeds: [embed], components: confirmComponents });
                        break;

                    default:
                        embed = embedBuilder.error('Unknown Demo', 'The selected demo is not available.');
                        await interaction.editReply({ embeds: [embed] });
                        break;
                }
            }
        });

        // Pagination handlers
        this.registerButtonHandler('page', async (interaction, params) => {
            const [action] = params;
            
            // Emit pagination event for the original command to handle
            this.client.emit('paginationInteraction', interaction, action, params);
        });

        // Confirmation handlers
        this.registerButtonHandler('confirm', async (interaction, params) => {
            this.client.emit('confirmInteraction', interaction, params);
        });

        this.registerButtonHandler('cancel', async (interaction, params) => {
            const embed = embedBuilder.info('Cancelled', 'Action cancelled.');
            await interaction.reply({ embeds: [embed], ephemeral: true });
        });

        // Stats refresh button handler
        this.registerButtonHandler('refresh', async (interaction, params) => {
            const [target] = params;

            if (target === 'stats') {
                await interaction.deferUpdate();

                const embed = embedBuilder.stats(interaction.client);
                await interaction.editReply({ embeds: [embed] });
            } else if (target === 'ping') {
                // Handle ping refresh in the ping handler
                return;
            }
        });

        this.registerButtonHandler('detailed', async (interaction, params) => {
            const [target] = params;

            if (target === 'stats') {
                await interaction.deferUpdate();

                const embed = embedBuilder.stats(interaction.client);

                // Add detailed stats
                const memoryUsage = process.memoryUsage();

                embed.addFields(
                    {
                        name: '💾 Memory Details',
                        value: [
                            `**Heap Used:** ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                            `**Heap Total:** ${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
                            `**RSS:** ${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '⚙️ System Info',
                        value: [
                            `**Platform:** ${process.platform}`,
                            `**Architecture:** ${process.arch}`,
                            `**Discord.js:** v${require('discord.js').version}`
                        ].join('\n'),
                        inline: true
                    }
                );

                await interaction.editReply({ embeds: [embed] });
            }
        });

        this.registerButtonHandler('export', async (interaction, params) => {
            const [target] = params;

            if (target === 'stats') {
                await interaction.deferReply({ ephemeral: true });

                const stats = {
                    servers: interaction.client.guilds.cache.size,
                    users: interaction.client.users.cache.size,
                    ping: interaction.client.ws.ping,
                    uptime: interaction.client.uptime,
                    memory: process.memoryUsage(),
                    timestamp: new Date().toISOString()
                };

                const embed = embedBuilder.success('Stats Exported', 'Here are your bot statistics in JSON format:');

                await interaction.editReply({
                    embeds: [embed],
                    files: [{
                        attachment: Buffer.from(JSON.stringify(stats, null, 2)),
                        name: 'bot-stats.json'
                    }]
                });
            }
        });

        // Ping command button handlers
        this.registerButtonHandler('ping', async (interaction, params) => {
            const [action] = params;

            if (action === 'refresh') {
                await interaction.deferUpdate();

                const startTime = Date.now();
                await new Promise(resolve => setTimeout(resolve, 1));
                const endTime = Date.now();
                const responseTime = endTime - startTime;

                const embed = embedBuilder.ping(interaction.client, responseTime);

                // Add additional info
                embed.addFields(
                    {
                        name: '📡 Connection Quality',
                        value: this.getConnectionQuality(interaction.client.ws.ping),
                        inline: true
                    },
                    {
                        name: '🌐 WebSocket Status',
                        value: this.getWebSocketStatus(interaction.client.ws.status),
                        inline: true
                    }
                );

                await interaction.editReply({ embeds: [embed] });
            } else if (action === 'detailed') {
                await interaction.deferReply({ ephemeral: true });

                const embed = embedBuilder.createEmbed({ color: '#5865f2' });
                embed.setTitle('📊 Detailed Network Information');

                embed.addFields(
                    { name: '📡 API Latency', value: `${interaction.client.ws.ping}ms`, inline: true },
                    { name: '🌐 WebSocket', value: this.getWebSocketStatus(interaction.client.ws.status), inline: true },
                    { name: '📊 Quality', value: this.getConnectionQuality(interaction.client.ws.ping), inline: true },
                    { name: '🔗 Connection Info', value: 'Stable connection to Discord Gateway', inline: false }
                );

                await interaction.editReply({ embeds: [embed] });
            } else if (action === 'history') {
                await interaction.deferReply({ ephemeral: true });

                const embed = embedBuilder.createEmbed({ color: '#5865f2' });
                embed.setTitle('📈 Ping History');
                embed.setDescription('Recent ping measurements:');

                // Simulate ping history (in real bot, you'd store this)
                const history = Array.from({ length: 10 }, (_, i) => {
                    const ping = interaction.client.ws.ping + Math.floor(Math.random() * 20 - 10);
                    return `**${i + 1}.** ${ping}ms - ${this.getConnectionQuality(ping)}`;
                });

                embed.addFields({
                    name: '📊 Last 10 Measurements',
                    value: history.join('\n'),
                    inline: false
                });

                await interaction.editReply({ embeds: [embed] });
            }
        });

        // Showcase command button handlers
        this.registerButtonHandler('showcase', async (interaction, params) => {
            const [action] = params;

            switch (action) {
                case 'info':
                    await interaction.deferReply({ ephemeral: true });

                    const infoEmbed = embedBuilder.createEmbed({ color: '#5865f2' });
                    infoEmbed.setTitle('ℹ️ DBL Bot Information');
                    infoEmbed.setDescription('Advanced Discord bot built with Discord.js v14');

                    infoEmbed.addFields(
                        { name: '🔧 Version', value: 'v1.0.0', inline: true },
                        { name: '📅 Created', value: new Date().toLocaleDateString(), inline: true },
                        { name: '👨‍💻 Developer', value: 'DBL Team', inline: true },
                        { name: '🌟 Features', value: 'Modern slash commands, interactive components, clean design', inline: false }
                    );

                    await interaction.editReply({ embeds: [infoEmbed] });
                    break;

                case 'stats':
                    await interaction.deferReply({ ephemeral: true });

                    const statsEmbed = embedBuilder.stats(interaction.client);
                    await interaction.editReply({ embeds: [statsEmbed] });
                    break;

                case 'features':
                    await interaction.deferUpdate();

                    const featuresEmbed = embedBuilder.createEmbed({ color: '#5865f2' });
                    featuresEmbed.setTitle('🎨 All Features Overview');
                    featuresEmbed.setDescription('Complete feature list of DBL Bot');

                    featuresEmbed.addFields(
                        { name: '🔘 Interactive Buttons', value: 'All button styles with handlers', inline: true },
                        { name: '📋 Select Menus', value: 'String, User, Role, Channel selects', inline: true },
                        { name: '📝 Modal Forms', value: 'Advanced form handling', inline: true },
                        { name: '📄 Pagination', value: 'Smart navigation system', inline: true },
                        { name: '✅ Confirmations', value: 'Safe action verification', inline: true },
                        { name: '🎯 Context Menus', value: 'Right-click interactions', inline: true }
                    );

                    await interaction.editReply({ embeds: [featuresEmbed] });
                    break;

                default:
                    // Handle demo button clicks
                    const demoEmbed = embedBuilder.success('Feature Demo', `You clicked the **${action}** demo button!`);
                    await interaction.reply({ embeds: [demoEmbed], ephemeral: true });
                    break;
            }
        });

        // Database command button handlers
        this.registerButtonHandler('database', async (interaction, params) => {
            const [action] = params;

            switch (action) {
                case 'refresh':
                case 'status':
                    await interaction.deferUpdate();

                    const database = interaction.client.database;
                    const embed = embedBuilder.createEmbed({ color: '#5865f2' });
                    embed.setTitle('📊 Database Status');

                    if (!database) {
                        embed.setDescription('❌ Database not configured');
                        embed.setColor('#f04747');
                    } else {
                        const status = database.getStatus();
                        const isHealthy = await database.healthCheck();

                        embed.setDescription(`${isHealthy ? '✅' : '❌'} Database Connection`);
                        embed.addFields(
                            { name: 'Type', value: status.type, inline: true },
                            { name: 'Status', value: status.status, inline: true },
                            { name: 'Health', value: isHealthy ? '🟢 Healthy' : '🔴 Unhealthy', inline: true }
                        );
                        embed.setColor(isHealthy ? '#00d26a' : '#f04747');
                    }

                    await interaction.editReply({ embeds: [embed] });
                    break;

                case 'stats':
                case 'stats_refresh':
                    await interaction.deferUpdate();

                    const db = interaction.client.database;
                    const statsEmbed = embedBuilder.createEmbed({ color: '#5865f2' });
                    statsEmbed.setTitle('📈 Database Statistics');

                    if (!db || !db.isAvailable()) {
                        statsEmbed.setDescription('❌ Database not available');
                        statsEmbed.setColor('#f04747');
                    } else {
                        try {
                            const stats = await db.getStats();
                            if (stats) {
                                statsEmbed.setDescription('📊 Current database statistics');
                                statsEmbed.addFields(
                                    { name: '🏠 Guilds', value: stats.guilds.toString(), inline: true },
                                    { name: '👥 Users', value: stats.users.toString(), inline: true },
                                    { name: '📋 Total Drafts', value: stats.drafts.toString(), inline: true }
                                );
                                statsEmbed.setColor('#00d26a');
                            }
                        } catch (error) {
                            statsEmbed.setDescription('❌ Error retrieving statistics');
                            statsEmbed.setColor('#f04747');
                        }
                    }

                    await interaction.editReply({ embeds: [statsEmbed] });
                    break;

                case 'health':
                case 'health_refresh':
                    await interaction.deferUpdate();

                    const healthDb = interaction.client.database;
                    const healthEmbed = embedBuilder.createEmbed({ color: '#5865f2' });
                    healthEmbed.setTitle('🔍 Database Health Check');

                    if (!healthDb) {
                        healthEmbed.setDescription('❌ Database not configured');
                        healthEmbed.setColor('#f04747');
                    } else {
                        const startTime = Date.now();
                        const isHealthy = await healthDb.healthCheck();
                        const responseTime = Date.now() - startTime;

                        healthEmbed.setDescription(`${isHealthy ? '✅ Health check passed' : '❌ Health check failed'}`);
                        healthEmbed.addFields(
                            { name: 'Connection', value: isHealthy ? '🟢 Active' : '🔴 Failed', inline: true },
                            { name: 'Response Time', value: `${responseTime}ms`, inline: true }
                        );
                        healthEmbed.setColor(isHealthy ? '#00d26a' : '#f04747');
                    }

                    await interaction.editReply({ embeds: [healthEmbed] });
                    break;
            }
        });

        // Ping command button handlers
        this.registerButtonHandler('ping_refresh', async (interaction, params) => {
            await interaction.deferUpdate();

            // Create fresh ping data
            const startTime = Date.now();
            const endTime = Date.now();
            const responseTime = endTime - startTime;

            const embedBuilder = require('../utils/embedBuilder.js');
            const { AdvancedComponentBuilder } = require('../utils/componentBuilder.js');

            const embed = embedBuilder.ping(interaction.client, responseTime);

            // Add additional latency information
            const ping = interaction.client.ws.ping || 0;
            const status = interaction.client.ws.status || 1;

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

            // Keep the same components
            const components = new AdvancedComponentBuilder()
                .createRow()
                .addRefreshButton('ping_refresh')
                .addSecondaryButton('ping_detailed', 'Detailed Info', '📊')
                .addSecondaryButton('ping_history', 'History', '📈')
                .addDeleteButton('delete_ping')
                .build();

            await interaction.editReply({
                embeds: [embed],
                components
            });
        });

        this.registerButtonHandler('ping_detailed', async (interaction, params) => {
            const embed = embedBuilder.createEmbed({
                title: '📊 Detailed Performance Information',
                color: '#5865f2'
            });

            const client = interaction.client;
            const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
            const uptime = Math.floor(client.uptime / 1000);

            embed.addFields(
                { name: '🖥️ System', value: `Node.js ${process.version}`, inline: true },
                { name: '💾 Memory Usage', value: `${memoryUsage} MB`, inline: true },
                { name: '⏱️ Uptime', value: `${uptime}s`, inline: true },
                { name: '🌐 Guilds', value: client.guilds.cache.size.toString(), inline: true },
                { name: '👥 Users', value: client.users.cache.size.toString(), inline: true },
                { name: '📡 Ping', value: `${client.ws.ping}ms`, inline: true }
            );

            await interaction.reply({ embeds: [embed], ephemeral: true });
        });

        this.registerButtonHandler('ping_history', async (interaction, params) => {
            const embed = embedBuilder.createEmbed({
                title: '📈 Performance History',
                description: 'Historical performance data would be displayed here.',
                color: '#5865f2'
            });

            await interaction.reply({ embeds: [embed], ephemeral: true });
        });

        this.registerButtonHandler('delete_ping', async (interaction, params) => {
            try {
                await interaction.message.delete();
            } catch (error) {
                await interaction.reply({ content: 'Message already deleted or cannot be deleted.', ephemeral: true });
            }
        });
    }

    // UTILITY METHODS
    getConnectionQuality(ping) {
        if (ping < 50) return '🟢 Excellent';
        if (ping < 100) return '🟡 Good';
        if (ping < 200) return '🟠 Fair';
        if (ping < 500) return '🔴 Poor';
        return '⚫ Very Poor';
    }

    getWebSocketStatus(status) {
        const statusMap = {
            0: '🔴 Connecting',
            1: '🟢 Open',
            2: '🟡 Closing',
            3: '🔴 Closed'
        };

        return statusMap[status] || '❓ Unknown';
    }

    getCategoryEmoji(category) {
        const emojiMap = {
            general: '🔧',
            info: 'ℹ️',
            utility: '🛠️',
            fun: '🎉',
            moderation: '🛡️',
            admin: '👑',
            music: '🎵',
            economy: '💰'
        };

        return emojiMap[category] || '📁';
    }

    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    // Format user mention for clickable names
    formatUserMention(user) {
        return `<@${user.id}>`;
    }

    // Format user with clickable mention and ID
    formatUserInfo(user) {
        return `${this.formatUserMention(user)} (\`${user.id}\`)`;
    }

    // Get interaction statistics
    getStats() {
        return {
            buttonHandlers: this.buttonHandlers.size,
            selectMenuHandlers: this.selectMenuHandlers.size,
            modalHandlers: this.modalHandlers.size,
            contextMenuHandlers: this.contextMenuHandlers.size,
            autocompleteHandlers: this.autocompleteHandlers.size
        };
    }

    // Clear all handlers (for hot reload)
    clearHandlers() {
        this.buttonHandlers.clear();
        this.selectMenuHandlers.clear();
        this.modalHandlers.clear();
        this.contextMenuHandlers.clear();
        this.autocompleteHandlers.clear();
        
        // Re-initialize built-in handlers
        this.initializeBuiltInHandlers();
        
        logger.info('Cleared all interaction handlers');
    }
}

module.exports = AdvancedInteractionHandler;
