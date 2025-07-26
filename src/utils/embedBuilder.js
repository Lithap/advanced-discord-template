const { EmbedBuilder } = require('discord.js');
const config = require('../config/config.js');

class AdvancedEmbedBuilder {
    constructor() {
        this.defaultColor = config.bot.embedColor;
        this.errorColor = config.bot.errorColor;
        this.successColor = config.bot.successColor;
        this.warningColor = config.bot.warningColor;
    }

    // Create base embed with default settings
    createEmbed(options = {}) {
        const embed = new EmbedBuilder();
        
        // Set default color
        embed.setColor(options.color || this.defaultColor);
        
        // Set timestamp if not explicitly disabled
        if (options.timestamp !== false) {
            embed.setTimestamp();
        }
        
        // Set footer
        if (options.footer !== false) {
            embed.setFooter({
                text: options.footerText || config.embeds.footer.text,
                iconURL: options.footerIcon || config.embeds.footer.iconURL
            });
        }
        
        return embed;
    }

    // Success embed
    success(title, description, options = {}) {
        const embed = this.createEmbed({
            color: '#00d26a', // Clean success green
            ...options
        });

        if (title) embed.setTitle(`✅ ${title}`);
        if (description) embed.setDescription(description);

        return embed;
    }

    // Error embed
    error(title, description, options = {}) {
        const embed = this.createEmbed({
            color: '#f04747', // Clean error red
            ...options
        });

        if (title) embed.setTitle(`❌ ${title}`);
        if (description) embed.setDescription(description);

        return embed;
    }

    // Warning embed
    warning(title, description, options = {}) {
        const embed = this.createEmbed({
            color: '#faa61a', // Clean warning orange
            ...options
        });

        if (title) embed.setTitle(`⚠️ ${title}`);
        if (description) embed.setDescription(description);

        return embed;
    }

    // Info embed
    info(title, description, options = {}) {
        const embed = this.createEmbed(options);
        
        if (title) embed.setTitle(`ℹ️ ${title}`);
        if (description) embed.setDescription(description);
        
        return embed;
    }

    // Help embed for commands
    helpCommand(command, options = {}) {
        const embed = this.createEmbed(options);
        
        embed.setTitle(`🔧 Command: /${command.data.name}`);
        embed.setDescription(command.data.description);
        
        // Add usage if available
        if (command.usage) {
            embed.addFields({ 
                name: '📝 Usage', 
                value: `\`/${command.data.name} ${command.usage}\``, 
                inline: false 
            });
        }
        
        // Add examples if available
        if (command.examples && command.examples.length > 0) {
            embed.addFields({ 
                name: '💡 Examples', 
                value: command.examples.map(ex => `\`/${command.data.name} ${ex}\``).join('\n'), 
                inline: false 
            });
        }
        
        // Add permissions if required
        if (command.permissions && command.permissions.length > 0) {
            embed.addFields({ 
                name: '🔒 Required Permissions', 
                value: command.permissions.join(', '), 
                inline: false 
            });
        }
        
        // Add cooldown if exists
        if (command.cooldown) {
            embed.addFields({ 
                name: '⏱️ Cooldown', 
                value: `${command.cooldown} seconds`, 
                inline: true 
            });
        }
        
        return embed;
    }

    // Stats embed
    stats(client, options = {}) {
        const embed = this.createEmbed({
            color: '#5865f2', // Discord blurple
            ...options
        });

        embed.setTitle('📊 Bot Statistics');
        embed.setThumbnail(client.user.displayAvatarURL({ size: 256 }));

        // Performance metrics
        const uptime = this.formatUptime(client.uptime);
        const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

        embed.addFields(
            { name: '🏠 Servers', value: client.guilds.cache.size.toLocaleString(), inline: true },
            { name: '👥 Users', value: client.users.cache.size.toLocaleString(), inline: true },
            { name: '📡 Ping', value: `${client.ws.ping}ms`, inline: true },
            { name: '⏱️ Uptime', value: uptime, inline: true },
            { name: '💾 Memory', value: `${memoryUsage} MB`, inline: true },
            { name: '🟢 Node.js', value: process.version, inline: true }
        );

        embed.setFooter({
            text: 'DBL Bot • Live Statistics',
            iconURL: client.user.displayAvatarURL({ size: 64 })
        });

        return embed;
    }

