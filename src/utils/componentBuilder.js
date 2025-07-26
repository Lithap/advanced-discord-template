const { 
    ActionRowBuilder, 
    ButtonBuilder, 
    StringSelectMenuBuilder, 
    UserSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    MentionableSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    ButtonStyle,
    TextInputStyle,
    ChannelType
} = require('discord.js');

class AdvancedComponentBuilder {
    constructor() {
        this.components = [];
        this.currentRow = null;
    }

    // Create a new action row
    createRow() {
        if (this.currentRow && this.currentRow.components.length > 0) {
            this.components.push(this.currentRow);
        }
        this.currentRow = new ActionRowBuilder();
        return this;
    }

    // Finalize and return all components
    build() {
        if (this.currentRow && this.currentRow.components.length > 0) {
            this.components.push(this.currentRow);
        }
        return this.components;
    }

    // Clear all components
    clear() {
        this.components = [];
        this.currentRow = null;
        return this;
    }

    // BUTTON BUILDERS
    addButton(options) {
        if (!this.currentRow) this.createRow();
        
        const button = new ButtonBuilder()
            .setCustomId(options.id)
            .setLabel(options.label)
            .setStyle(this.getButtonStyle(options.style));

        if (options.emoji) button.setEmoji(options.emoji);
        if (options.disabled) button.setDisabled(options.disabled);

        this.currentRow.addComponents(button);
        return this;
    }

    addLinkButton(options) {
        if (!this.currentRow) this.createRow();
        
        const button = new ButtonBuilder()
            .setLabel(options.label)
            .setStyle(ButtonStyle.Link)
            .setURL(options.url);

        if (options.emoji) button.setEmoji(options.emoji);
        if (options.disabled) button.setDisabled(options.disabled);

        this.currentRow.addComponents(button);
        return this;
    }

    // Quick button presets
    addPrimaryButton(id, label, emoji = null) {
        return this.addButton({ id, label, style: 'primary', emoji });
    }

    addSecondaryButton(id, label, emoji = null) {
        return this.addButton({ id, label, style: 'secondary', emoji });
    }

    addSuccessButton(id, label, emoji = null) {
        return this.addButton({ id, label, style: 'success', emoji });
    }

    addDangerButton(id, label, emoji = null) {
        return this.addButton({ id, label, style: 'danger', emoji });
    }

    addDeleteButton(id = 'delete') {
        return this.addDangerButton(id, 'Delete', '🗑️');
    }

    addRefreshButton(id = 'refresh') {
        return this.addPrimaryButton(id, 'Refresh', '🔄');
    }

    addBackButton(id = 'back') {
        return this.addSecondaryButton(id, 'Back', '⬅️');
    }

    addNextButton(id = 'next') {
        return this.addSecondaryButton(id, 'Next', '➡️');
    }

    // SELECT MENU BUILDERS
    addStringSelect(options) {
        if (!this.currentRow) this.createRow();
        
        const select = new StringSelectMenuBuilder()
            .setCustomId(options.id)
            .setPlaceholder(options.placeholder || 'Select an option...')
            .addOptions(options.options);

        if (options.minValues) select.setMinValues(options.minValues);
        if (options.maxValues) select.setMaxValues(options.maxValues);
        if (options.disabled) select.setDisabled(options.disabled);

        this.currentRow.addComponents(select);
        return this;
    }

    addUserSelect(options) {
        if (!this.currentRow) this.createRow();
        
        const select = new UserSelectMenuBuilder()
            .setCustomId(options.id)
            .setPlaceholder(options.placeholder || 'Select users...');

        if (options.minValues) select.setMinValues(options.minValues);
        if (options.maxValues) select.setMaxValues(options.maxValues);
        if (options.disabled) select.setDisabled(options.disabled);

        this.currentRow.addComponents(select);
        return this;
    }

    addRoleSelect(options) {
        if (!this.currentRow) this.createRow();
        
        const select = new RoleSelectMenuBuilder()
            .setCustomId(options.id)
            .setPlaceholder(options.placeholder || 'Select roles...');

        if (options.minValues) select.setMinValues(options.minValues);
        if (options.maxValues) select.setMaxValues(options.maxValues);
        if (options.disabled) select.setDisabled(options.disabled);

        this.currentRow.addComponents(select);
        return this;
    }

    addChannelSelect(options) {
        if (!this.currentRow) this.createRow();
        
        const select = new ChannelSelectMenuBuilder()
            .setCustomId(options.id)
            .setPlaceholder(options.placeholder || 'Select channels...');

        if (options.channelTypes) select.setChannelTypes(options.channelTypes);
        if (options.minValues) select.setMinValues(options.minValues);
        if (options.maxValues) select.setMaxValues(options.maxValues);
        if (options.disabled) select.setDisabled(options.disabled);

        this.currentRow.addComponents(select);
        return this;
    }

