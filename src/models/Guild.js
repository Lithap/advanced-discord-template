const mongoose = require('mongoose');

const guildSchema = new mongoose.Schema({
    guildId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    name: {
        type: String,
        required: true
    },
    ownerId: {
        type: String,
        required: true
    },
    memberCount: {
        type: Number,
        default: 0
    },
    settings: {
        prefix: {
            type: String,
            default: '!'
        },
        language: {
            type: String,
            default: 'en'
        },
        timezone: {
            type: String,
            default: 'UTC'
        }
    },
    features: {
        welcomeMessages: {
            enabled: { type: Boolean, default: false },
            channelId: { type: String, default: null },
            message: { type: String, default: 'Welcome {user} to {guild}!' }
        },
        moderation: {
            enabled: { type: Boolean, default: false },
            logChannelId: { type: String, default: null }
        }
    },
    statistics: {
        commandsUsed: { type: Number, default: 0 },
        messagesProcessed: { type: Number, default: 0 },
        lastActivity: { type: Date, default: Date.now }
    },
    joinedAt: {
        type: Date,
        default: Date.now
    },
    leftAt: {
        type: Date,
        default: null
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true,
    collection: 'guilds'
});

// Indexes for better performance
guildSchema.index({ guildId: 1 });
guildSchema.index({ isActive: 1 });
guildSchema.index({ 'statistics.lastActivity': -1 });

// Methods
guildSchema.methods.updateActivity = function() {
    this.statistics.lastActivity = new Date();
    return this.save();
};

guildSchema.methods.incrementCommands = function() {
    this.statistics.commandsUsed += 1;
    this.statistics.lastActivity = new Date();
    return this.save();
};

// Static methods
guildSchema.statics.findByGuildId = function(guildId) {
    return this.findOne({ guildId });
};

guildSchema.statics.getActiveGuilds = function() {
    return this.find({ isActive: true });
};

module.exports = mongoose.model('Guild', guildSchema);
