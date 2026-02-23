/* ========================================
   TTM — Data Layer v2
   Auth + localStorage + real users
   ======================================== */

const TTM = {

    // ==========================================================
    //  AUTH SYSTEM
    // ==========================================================
    Auth: {
        USERS_KEY: 'ttm_users',
        SESSION_KEY: 'ttm_session',

        _hash(str) {
            const salt = 'ttm_2026_';
            const s = salt + str;
            let h = 0;
            for (let i = 0; i < s.length; i++) {
                h = ((h << 5) - h) + s.charCodeAt(i);
                h = h & h;
            }
            return 'h' + Math.abs(h).toString(36);
        },

        _getUsers() {
            return JSON.parse(localStorage.getItem(this.USERS_KEY) || '[]');
        },

        _saveUsers(users) {
            localStorage.setItem(this.USERS_KEY, JSON.stringify(users));
        },

        register(username, password) {
            username = username.trim();
            if (!username || username.length < 3) return { ok: false, error: 'Pseudo trop court (min 3 caractères)' };
            if (!password || password.length < 4) return { ok: false, error: 'Mot de passe trop court (min 4 caractères)' };

            const users = this._getUsers();
            if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
                return { ok: false, error: 'Ce pseudo est déjà pris' };
            }

            const userId = 'u_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            const user = {
                id: userId,
                username,
                passwordHash: this._hash(password),
                createdAt: new Date().toISOString()
            };
            users.push(user);
            this._saveUsers(users);

            // Create default profile
            const profile = JSON.parse(JSON.stringify(TTM.defaultProfile));
            profile.username = username;
            profile.createdAt = new Date().toISOString();
            localStorage.setItem(`ttm_profile_${userId}`, JSON.stringify(profile));

            this._setSession(user, true);
            return { ok: true, userId };
        },

        login(username, password, remember) {
            username = username.trim();
            const users = this._getUsers();
            const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
            if (!user) return { ok: false, error: 'Pseudo introuvable' };
            if (user.passwordHash !== this._hash(password)) return { ok: false, error: 'Mot de passe incorrect' };

            this._setSession(user, remember !== false);
            return { ok: true, userId: user.id };
        },

        _setSession(user, remember) {
            const session = {
                userId: user.id,
                username: user.username,
                loggedInAt: new Date().toISOString()
            };
            if (remember) {
                localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
            } else {
                sessionStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
            }
        },

        logout() {
            localStorage.removeItem(this.SESSION_KEY);
            sessionStorage.removeItem(this.SESSION_KEY);
            location.href = 'login.html';
        },

        isLoggedIn() {
            return !!(localStorage.getItem(this.SESSION_KEY) || sessionStorage.getItem(this.SESSION_KEY));
        },

        getSession() {
            const s = localStorage.getItem(this.SESSION_KEY) || sessionStorage.getItem(this.SESSION_KEY);
            return s ? JSON.parse(s) : null;
        },

        getCurrentUserId() {
            const s = this.getSession();
            return s ? s.userId : null;
        },

        getCurrentUsername() {
            const s = this.getSession();
            return s ? s.username : null;
        },

        requireAuth() {
            if (!this.isLoggedIn()) {
                const page = location.pathname.split('/').pop();
                if (page !== 'login.html' && page !== 'login') {
                    location.href = 'login.html';
                }
                return false;
            }
            return true;
        },

        changePassword(oldPassword, newPassword) {
            const session = this.getSession();
            if (!session) return { ok: false, error: 'Non connecté' };

            const users = this._getUsers();
            const user = users.find(u => u.id === session.userId);
            if (!user) return { ok: false, error: 'Utilisateur introuvable' };
            if (user.passwordHash !== this._hash(oldPassword)) return { ok: false, error: 'Ancien mot de passe incorrect' };
            if (newPassword.length < 4) return { ok: false, error: 'Nouveau mot de passe trop court (min 4)' };

            user.passwordHash = this._hash(newPassword);
            this._saveUsers(users);
            return { ok: true };
        },

        deleteAccount() {
            const session = this.getSession();
            if (!session) return;
            const uid = session.userId;

            let users = this._getUsers();
            users = users.filter(u => u.id !== uid);
            this._saveUsers(users);

            const toRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.includes(uid)) toRemove.push(key);
            }
            toRemove.forEach(k => localStorage.removeItem(k));

            this.logout();
        },

        getAccountCreatedAt() {
            const session = this.getSession();
            if (!session) return null;
            const users = this._getUsers();
            const user = users.find(u => u.id === session.userId);
            return user ? user.createdAt : null;
        }
    },

    // ==========================================================
    //  USER-SCOPED STORAGE KEY
    // ==========================================================
    _key(base) {
        const uid = this.Auth.getCurrentUserId();
        return uid ? `ttm_${base}_${uid}` : `ttm_${base}_guest`;
    },

    // ==========================================================
    //  DEFAULT PROFILE (empty)
    // ==========================================================
    defaultProfile: {
        username: '',
        tagline: '',
        description: '',
        avatar: '',
        banner: '',
        discord: '',
        country: '',
        languages: [],
        platform: '',
        playstyle: '',
        mic: false,
        games: [],
        availability: {
            lun: [], mar: [], mer: [], jeu: [], ven: [], sam: [], dim: []
        },
        stats: {
            level: 1,
            teammates: 0,
            events: 0,
            coopGames: 0,
            currentGames: 0,
            referrals: 0
        },
        tags: { jeu: [], niveau: [], style: [], contraintes: [], dispo: [] },
        lookingFor: [],
        createdAt: null
    },

    // ==========================================================
    //  PROFILE CRUD
    // ==========================================================
    getProfile() {
        const data = localStorage.getItem(this._key('profile'));
        if (!data) return JSON.parse(JSON.stringify(this.defaultProfile));
        return JSON.parse(data);
    },

    saveProfile(profile) {
        if (!profile.createdAt) profile.createdAt = new Date().toISOString();
        localStorage.setItem(this._key('profile'), JSON.stringify(profile));
    },

    isProfileSetup() {
        const p = this.getProfile();
        return p.username && p.username.trim() !== '';
    },

    // ==========================================================
    //  AUTO-COMPUTED STATS
    // ==========================================================
    computeStats() {
        const profileKey = this._key('profile');
        const raw = localStorage.getItem(profileKey);
        if (!raw) return null;

        const profile = JSON.parse(raw);
        const contacts = this.getContacts();
        const chats = this.getChats();
        const invites = this.getInvites();

        const teammates = contacts.length;
        const currentGames = profile.games ? profile.games.length : 0;
        const events = invites.length;
        const coopGames = Object.keys(chats).length;

        // XP calculation
        let xp = 0;
        if (profile.username) xp += 10;
        if (profile.tagline) xp += 5;
        if (profile.description) xp += 10;
        if (profile.discord) xp += 5;
        if (profile.avatar) xp += 5;
        if (profile.country) xp += 3;
        if (profile.platform) xp += 3;
        if (profile.playstyle) xp += 3;
        if (profile.mic) xp += 2;
        if (profile.languages && profile.languages.length) xp += profile.languages.length * 2;
        if (profile.lookingFor && profile.lookingFor.length) xp += profile.lookingFor.length * 4;
        const hasAvail = profile.availability && Object.values(profile.availability).some(a => a.length > 0);
        if (hasAvail) xp += 8;

        xp += currentGames * 8;
        xp += teammates * 4;
        xp += events * 3;
        xp += coopGames * 5;

        let msgsSent = 0;
        Object.values(chats).forEach(msgs => {
            msgsSent += msgs.filter(m => m.fromMe).length;
        });
        xp += Math.min(msgsSent * 2, 200);

        const level = Math.max(1, Math.min(99, Math.floor(xp / 10)));

        profile.stats = {
            level,
            teammates,
            events,
            coopGames,
            currentGames,
            referrals: profile.stats ? (profile.stats.referrals || 0) : 0
        };

        localStorage.setItem(profileKey, JSON.stringify(profile));
        return profile.stats;
    },

    getProfileCompleteness() {
        const p = this.getProfile();
        let filled = 0;
        const total = 11;
        if (p.username) filled++;
        if (p.tagline) filled++;
        if (p.description) filled++;
        if (p.discord) filled++;
        if (p.country) filled++;
        if (p.platform) filled++;
        if (p.playstyle) filled++;
        if (p.languages && p.languages.length) filled++;
        if (p.games && p.games.length) filled++;
        if (p.availability && Object.values(p.availability).some(a => a.length)) filled++;
        if (p.tags && this.flattenTags(p.tags).length) filled++;
        return Math.round((filled / total) * 100);
    },

    // ==========================================================
    //  CONTACTS
    // ==========================================================
    getContacts() {
        const data = localStorage.getItem(this._key('contacts'));
        return data ? JSON.parse(data) : [];
    },

    addContact(playerId) {
        const contacts = this.getContacts();
        if (!contacts.includes(playerId)) {
            contacts.push(playerId);
            localStorage.setItem(this._key('contacts'), JSON.stringify(contacts));
        }
    },

    removeContact(playerId) {
        let contacts = this.getContacts();
        contacts = contacts.filter(c => c !== playerId);
        localStorage.setItem(this._key('contacts'), JSON.stringify(contacts));
    },

    isContact(playerId) {
        return this.getContacts().includes(playerId);
    },

    // ==========================================================
    //  CHAT
    // ==========================================================
    getChats() {
        const data = localStorage.getItem(this._key('chats'));
        return data ? JSON.parse(data) : {};
    },

    getChatWith(playerId) {
        const chats = this.getChats();
        return chats[playerId] || [];
    },

    sendMessage(playerId, text, fromMe) {
        if (fromMe === undefined) fromMe = true;
        const chats = this.getChats();
        if (!chats[playerId]) chats[playerId] = [];
        chats[playerId].push({
            id: Date.now(),
            text: text,
            fromMe: fromMe,
            timestamp: new Date().toISOString(),
            read: fromMe
        });
        localStorage.setItem(this._key('chats'), JSON.stringify(chats));

        this.addContact(playerId);

        if (fromMe) {
            setTimeout(() => this._simulateReply(playerId), 2000 + Math.random() * 4000);
        }
    },

    getUnreadCount(playerId) {
        const msgs = this.getChatWith(playerId);
        return msgs.filter(m => !m.fromMe && !m.read).length;
    },

    getTotalUnread() {
        const chats = this.getChats();
        let count = 0;
        for (const pid in chats) {
            count += chats[pid].filter(m => !m.fromMe && !m.read).length;
        }
        return count;
    },

    markAsRead(playerId) {
        const chats = this.getChats();
        if (chats[playerId]) {
            chats[playerId].forEach(m => { m.read = true; });
            localStorage.setItem(this._key('chats'), JSON.stringify(chats));
        }
    },

    _simulateReply(playerId) {
        const player = this.getPlayerById(playerId);
        const pName = player ? player.name : 'Joueur';

        // Dispatch typing event first
        window.dispatchEvent(new CustomEvent('ttm-typing', { detail: { playerId, name: pName } }));

        const replies = [
            "Hey ! Ça me dit grave, on se fait une game ?",
            "Yo ! Je suis dispo ce soir si tu veux",
            "Salut, merci pour l'invite ! Je t'ajoute sur Discord",
            "Ça marche, je suis chaud ! Tu joues à quelle heure ?",
            "Nice ! On queue ensemble ? Envoie ton Discord",
            "Yoo merci ! Ajoute-moi : " + pName + "#1337",
            "Je suis partant, on se retrouve sur le serv ?",
            "Cool ! Je finis ma game et j'arrive",
            "GG ! Oui carrément, let's go",
            "Ah trop bien, je cherchais justement un mate !"
        ];

        const reply = replies[Math.floor(Math.random() * replies.length)];
        const chats = this.getChats();
        if (!chats[playerId]) chats[playerId] = [];
        chats[playerId].push({
            id: Date.now(),
            text: reply,
            fromMe: false,
            timestamp: new Date().toISOString(),
            read: false
        });
        localStorage.setItem(this._key('chats'), JSON.stringify(chats));

        window.dispatchEvent(new CustomEvent('ttm-new-message', { detail: { playerId: playerId, text: reply } }));
    },

    // ==========================================================
    //  INVITES
    // ==========================================================
    getInvites() {
        const data = localStorage.getItem(this._key('invites'));
        return data ? JSON.parse(data) : [];
    },

    sendInvite(playerId, message, game) {
        const invites = this.getInvites();
        invites.push({
            id: Date.now(),
            playerId: playerId,
            message: message,
            game: game,
            timestamp: new Date().toISOString(),
            status: 'sent'
        });
        localStorage.setItem(this._key('invites'), JSON.stringify(invites));

        const fullMsg = '[Invitation a jouer — ' + game + '] ' + message;
        this.sendMessage(playerId, fullMsg, true);
    },

    // ==========================================================
    //  REAL PLAYERS (from registered users)
    // ==========================================================

    // Rank → display color/icon mapping
    _rankStyle(rank) {
        if (!rank) return { color: '#6a6a80', icon: 'fas fa-medal' };
        const r = rank.toLowerCase();
        if (r.includes('radiant') || r.includes('challenger') || r.includes('predator') || r.includes('top 500') || r.includes('ssl') || r.includes('global'))
            return { color: '#ffeaa7', icon: 'fas fa-crown' };
        if (r.includes('immortal') || r.includes('grandmaster') || r.includes('grand champion') || r.includes('master') || r.includes('supreme'))
            return { color: '#e056a0', icon: 'fas fa-crown' };
        if (r.includes('ascendant') || r.includes('diamond') || r.includes('champion') || r.includes('lem'))
            return { color: '#a29bfe', icon: 'fas fa-gem' };
        if (r.includes('emerald') || r.includes('platinum'))
            return { color: '#00cec9', icon: 'fas fa-medal' };
        if (r.includes('gold') || r.includes('dmg') || r.includes('contender'))
            return { color: '#ffd700', icon: 'fas fa-medal' };
        if (r.includes('silver'))
            return { color: '#c0c0c0', icon: 'fas fa-medal' };
        return { color: '#cd7f32', icon: 'fas fa-medal' };
    },

    // Convert a stored profile into a "player" object for display
    _profileToPlayer(userId, profile) {
        const games = (profile.games || []).map(g => {
            const info = this.getGameById(g.gameId);
            const rs = this._rankStyle(g.rank);
            return {
                id: g.gameId,
                name: g.gameName || (info ? info.name : g.gameId),
                rank: g.rank || 'Non classé',
                role: g.role || 'Flex',
                agents: g.mains || '',
                hours: g.hours || '—',
                rankColor: rs.color,
                rankIcon: rs.icon
            };
        });
        return {
            id: userId,
            name: profile.username || 'Anonyme',
            tagline: profile.tagline || '',
            description: profile.description || '',
            avatar: profile.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(profile.username || userId)}&backgroundColor=b6e3f4`,
            discord: profile.discord || '',
            country: profile.country || '',
            languages: profile.languages || [],
            platform: profile.platform || '',
            playstyle: profile.playstyle || 'casual',
            mic: profile.mic || false,
            status: 'online',
            games: games,
            tags: profile.tags || { jeu: [], niveau: [], style: [], contraintes: [], dispo: [] },
            stats: profile.stats || { level: 1, teammates: 0, events: 0, coopGames: 0, currentGames: 0, referrals: 0 },
            lookingFor: profile.lookingFor || [],
            availability: profile.availability || {}
        };
    },

    // Load all registered users as player objects (excluding current user)
    getAllPlayers() {
        const users = this.Auth._getUsers();
        const currentId = this.Auth.getCurrentUserId();
        const players = [];
        users.forEach(u => {
            if (u.id === currentId) return; // skip self
            const raw = localStorage.getItem(`ttm_profile_${u.id}`);
            if (!raw) return;
            const profile = JSON.parse(raw);
            if (!profile.username) return; // skip incomplete profiles
            players.push(this._profileToPlayer(u.id, profile));
        });
        return players;
    },

    getPlayerById(id) {
        // Try registered users
        const users = this.Auth._getUsers();
        const user = users.find(u => u.id === id);
        if (user) {
            const raw = localStorage.getItem(`ttm_profile_${id}`);
            if (raw) return this._profileToPlayer(id, JSON.parse(raw));
        }
        return null;
    },

    searchPlayers(query) {
        const q = query.toLowerCase();
        return this.getAllPlayers().filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.tagline.toLowerCase().includes(q) ||
            p.games.some(g => g.name.toLowerCase().includes(q))
        );
    },

    filterPlayers(opts) {
        opts = opts || {};
        let results = this.getAllPlayers();
        if (opts.game) results = results.filter(p => p.games.some(g => g.id === opts.game));
        if (opts.style) results = results.filter(p => p.playstyle === opts.style);
        if (opts.lang) results = results.filter(p => p.languages.includes(opts.lang));
        return results;
    },

    // Community stats for homepage hero
    getCommunityStats() {
        const users = this.Auth._getUsers();
        let totalLF = 0;
        users.forEach(u => {
            const raw = localStorage.getItem(`ttm_profile_${u.id}`);
            if (raw) {
                const p = JSON.parse(raw);
                totalLF += (p.lookingFor || []).length;
            }
        });
        return {
            players: users.length,
            games: this.gamesList.length,
            teams: totalLF
        };
    },

    // ==========================================================
    //  TAG CATEGORIES (Étape 2)
    // ==========================================================
    tagCategories: [
        {
            id: 'jeu',
            label: 'Jeu',
            icon: 'fas fa-gamepad',
            color: '#ff4655',
            tags: ['Valorant', 'R6Siege', 'Minecraft', 'Fortnite', 'LoL']
        },
        {
            id: 'niveau',
            label: 'Niveau',
            icon: 'fas fa-trophy',
            color: '#ffd700',
            tags: ['Fer', 'Or', 'Diamant', 'Immortel', 'Noob', 'Chill']
        },
        {
            id: 'style',
            label: 'Style de jeu',
            icon: 'fas fa-fire',
            color: '#6c5ce7',
            tags: ['Tryhard', 'Détendu', 'Ranked', 'Fun', 'PasDeTilt']
        },
        {
            id: 'contraintes',
            label: 'Contraintes sociales',
            icon: 'fas fa-users',
            color: '#00d68f',
            tags: ['MicroObligatoire', 'SansMicro', 'FR', '18ans+', 'Lycéen']
        },
        {
            id: 'dispo',
            label: 'Disponibilité',
            icon: 'fas fa-clock',
            color: '#00b4d8',
            tags: ['DispoMaintenant', 'WeekendOnly', 'Soirée']
        }
    ],

    // Helper: flatten all tags from profile into a single array
    flattenTags(tagsObj) {
        if (!tagsObj) return [];
        if (Array.isArray(tagsObj)) return tagsObj; // legacy
        const flat = [];
        for (const cat of Object.keys(tagsObj)) {
            if (Array.isArray(tagsObj[cat])) flat.push(...tagsObj[cat]);
        }
        return flat;
    },

    // ==========================================================
    //  GAMES LIST
    // ==========================================================
    gamesList: [
        { id: 'valorant', name: 'Valorant', icon: 'fas fa-crosshairs', logo: 'images/valorantlogo.png', color: '#ff4655', ranks: ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal', 'Radiant'], roles: ['Duelliste', 'Sentinelle', 'Controller', 'Initiateur', 'Flex'] },
        { id: 'overwatch', name: 'Overwatch 2', icon: 'fas fa-shield-alt', logo: 'images/overwatchlogo.png', color: '#f99e1a', ranks: ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Top 500'], roles: ['Tank', 'DPS', 'Support', 'Flex'] },
        { id: 'lol', name: 'League of Legends', icon: 'fas fa-hat-wizard', logo: 'images/lollogo.png', color: '#c8aa6e', ranks: ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond', 'Master', 'Grandmaster', 'Challenger'], roles: ['Top', 'Jungle', 'Mid', 'ADC', 'Support', 'Fill'] },
        { id: 'apex', name: 'Apex Legends', icon: 'fas fa-bolt', color: '#da292a', ranks: ['Rookie', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Predator'], roles: ['Assault', 'Recon', 'Support', 'Controller', 'Flex'] },
        { id: 'cs2', name: 'CS2', icon: 'fas fa-crosshairs', logo: 'images/cs2logo.png', color: '#de9b35', ranks: ['Silver', 'Gold Nova', 'Master Guardian', 'DMG', 'LEM', 'Supreme', 'Global Elite'], roles: ['Entry', 'AWPer', 'IGL', 'Lurker', 'Support', 'Flex'] },
        { id: 'fortnite', name: 'Fortnite', icon: 'fas fa-hammer', color: '#0078f2', ranks: ['Open', 'Contender', 'Champion', 'Unreal'], roles: ['Builder', 'Fragger', 'IGL', 'Support', 'Flex'] },
        { id: 'rocket', name: 'Rocket League', icon: 'fas fa-car', logo: 'images/rllogo.png', color: '#0078f2', ranks: ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Champion', 'Grand Champion', 'SSL'], roles: ['Striker', 'Defender', 'Midfielder', 'Flex'] }
    ],

    getGameById(id) {
        return this.gamesList.find(g => g.id === id) || null;
    },

    // ==========================================================
    //  UTILITY
    // ==========================================================
    timeAgo(dateStr) {
        var now = new Date();
        var date = new Date(dateStr);
        var seconds = Math.floor((now - date) / 1000);
        if (seconds < 60) return 'A l\'instant';
        var minutes = Math.floor(seconds / 60);
        if (minutes < 60) return 'Il y a ' + minutes + 'min';
        var hours = Math.floor(minutes / 60);
        if (hours < 24) return 'Il y a ' + hours + 'h';
        var days = Math.floor(hours / 24);
        if (days < 7) return 'Il y a ' + days + 'j';
        return date.toLocaleDateString('fr-FR');
    }
};