    // Vote embed
    vote(client, options = {}) {
        const embed = this.createEmbed({ 
            color: '#ff6b6b', 
            ...options 
        });
        
        embed.setTitle('🗳️ Vote for the Bot!');
        embed.setDescription('Support the bot by voting on these platforms:');
        embed.setThumbnail(client.user.displayAvatarURL());
        
        embed.addFields(
            { 
                name: '🏆 Top.gg', 
                value: `[Vote Here](https://top.gg/bot/${client.user.id}/vote)`, 
                inline: true 
            },
            { 
                name: '🤖 Discord.bots.gg', 
                value: `[Vote Here](https://discord.bots.gg/bots/${client.user.id})`, 
                inline: true 
            }
        );
        
        embed.setFooter({ text: 'Thank you for your support! ❤️' });
        
        return embed;
    }

    // Ping embed
    ping(client, responseTime, options = {}) {
        const embed = this.createEmbed({
            color: '#5865f2', // Discord blurple
            ...options
        });

        embed.setTitle('🏓 Pong!');

        // Status indicator based on ping
        let status = '🟢 Excellent';
        if (client.ws.ping > 100) status = '🟡 Good';
        if (client.ws.ping > 200) status = '🟠 Fair';
        if (client.ws.ping > 500) status = '🔴 Poor';

        embed.addFields(
            { name: '📡 API Latency', value: `${client.ws.ping}ms`, inline: true },
            { name: '🤖 Response Time', value: `${responseTime}ms`, inline: true },
            { name: '📊 Status', value: status, inline: true }
        );

        embed.setFooter({
            text: 'DBL Bot • Network Performance',
            iconURL: client.user.displayAvatarURL({ size: 64 })
        });

        return embed;
    }

    // Welcome embed for new servers
    welcome(guild, options = {}) {
        const embed = this.createEmbed({
            color: '#5865f2', // Discord blurple
            ...options
        });

        embed.setTitle('👋 Welcome to DBL Bot');
        embed.setDescription(`Hello **${guild.name}**! Thanks for adding me to your server.`);

        embed.setThumbnail(guild.iconURL({ size: 256 }) || null);

        embed.addFields(
            {
                name: '🚀 Quick Start',
                value: 'Use `/help` to see all available commands',
                inline: false
            },
            {
                name: '⚡ Features',
                value: 'Modern slash commands, interactive components, and more',
                inline: true
            },
            {
                name: '� Technology',
                value: 'Built with Discord.js v14 and modern architecture',
                inline: true
            }
        );

        embed.setFooter({
            text: 'DBL Bot • Modern Discord Bot',
            iconURL: guild.iconURL({ size: 64 }) || null
        });

        return embed;
    }

    // Utility function to format uptime
    formatUptime(uptime) {
        const seconds = Math.floor((uptime / 1000) % 60);
        const minutes = Math.floor((uptime / (1000 * 60)) % 60);
        const hours = Math.floor((uptime / (1000 * 60 * 60)) % 24);
        const days = Math.floor(uptime / (1000 * 60 * 60 * 24));

        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (seconds > 0) parts.push(`${seconds}s`);

        return parts.join(' ') || '0s';
    }

    // Format user with clickable mention and ID
    formatUser(user) {
        return `<@${user.id}> (\`${user.id}\`)`;
    }

    // Format user mention only
    formatUserMention(user) {
        return `<@${user.id}>`;
    }

    // Format user with tag and clickable mention
    formatUserWithTag(user) {
        return `<@${user.id}> (\`${user.tag}\`)`;
    }

    // Create paginated embed
    createPaginated(data, itemsPerPage = 10, options = {}) {
        const pages = [];
        const totalPages = Math.ceil(data.length / itemsPerPage);
        
        for (let i = 0; i < totalPages; i++) {
            const start = i * itemsPerPage;
            const end = start + itemsPerPage;
            const pageData = data.slice(start, end);
            
            const embed = this.createEmbed(options);
            embed.setFooter({ 
                text: `${options.footerText || config.embeds.footer.text} • Page ${i + 1}/${totalPages}`,
                iconURL: options.footerIcon || config.embeds.footer.iconURL
            });
            
            pages.push({ embed, data: pageData });
        }
        
        return pages;
    }
}

// Export singleton instance
module.exports = new AdvancedEmbedBuilder();
