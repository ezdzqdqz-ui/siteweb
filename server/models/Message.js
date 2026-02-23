/* ============================================================
   TTM — Message Model (Mongoose)
   Handles: chat messages + invitations
   ============================================================ */
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    from:       { type: String, required: true },  // localId or odej _id
    to:         { type: String, required: true },  // localId or _id
    text:       { type: String, required: true, maxlength: 1000 },
    read:       { type: Boolean, default: false },

    // Invitation data (optional)
    isInvite:   { type: Boolean, default: false },
    inviteGame: { type: String, default: '' },
    inviteStatus: { type: String, enum: ['sent', 'accepted', 'declined', ''], default: '' },
}, { timestamps: true });

// Index for efficient lookups
messageSchema.index({ from: 1, to: 1 });
messageSchema.index({ to: 1, read: 1 });

module.exports = mongoose.model('Message', messageSchema);
