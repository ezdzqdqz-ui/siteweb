/* ============================================================
   TTM — Auth Routes (Discord OAuth2)
   ============================================================ */
const router = require('express').Router();
const passport = require('passport');

// ---- Lancer le flow OAuth Discord ----
router.get('/discord', passport.authenticate('discord'));

// ---- Callback après Discord ----
router.get('/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/login.html?error=auth_failed' }),
    (req, res) => {
        // Auth réussie → redirect vers le site
        res.redirect(process.env.CLIENT_URL || '/');
    }
);

// ---- Récupérer l'utilisateur connecté (API JSON) ----
router.get('/me', (req, res) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ ok: false, error: 'Non connecté' });
    }
    res.json({ ok: true, user: req.user });
});

// ---- Déconnexion ----
router.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            res.redirect('/login.html');
        });
    });
});

module.exports = router;
