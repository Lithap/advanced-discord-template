# DBL Bot Advanced

A professional Discord bot built with Discord.js v14, featuring enterprise-grade architecture and comprehensive functionality for Discord Bot List integration.

[![Discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)](https://discord.js.org/)
[![Node.js](https://img.shields.io/badge/node.js-16+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Features

- **Modern Architecture**: Built with Discord.js v14 and enterprise patterns
- **Database Integration**: MongoDB support with health monitoring
- **Performance Monitoring**: Real-time metrics and system analytics
- **Modular Design**: Clean separation of concerns with service containers
- **Error Handling**: Comprehensive error management and logging
- **Interactive Components**: Advanced button and select menu systems
- **Command System**: Slash commands with cooldowns and permissions
- **Event Handling**: Robust event processing and management

## Quick Start

### Prerequisites

- Node.js 16.11.0 or higher
- MongoDB database
- Discord bot token

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your-username/dbl-bot-advanced.git
cd dbl-bot-advanced
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

4. Edit `.env` with your configuration:
```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
OWNER_ID=your_user_id_here
DATABASE_URL=your_mongodb_connection_string
```

5. Deploy commands and start the bot:
```bash
npm run deploy
npm start
```

## Commands

### General Commands
- `/ping` - Check bot latency and performance metrics
- `/help` - Display available commands and categories
- `/serverinfo` - Show detailed server information

### Utility Commands
- `/database` - Database health check and statistics
- `/system` - System performance and monitoring

### Admin Commands
- `/reload` - Reload bot commands (owner only)
- `/shutdown` - Gracefully shutdown the bot (owner only)

## Configuration

The bot uses environment variables for configuration. Create a `.env` file based on `.env.example`:

### Required Variables
- `DISCORD_TOKEN` - Your Discord bot token
- `CLIENT_ID` - Your Discord application client ID
- `OWNER_ID` - Your Discord user ID (for admin commands)

### Optional Variables
- `DATABASE_URL` - MongoDB connection string
- `TEST_GUILD_ID` - Guild ID for testing commands
- `LOG_LEVEL` - Logging level (debug, info, warn, error)
- `MAINTENANCE_MODE` - Enable maintenance mode (true/false)

## Project Structure

```
src/
├── commands/           # Slash commands organized by category
│   ├── admin/         # Administrative commands
│   ├── general/       # General purpose commands
│   ├── info/          # Information commands
│   └── utility/       # Utility commands
├── core/              # Core application components
│   └── Application.js # Main application class
├── events/            # Discord event handlers
├── handlers/          # Command and interaction handlers
├── services/          # Business logic services
│   └── database/      # Database services
├── utils/             # Utility functions and helpers
├── config/            # Configuration management
└── index.js           # Application entry point
```

## Development

### Scripts

- `npm start` - Start the bot
- `npm run dev` - Start with nodemon for development
- `npm run deploy` - Deploy slash commands
- `npm run deploy-global` - Deploy commands globally
- `npm run deploy-guild` - Deploy commands to test guild
- `npm run validate` - Validate configuration

### Adding Commands

1. Create a new command file in the appropriate category folder
2. Follow the command structure:

```javascript
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('example')
        .setDescription('Example command'),
    
    category: 'general',
    cooldown: 3,
    
    async execute(interaction) {
        await interaction.reply('Hello World!');
    }
};
```

3. The command will be automatically loaded on restart

## Architecture

The bot follows enterprise patterns with:

- **Service Container**: Dependency injection and service management
- **Event-Driven Architecture**: Loose coupling between components
- **Error Boundaries**: Comprehensive error handling and recovery
- **Performance Monitoring**: Real-time metrics and analytics
- **Modular Design**: Easy to extend and maintain

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support and questions:
- Create an issue on GitHub
- Join our Discord server (if applicable)
- Check the documentation

## Acknowledgments

- Discord.js community for the excellent library
- Contributors and testers
- Open source projects that inspired this architecture
