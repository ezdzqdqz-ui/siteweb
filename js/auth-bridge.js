/* ============================================================
   TTM — Auth Bridge
   Détecte automatiquement si le serveur est actif (Discord OAuth)
   ou si on tourne en mode local (localStorage).
   Expose une API unifiée : TTM_Auth
   ============================================================ */

const TTM_Auth = {
    _serverUser: null,
    _mode: null,  // 'server' | 'local'

    /* ---- Initialiser : tester le serveur ---- */
    async init() {
        try {
            const res = await fetch('/api/status', { credentials: 'include' });
            const data = await res.json();
            if (data.ok && data.mongodb) {
                // Serveur actif
                if (data.auth) {
                    // Connecté via Discord
                    const meRes = await fetch('/auth/me', { credentials: 'include' });
                    const meData = await meRes.json();
                    if (meData.ok) {
                        this._serverUser = meData.user;
                        this._mode = 'server';
                        return { mode: 'server', user: this._serverUser };
                    }
                }
                // Serveur actif mais pas connecté
                this._mode = 'server';
                return { mode: 'server', user: null };
            }
        } catch (e) {
            // Serveur pas actif → mode local
        }

        // Fallback mode local
        this._mode = 'local';
        if (TTM.Auth.isLoggedIn()) {
            return { mode: 'local', user: { username: TTM.Auth.getCurrentUsername() } };
        }
        return { mode: 'local', user: null };
    },

    /* ---- Est connecté ? ---- */
    isLoggedIn() {
        if (this._mode === 'server') return !!this._serverUser;
        return TTM.Auth.isLoggedIn();
    },

    /* ---- Récupérer l'utilisateur courant ---- */
    getUser() {
        if (this._mode === 'server') return this._serverUser;
        if (TTM.Auth.isLoggedIn()) {
            const profile = TTM.getProfile();
            return {
                username: profile.username || TTM.Auth.getCurrentUsername(),
                avatarURL: profile.avatar || null,
                discordId: null,
            };
        }
        return null;
    },

    /* ---- Nom du user ---- */
    getUsername() {
        const u = this.getUser();
        return u ? u.username : 'Guest';
    },

    /* ---- Avatar URL ---- */
    getAvatarURL() {
        const u = this.getUser();
        if (!u) return '';
        if (u.avatarURL) return u.avatarURL;
        return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.username || 'guest')}&backgroundColor=6c5ce7`;
    },

    /* ---- Déconnexion ---- */
    logout() {
        if (this._mode === 'server') {
            window.location.href = '/auth/logout';
        } else {
            TTM.Auth.logout();
        }
    },

    /* ---- Vérifier auth, rediriger si besoin ---- */
    requireAuth() {
        if (this.isLoggedIn()) return true;
        if (this._mode === 'local') {
            return TTM.Auth.requireAuth();
        }
        // Mode server mais pas connecté
        const page = location.pathname.split('/').pop();
        if (page !== 'login.html' && page !== 'login') {
            location.href = 'login.html';
        }
        return false;
    },

    /* ---- Mode actif ---- */
    getMode() {
        return this._mode;
    },
};

// Exposer globalement
window.TTM_Auth = TTM_Auth;
