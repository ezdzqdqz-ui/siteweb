/* ============================================================
   TTM — User Model (Mongoose)
   ============================================================ */
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    // ---- Discord OAuth2 Data ----
    discordId:       { type: String, sparse: true, unique: true, index: true },
    username:        { type: String, required: true },
    discriminator:   { type: String, default: '0' },
    avatar:          { type: String, default: '' },
    email:           { type: String, default: '' },
    guilds:          [{ id: String, name: String, icon: String }],

    // ---- Local Auth ----
    localId:         { type: String, sparse: true, unique: true },
    passwordHash:    { type: String },

    // ---- Profile ----
    tagline:         { type: String, default: '', maxlength: 60 },
    description:     { type: String, default: '', maxlength: 500 },
    country:         { type: String, default: '' },
    platform:        { type: String, default: '' },
    playstyle:       { type: String, default: '' },
    mic:             { type: Boolean, default: false },
    languages:       [{ type: String }],

    // ---- Tags (Étape 2 — catégorisés) ----
    tags: {
        jeu:         [{ type: String }],
        niveau:      [{ type: String }],
        style:       [{ type: String }],
        contraintes: [{ type: String }],
        dispo:       [{ type: String }],
    },

    // ---- Games ----
    games: [{
        gameId:   String,
        gameName: String,
        rank:     String,
        role:     String,
        mains:    String,
        hours:    String,
    }],

    // ---- Availability ----
    availability: {
        lun: [String], mar: [String], mer: [String], jeu: [String],
        ven: [String], sam: [String], dim: [String],
    },

    // ---- Looking For ----
    lookingFor: [{
        title: { type: String, maxlength: 40 },
        desc:  { type: String, maxlength: 80 },
    }],

    // ---- Stats ----
    stats: {
        level:        { type: Number, default: 1 },
        teammates:    { type: Number, default: 0 },
        events:       { type: Number, default: 0 },
        coopGames:    { type: Number, default: 0 },
        currentGames: { type: Number, default: 0 },
        referrals:    { type: Number, default: 0 },
    },

    // ---- Status ----
    status: {
        type: String,
        enum: ['online', 'idle', 'offline'],
        default: 'offline',
    },
    lastSeen: { type: Date, default: Date.now },

    // ---- Contacts (localId strings) ----
    contacts: [{ type: String }],

}, { timestamps: true });

// ---- Virtual: avatar URL ----
userSchema.virtual('avatarURL').get(function () {
    if (this.discordId && this.avatar) {
        return `https://cdn.discordapp.com/avatars/${this.discordId}/${this.avatar}.${this.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256`;
    }
    if (this.avatar && this.avatar.startsWith('http')) {
        return this.avatar;
    }
    // Default avatar via DiceBear
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(this.username || 'guest')}&backgroundColor=b6e3f4`;
});

// Ensure virtuals are included in JSON
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

// ---- Static: find or create from Discord profile ----
userSchema.statics.findOrCreateFromDiscord = async function (profile) {
    let user = await this.findOne({ discordId: profile.id });

    const updateData = {
        username:      profile.username,
        discriminator: profile.discriminator || '0',
        avatar:        profile.avatar || '',
        email:         profile.email || '',
        status:        'online',
        lastSeen:      new Date(),
    };

    // Store guilds if available
    if (profile.guilds && profile.guilds.length) {
        updateData.guilds = profile.guilds.slice(0, 50).map(g => ({
            id: g.id, name: g.name, icon: g.icon,
        }));
    }

    if (user) {
        Object.assign(user, updateData);
        await user.save();
    } else {
        user = await this.create({
            discordId: profile.id,
            ...updateData,
        });
    }

    return user;
};

module.exports = mongoose.model('User', userSchema);