    addMentionableSelect(options) {
        if (!this.currentRow) this.createRow();
        
        const select = new MentionableSelectMenuBuilder()
            .setCustomId(options.id)
            .setPlaceholder(options.placeholder || 'Select mentionables...');

        if (options.minValues) select.setMinValues(options.minValues);
        if (options.maxValues) select.setMaxValues(options.maxValues);
        if (options.disabled) select.setDisabled(options.disabled);

        this.currentRow.addComponents(select);
        return this;
    }

    // PAGINATION HELPERS
    addPaginationButtons(currentPage, totalPages, prefix = 'page') {
        this.createRow();
        
        // First page button
        this.addButton({
            id: `${prefix}_first`,
            label: '⏪',
            style: 'secondary',
            disabled: currentPage === 1
        });

        // Previous page button
        this.addButton({
            id: `${prefix}_prev`,
            label: '◀️',
            style: 'secondary',
            disabled: currentPage === 1
        });

        // Page indicator
        this.addButton({
            id: `${prefix}_current`,
            label: `${currentPage}/${totalPages}`,
            style: 'secondary',
            disabled: true
        });

        // Next page button
        this.addButton({
            id: `${prefix}_next`,
            label: '▶️',
            style: 'secondary',
            disabled: currentPage === totalPages
        });

        // Last page button
        this.addButton({
            id: `${prefix}_last`,
            label: '⏩',
            style: 'secondary',
            disabled: currentPage === totalPages
        });

        return this;
    }

    // CONFIRMATION HELPERS
    addConfirmationButtons(confirmId = 'confirm', cancelId = 'cancel') {
        this.createRow();
        this.addSuccessButton(confirmId, 'Confirm', '✅');
        this.addDangerButton(cancelId, 'Cancel', '❌');
        return this;
    }

    // UTILITY METHODS
    getButtonStyle(style) {
        const styles = {
            'primary': ButtonStyle.Primary,
            'secondary': ButtonStyle.Secondary,
            'success': ButtonStyle.Success,
            'danger': ButtonStyle.Danger,
            'link': ButtonStyle.Link
        };
        return styles[style] || ButtonStyle.Secondary;
    }

    // Create quick option objects for select menus
    static createSelectOption(label, value, description = null, emoji = null, isDefault = false) {
        const option = { label, value };
        if (description) option.description = description;
        if (emoji) option.emoji = emoji;
        if (isDefault) option.default = isDefault;
        return option;
    }

    // Create multiple options at once
    static createSelectOptions(optionsArray) {
        return optionsArray.map(opt => {
            if (typeof opt === 'string') {
                return { label: opt, value: opt.toLowerCase().replace(/\s+/g, '_') };
            }
            return this.createSelectOption(opt.label, opt.value, opt.description, opt.emoji, opt.default);
        });
    }
}

// MODAL BUILDER CLASS
class AdvancedModalBuilder {
    constructor(id, title) {
        this.modal = new ModalBuilder()
            .setCustomId(id)
            .setTitle(title);
        this.components = [];
    }

    addTextInput(options) {
        const textInput = new TextInputBuilder()
            .setCustomId(options.id)
            .setLabel(options.label)
            .setStyle(this.getTextInputStyle(options.style || 'short'));

        if (options.placeholder) textInput.setPlaceholder(options.placeholder);
        if (options.value) textInput.setValue(options.value);
        if (options.required !== undefined) textInput.setRequired(options.required);
        if (options.minLength) textInput.setMinLength(options.minLength);
        if (options.maxLength) textInput.setMaxLength(options.maxLength);

        const row = new ActionRowBuilder().addComponents(textInput);
        this.components.push(row);
        return this;
    }

    addShortTextInput(id, label, placeholder = null, required = true) {
        return this.addTextInput({
            id, label, placeholder, required,
            style: 'short'
        });
    }

    addLongTextInput(id, label, placeholder = null, required = true) {
        return this.addTextInput({
            id, label, placeholder, required,
            style: 'paragraph'
        });
    }

    getTextInputStyle(style) {
        const styles = {
            'short': TextInputStyle.Short,
            'paragraph': TextInputStyle.Paragraph
        };
        return styles[style] || TextInputStyle.Short;
    }

    build() {
        this.modal.addComponents(...this.components);
        return this.modal;
    }
}

// Export both classes
module.exports = {
    AdvancedComponentBuilder,
    AdvancedModalBuilder
};
