/* ============================================================
   TTM — API Routes (Profile, Contacts, Sync, etc.)
   ============================================================ */
const router = require('express').Router();
const crypto = require('crypto');
const User = require('../models/User');
const Message = require('../models/Message');

// ---- Middleware: vérifier auth ----
function requireAuth(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) return next();
    if (req.user) return next(); // local session
    res.status(401).json({ ok: false, error: 'Non connecté' });
}

/* ============================================================
   SYNC ENDPOINTS (pas d'auth requise — mode local)
   ============================================================ */

// ---- Sync: register local user ----
router.post('/sync/register', async (req, res) => {
    try {
        const { localId, username, password } = req.body;
        if (!localId || !username) return res.status(400).json({ ok: false, error: 'Données manquantes' });

        // Check if username already exists in MongoDB
        const existing = await User.findOne({ username: { $regex: `^${username.trim()}$`, $options: 'i' } });
        if (existing && existing.localId !== localId) {
            return res.status(409).json({ ok: false, error: 'Ce pseudo est déjà pris' });
        }

        const hash = password ? crypto.createHash('sha256').update(password).digest('hex') : '';

        const user = await User.findOneAndUpdate(
            { localId },
            {
                $set: {
                    username: username.trim(),
                    passwordHash: hash,
                    status: 'online',
                    lastSeen: new Date(),
                },
                $setOnInsert: { localId },
            },
            { upsert: true, returnDocument: 'after' }
        );

        res.json({ ok: true, id: user._id, localId: user.localId });
    } catch (e) {
        console.error('Sync register error:', e.message);
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Sync: save profile ----
router.post('/sync/profile', async (req, res) => {
    try {
        const { localId, profile } = req.body;
        if (!localId) return res.status(400).json({ ok: false, error: 'localId manquant' });

        const update = {};
        const fields = [
            'username', 'tagline', 'description', 'avatar', 'country',
            'platform', 'playstyle', 'mic', 'languages', 'games',
            'availability', 'tags', 'lookingFor', 'stats', 'discord',
        ];
        fields.forEach(f => {
            if (profile[f] !== undefined) update[f] = profile[f];
        });
        update.status = 'online';
        update.lastSeen = new Date();

        const user = await User.findOneAndUpdate(
            { localId },
            { $set: update, $setOnInsert: { localId } },
            { upsert: true, returnDocument: 'after' }
        );

        res.json({ ok: true, id: user._id });
    } catch (e) {
        console.error('Sync profile error:', e.message);
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Sync: get all players ----
router.get('/sync/players', async (req, res) => {
    try {
        const exclude = req.query.exclude || ''; // localId to exclude (self)
        const filter = { username: { $exists: true, $ne: '' } };
        if (exclude) filter.localId = { $ne: exclude };

        const players = await User.find(filter)
            .select('-passwordHash -email -guilds')
            .sort({ lastSeen: -1 })
            .limit(100);

        res.json({ ok: true, players });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Sync: get one player ----
router.get('/sync/players/:id', async (req, res) => {
    try {
        let player = null;
        // Try by MongoDB _id
        if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
            player = await User.findById(req.params.id).select('-passwordHash -email -guilds');
        }
        // Try by localId
        if (!player) {
            player = await User.findOne({ localId: req.params.id }).select('-passwordHash -email -guilds');
        }
        if (!player) return res.status(404).json({ ok: false, error: 'Joueur introuvable' });
        res.json({ ok: true, player });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Récupérer son propre profil ----
router.get('/profile', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ ok: false, error: 'Profil introuvable' });
        res.json({ ok: true, profile: user });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Mettre à jour son profil ----
router.put('/profile', requireAuth, async (req, res) => {
    try {
        const allowed = [
            'tagline', 'description', 'country', 'platform', 'playstyle',
            'mic', 'languages', 'games', 'availability', 'lookingFor', 'tags'
        ];
        const update = {};
        allowed.forEach(key => {
            if (req.body[key] !== undefined) update[key] = req.body[key];
        });

        // Validate tags structure
        if (update.tags && typeof update.tags === 'object' && !Array.isArray(update.tags)) {
            const validCats = ['jeu', 'niveau', 'style', 'contraintes', 'dispo'];
            const cleaned = {};
            validCats.forEach(c => {
                cleaned[c] = Array.isArray(update.tags[c]) ? update.tags[c].map(String).slice(0, 10) : [];
            });
            update.tags = cleaned;
        }

        // Recalculate stats
        if (update.games) {
            update['stats.currentGames'] = update.games.length;
        }

        const user = await User.findByIdAndUpdate(req.user._id, update, { returnDocument: 'after' });
        res.json({ ok: true, profile: user });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Récupérer un joueur par ID ----
router.get('/players/:id', requireAuth, async (req, res) => {
    try {
        const player = await User.findById(req.params.id)
            .select('-email -guilds');
        if (!player) return res.status(404).json({ ok: false, error: 'Joueur introuvable' });
        res.json({ ok: true, player });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Lister les joueurs (discover) ----
router.get('/players', requireAuth, async (req, res) => {
    try {
        const { game, style, lang, tags, q } = req.query;
        const filter = { _id: { $ne: req.user._id } };

        if (game)  filter['games.gameId'] = game;
        if (style) filter.playstyle = style;
        if (lang)  filter.languages = lang;
        if (tags) {
            const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
            if (tagList.length) {
                // Match across all tag sub-categories
                const tagConditions = tagList.map(t => ({
                    $or: [
                        { 'tags.jeu': t },
                        { 'tags.niveau': t },
                        { 'tags.style': t },
                        { 'tags.contraintes': t },
                        { 'tags.dispo': t },
                    ]
                }));
                filter.$and = (filter.$and || []).concat(tagConditions);
            }
        }
        if (q) {
            filter.$or = [
                { username: { $regex: q, $options: 'i' } },
                { tagline: { $regex: q, $options: 'i' } },
                { 'games.gameName': { $regex: q, $options: 'i' } },
            ];
        }

        const players = await User.find(filter)
            .select('-email -guilds')
            .sort({ lastSeen: -1 })
            .limit(50);

        res.json({ ok: true, players });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Rechercher des joueurs ----
router.get('/search', requireAuth, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json({ ok: true, results: [] });

        const players = await User.find({
            _id: { $ne: req.user._id },
            $or: [
                { username: { $regex: q, $options: 'i' } },
                { tagline: { $regex: q, $options: 'i' } },
            ],
        })
            .select('username avatar discordId tagline status stats')
            .limit(8);

        res.json({ ok: true, results: players });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Contacts: ajouter ----
router.post('/contacts/:id', requireAuth, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user._id, { $addToSet: { contacts: req.params.id } });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Contacts: retirer ----
router.delete('/contacts/:id', requireAuth, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user._id, { $pull: { contacts: req.params.id } });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Contacts: liste ----
router.get('/contacts', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).populate('contacts', 'username avatar discordId tagline status stats');
        res.json({ ok: true, contacts: user.contacts || [] });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

/* ============================================================
   SYNC: Contacts (mode local — pas d'auth)
   ============================================================ */

// ---- Sync: get contacts ----
router.get('/sync/contacts', async (req, res) => {
    try {
        const { localId } = req.query;
        if (!localId) return res.status(400).json({ ok: false, error: 'localId manquant' });
        const user = await User.findOne({ localId });
        if (!user) return res.json({ ok: true, contacts: [] });
        res.json({ ok: true, contacts: user.contacts || [] });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Sync: add contact ----
router.post('/sync/contacts', async (req, res) => {
    try {
        const { localId, contactLocalId } = req.body;
        if (!localId || !contactLocalId) return res.status(400).json({ ok: false, error: 'Données manquantes' });
        await User.findOneAndUpdate({ localId }, { $addToSet: { contacts: contactLocalId } });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Sync: remove contact ----
router.delete('/sync/contacts', async (req, res) => {
    try {
        const { localId, contactLocalId } = req.body;
        if (!localId || !contactLocalId) return res.status(400).json({ ok: false, error: 'Données manquantes' });
        await User.findOneAndUpdate({ localId }, { $pull: { contacts: contactLocalId } });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

/* ============================================================
   SYNC: Messages (mode local — pas d'auth)
   ============================================================ */

// ---- Sync: send message ----
router.post('/sync/messages', async (req, res) => {
    try {
        const { from, to, text, isInvite, inviteGame } = req.body;
        if (!from || !to || !text) return res.status(400).json({ ok: false, error: 'Données manquantes' });

        const msg = await Message.create({
            from, to, text,
            isInvite: isInvite || false,
            inviteGame: inviteGame || '',
            inviteStatus: isInvite ? 'sent' : '',
        });

        // Auto-add as contacts
        await User.findOneAndUpdate({ localId: from }, { $addToSet: { contacts: to } });
        await User.findOneAndUpdate({ localId: to }, { $addToSet: { contacts: from } });

        res.json({ ok: true, message: msg });
    } catch (e) {
        console.error('Sync message error:', e.message);
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Sync: get messages with a player ----
router.get('/sync/messages', async (req, res) => {
    try {
        const { localId, with: withId } = req.query;
        if (!localId || !withId) return res.status(400).json({ ok: false, error: 'Données manquantes' });

        const messages = await Message.find({
            $or: [
                { from: localId, to: withId },
                { from: withId, to: localId },
            ]
        }).sort({ createdAt: 1 }).limit(200);

        res.json({ ok: true, messages });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Sync: get all conversations (latest per contact) ----
router.get('/sync/conversations', async (req, res) => {
    try {
        const { localId } = req.query;
        if (!localId) return res.status(400).json({ ok: false, error: 'localId manquant' });

        // Get all messages involving this user
        const messages = await Message.find({
            $or: [{ from: localId }, { to: localId }]
        }).sort({ createdAt: -1 });

        // Group by conversation partner
        const convos = {};
        for (const msg of messages) {
            const partnerId = msg.from === localId ? msg.to : msg.from;
            if (!convos[partnerId]) {
                convos[partnerId] = {
                    partnerId,
                    lastMessage: msg.text,
                    lastTimestamp: msg.createdAt,
                    unread: 0,
                    messages: [],
                };
            }
            convos[partnerId].messages.push({
                id: msg._id,
                text: msg.text,
                fromMe: msg.from === localId,
                timestamp: msg.createdAt,
                read: msg.read,
                isInvite: msg.isInvite,
                inviteGame: msg.inviteGame,
            });
            if (!msg.read && msg.to === localId) {
                convos[partnerId].unread++;
            }
        }

        // Reverse messages to chronological order
        for (const c of Object.values(convos)) {
            c.messages.reverse();
        }

        res.json({ ok: true, conversations: convos });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Sync: mark messages as read ----
router.post('/sync/messages/read', async (req, res) => {
    try {
        const { localId, from } = req.body;
        if (!localId || !from) return res.status(400).json({ ok: false, error: 'Données manquantes' });

        await Message.updateMany(
            { from, to: localId, read: false },
            { $set: { read: true } }
        );

        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

// ---- Sync: get total unread count ----
router.get('/sync/unread', async (req, res) => {
    try {
        const { localId } = req.query;
        if (!localId) return res.status(400).json({ ok: false, error: 'localId manquant' });

        const count = await Message.countDocuments({ to: localId, read: false });
        res.json({ ok: true, count });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'Erreur serveur' });
    }
});

module.exports = router;
