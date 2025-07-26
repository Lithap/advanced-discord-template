const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    username: {
        type: String,
        required: true
    },
    discriminator: {
        type: String,
        default: '0'
    },
    avatar: {
        type: String,
        default: null
    },
    profile: {
        bio: { type: String, default: null },
        timezone: { type: String, default: 'UTC' },
        language: { type: String, default: 'en' }
    },
    statistics: {
        commandsUsed: { type: Number, default: 0 },
        messagesProcessed: { type: Number, default: 0 },
        lastSeen: { type: Date, default: Date.now },
        firstSeen: { type: Date, default: Date.now }
    },
    preferences: {
        dmNotifications: { type: Boolean, default: true },
        publicProfile: { type: Boolean, default: true }
    },
    economy: {
        balance: { type: Number, default: 0 },
        bank: { type: Number, default: 0 },
        lastDaily: { type: Date, default: null },
        lastWeekly: { type: Date, default: null }
    },
    achievements: [{
        name: String,
        description: String,
        unlockedAt: { type: Date, default: Date.now },
        rarity: { type: String, enum: ['common', 'rare', 'epic', 'legendary'], default: 'common' }
    }],
    isBlacklisted: {
        type: Boolean,
        default: false
    },
    blacklistReason: {
        type: String,
        default: null
    }
}, {
    timestamps: true,
    collection: 'users'
});

// Indexes for better performance
userSchema.index({ userId: 1 });
userSchema.index({ isBlacklisted: 1 });
userSchema.index({ 'statistics.lastSeen': -1 });

// Methods
userSchema.methods.updateActivity = function() {
    this.statistics.lastSeen = new Date();
    return this.save();
};

userSchema.methods.incrementCommands = function() {
    this.statistics.commandsUsed += 1;
    this.statistics.lastSeen = new Date();
    return this.save();
};

userSchema.methods.addAchievement = function(name, description, rarity = 'common') {
    // Check if achievement already exists
    const exists = this.achievements.some(achievement => achievement.name === name);
    if (!exists) {
        this.achievements.push({
            name,
            description,
            rarity,
            unlockedAt: new Date()
        });
        return this.save();
    }
    return Promise.resolve(this);
};

// Static methods
userSchema.statics.findByUserId = function(userId) {
    return this.findOne({ userId });
};

userSchema.statics.getTopUsers = function(limit = 10) {
    return this.find({ isBlacklisted: false })
        .sort({ 'statistics.commandsUsed': -1 })
        .limit(limit);
};

module.exports = mongoose.model('User', userSchema);
