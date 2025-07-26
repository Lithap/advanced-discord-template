const { SlashCommandBuilder } = require('discord.js');
const embedBuilder = require('../../utils/embedBuilder.js');
const { AdvancedComponentBuilder, AdvancedModalBuilder } = require('../../utils/componentBuilder.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('showcase')
        .setDescription('Showcase all advanced Discord.js v14 features')
        .addStringOption(option =>
            option.setName('demo')
                .setDescription('Choose which feature to demonstrate')
                .setRequired(false)
                .addChoices(
                    { name: '🔘 Buttons', value: 'buttons' },
                    { name: '📋 Select Menus', value: 'selects' },
                    { name: '📝 Modals', value: 'modals' },
                    { name: '📄 Pagination', value: 'pagination' },
                    { name: '✅ Confirmations', value: 'confirmations' },
                    { name: '🎨 All Features', value: 'all' }
                )
        ),
    
    category: 'utility',
    cooldown: 5,
    
    async execute(interaction) {
        const demo = interaction.options.getString('demo') || 'all';
        
        await interaction.deferReply();
        
        switch (demo) {
            case 'buttons':
                await this.showButtonDemo(interaction);
                break;
            case 'selects':
                await this.showSelectDemo(interaction);
                break;
            case 'modals':
                await this.showModalDemo(interaction);
                break;
            case 'pagination':
                await this.showPaginationDemo(interaction);
                break;
            case 'confirmations':
                await this.showConfirmationDemo(interaction);
                break;
            default:
                await this.showAllFeatures(interaction);
                break;
        }
        
        // Register custom handlers for this showcase
        this.registerShowcaseHandlers(interaction.client);
    },

    async showButtonDemo(interaction) {
        const embed = embedBuilder.createEmbed({
            color: '#0099ff'
        });
        
        embed.setTitle('🔘 Button Showcase');
        embed.setDescription('This demonstrates all button styles and features available in Discord.js v14.');
        
        const components = new AdvancedComponentBuilder()
            .createRow()
            .addPrimaryButton('showcase_primary', 'Primary', '🟦')
            .addSecondaryButton('showcase_secondary', 'Secondary', '⚪')
            .addSuccessButton('showcase_success', 'Success', '🟢')
            .addDangerButton('showcase_danger', 'Danger', '🔴')
            .createRow()
            .addLinkButton({
                label: 'Discord.js Guide',
                url: 'https://discordjs.guide/',
                emoji: '📚'
            })
            .addLinkButton({
                label: 'GitHub',
                url: 'https://github.com/discordjs/discord.js',
                emoji: '💻'
            })
            .createRow()
            .addRefreshButton('showcase_refresh')
            .addDeleteButton('delete_showcase')
            .build();
        
        await interaction.editReply({ embeds: [embed], components });
    },

    async showSelectDemo(interaction) {
        const embed = embedBuilder.createEmbed({
            color: '#ff6b6b'
        });
        
        embed.setTitle('📋 Select Menu Showcase');
        embed.setDescription('This demonstrates all types of select menus available in Discord.js v14.');
        
        const components = new AdvancedComponentBuilder()
            .createRow()
            .addStringSelect({
                id: 'showcase_string',
                placeholder: 'Choose your favorite programming language',
                options: [
                    { label: 'JavaScript', value: 'js', emoji: '🟨', description: 'The language of the web' },
                    { label: 'Python', value: 'py', emoji: '🐍', description: 'Simple and powerful' },
                    { label: 'TypeScript', value: 'ts', emoji: '🔷', description: 'JavaScript with types' },
                    { label: 'Rust', value: 'rs', emoji: '🦀', description: 'Fast and memory-safe' },
                    { label: 'Go', value: 'go', emoji: '🐹', description: 'Simple and efficient' }
                ]
            })
            .createRow()
            .addUserSelect({
                id: 'showcase_user',
                placeholder: 'Select users to mention',
                maxValues: 3
            })
            .createRow()
            .addRoleSelect({
                id: 'showcase_role',
                placeholder: 'Select roles to display',
                maxValues: 5
            })
            .createRow()
            .addChannelSelect({
                id: 'showcase_channel',
                placeholder: 'Select channels to list',
                channelTypes: [0, 2] // Text and Voice channels
            })
            .createRow()
            .addDeleteButton('delete_showcase')
            .build();
        
        await interaction.editReply({ embeds: [embed], components });
    },

    async showModalDemo(interaction) {
        const embed = embedBuilder.createEmbed({
            color: '#9b59b6'
        });
        
        embed.setTitle('📝 Modal Showcase');
        embed.setDescription('Click the button below to open an advanced modal form.');
        
        const components = new AdvancedComponentBuilder()
            .createRow()
            .addPrimaryButton('showcase_modal', 'Open Modal Form', '📝')
            .addSecondaryButton('showcase_feedback', 'Feedback Form', '💬')
            .addDeleteButton('delete_showcase')
            .build();
        
        await interaction.editReply({ embeds: [embed], components });
    },

    async showPaginationDemo(interaction) {
        const embed = embedBuilder.createEmbed({
            color: '#e67e22'
        });
        
        embed.setTitle('📄 Pagination Showcase - Page 1/5');
        embed.setDescription('This demonstrates advanced pagination with navigation controls.');
        embed.addFields(
            { name: 'Page 1 Content', value: 'This is the first page of content.', inline: false },
            { name: 'Feature', value: 'Advanced pagination system', inline: true },
            { name: 'Navigation', value: 'Use buttons below to navigate', inline: true }
        );
        
        const components = new AdvancedComponentBuilder()
            .addPaginationButtons(1, 5, 'showcase_page')
            .createRow()
            .addSecondaryButton('showcase_jump', 'Jump to Page', '🔢')
            .addDeleteButton('delete_showcase')
            .build();
        
        await interaction.editReply({ embeds: [embed], components });
    },

    async showConfirmationDemo(interaction) {
        const embed = embedBuilder.createEmbed({
            color: '#f39c12'
        });
        
        embed.setTitle('✅ Confirmation Showcase');
        embed.setDescription('This demonstrates confirmation dialogs and dangerous actions.');
        
        const components = new AdvancedComponentBuilder()
            .createRow()
            .addPrimaryButton('showcase_safe', 'Safe Action', '✅')
            .addDangerButton('showcase_dangerous', 'Dangerous Action', '⚠️')
            .createRow()
            .addDeleteButton('delete_showcase')
            .build();
        
        await interaction.editReply({ embeds: [embed], components });
    },

    async showAllFeatures(interaction) {
        const embed = embedBuilder.createEmbed({
            color: '#5865f2' // Discord blurple
        });

        embed.setTitle('🎨 DBL Bot Feature Showcase');
        embed.setDescription('This bot demonstrates modern Discord.js v14 features with clean architecture.');

        embed.setThumbnail(interaction.client.user.displayAvatarURL({ size: 256 }));

        embed.addFields(
            { name: '🔘 Interactive Buttons', value: 'All button styles with custom handlers', inline: true },
            { name: '📋 Select Menus', value: 'String, User, Role, Channel selects', inline: true },
            { name: '📝 Modal Forms', value: 'Advanced form handling', inline: true },
            { name: '📄 Pagination', value: 'Smart navigation system', inline: true },
            { name: '✅ Confirmations', value: 'Safe action verification', inline: true },
            { name: '🎯 Context Menus', value: 'Right-click interactions', inline: true }
        );

        embed.setFooter({
            text: 'DBL Bot • Select feature below to demo',
            iconURL: interaction.client.user.displayAvatarURL({ size: 64 })
        });
        
        const components = new AdvancedComponentBuilder()
            .createRow()
            .addStringSelect({
                id: 'showcase_demo',
                placeholder: 'Choose a feature to demonstrate',
                options: [
                    { label: 'Button Demo', value: 'buttons', emoji: '🔘' },
                    { label: 'Select Menu Demo', value: 'selects', emoji: '📋' },
                    { label: 'Modal Demo', value: 'modals', emoji: '📝' },
                    { label: 'Pagination Demo', value: 'pagination', emoji: '📄' },
                    { label: 'Confirmation Demo', value: 'confirmations', emoji: '✅' }
                ]
            })
            .createRow()
            .addPrimaryButton('showcase_info', 'Bot Info', 'ℹ️')
            .addSecondaryButton('showcase_stats', 'Statistics', '📊')
            .addSuccessButton('showcase_features', 'All Features', '🎨')
            .addDeleteButton('delete_showcase')
            .build();
        
        await interaction.editReply({ embeds: [embed], components });
    },

    registerShowcaseHandlers(client) {
        const handler = client.interactionHandler;
        
        // Button handlers
        handler.registerButtonHandler('showcase', async (interaction, params) => {
            const [action] = params;
            
            switch (action) {
                case 'primary':
                case 'secondary':
                case 'success':
                case 'danger':
                    const embed = embedBuilder.success('Button Clicked!', `You clicked the **${action}** button.`);
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                    break;
                    
                case 'modal':
                    const modal = new AdvancedModalBuilder('showcase_form', 'Advanced Form Example')
                        .addShortTextInput('name', 'Your Name', 'Enter your name...')
                        .addShortTextInput('email', 'Email Address', 'your@email.com', false)
                        .addLongTextInput('feedback', 'Feedback', 'Tell us what you think...', false)
                        .build();
                    
                    await interaction.showModal(modal);
                    break;
                    
                case 'dangerous':
                    const confirmEmbed = embedBuilder.warning('Confirm Action', 'Are you sure you want to perform this dangerous action?');
                    const confirmComponents = new AdvancedComponentBuilder()
                        .addConfirmationButtons('showcase_confirm_danger', 'showcase_cancel')
                        .build();
                    
                    await interaction.reply({ embeds: [confirmEmbed], components: confirmComponents, ephemeral: true });
                    break;
            }
        });
        
        // Select menu handlers
        handler.registerSelectMenuHandler('showcase', async (interaction, params) => {
            const [type] = params;
            const values = interaction.values;
            
            const embed = embedBuilder.info('Selection Made!', `You selected: ${values.join(', ')}`);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        });
        
        // Modal handlers
        handler.registerModalHandler('showcase', async (interaction, params) => {
            const name = interaction.fields.getTextInputValue('name');
            const email = interaction.fields.getTextInputValue('email') || 'Not provided';
            const feedback = interaction.fields.getTextInputValue('feedback') || 'No feedback';
            
            const embed = embedBuilder.success('Form Submitted!', 'Thank you for your submission!')
                .addFields(
                    { name: 'Name', value: name, inline: true },
                    { name: 'Email', value: email, inline: true },
                    { name: 'Feedback', value: feedback, inline: false }
                );
            
            await interaction.reply({ embeds: [embed], ephemeral: true });
        });
    }
};
