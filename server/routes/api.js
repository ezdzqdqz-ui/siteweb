/* ============================================================
   TTM — API Routes (Profile, Contacts, etc.)
   ============================================================ */
const router = require('express').Router();
const User = require('../models/User');

// ---- Middleware: vérifier auth ----
function requireAuth(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) return next();
    res.status(401).json({ ok: false, error: 'Non connecté' });
}

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

        const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });
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

module.exports = router;
