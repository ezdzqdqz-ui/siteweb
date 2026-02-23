/* ============================================================
   TTM — Main Server
   Express + Passport Discord + MongoDB + Socket.io
   ============================================================ */
require('dotenv').config();

const express    = require('express');
const session    = require('express-session');
const { MongoStore } = require('connect-mongo');
const mongoose   = require('mongoose');
const passport   = require('passport');
const { Strategy } = require('passport-discord-auth');
const helmet     = require('helmet');
const cors       = require('cors');
const http       = require('http');
const path       = require('path');

const User       = require('./models/User');
const authRoutes = require('./routes/auth');
const apiRoutes  = require('./routes/api');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;

/* ---- Protection globale contre les crashs async ---- */
process.on('unhandledRejection', (err) => {
    // Ne pas crash le serveur pour les erreurs MongoDB
    if (err?.name === 'MongoServerSelectionError' || err?.name === 'MongoNetworkError') {
        return; // déjà logué, on ignore silencieusement
    }
    console.error('⚠️  Unhandled Rejection:', err);
});

/* ============================================================
   1. MongoDB (graceful — fonctionne aussi sans)
   ============================================================ */
let mongoConnected = false;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ttm';

async function connectMongo() {
    try {
        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 3000,
        });
        mongoConnected = true;
        console.log('✅ MongoDB connecté');
    } catch (err) {
        mongoConnected = false;
        console.log('⚠️  MongoDB non disponible:', err.message);
        console.log('   → Le site fonctionne en mode local (localStorage)');
        // Déconnecter proprement pour éviter des retries en arrière-plan
        try { await mongoose.disconnect(); } catch (_) {}
    }
}

// Supprimer les erreurs de reconnexion mongoose
mongoose.connection.on('error', () => {});

/* ============================================================
   2. Middleware
   ============================================================ */
app.use(helmet({
    contentSecurityPolicy: false,  // Désactivé pour le dev (fonts Google, CDN)
    crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ============================================================
   3. Sessions (configuré après tentative MongoDB)
   ============================================================ */
let sessionMiddleware;

async function setupSession() {
    const sessionConfig = {
        secret: process.env.SESSION_SECRET || 'ttm-dev-secret',
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 7 * 24 * 60 * 60 * 1000,
            httpOnly: true,
            secure: false,  // true en prod avec HTTPS
            sameSite: 'lax',
        },
    };

    // MongoDB session store uniquement si la connexion a réussi
    if (mongoConnected) {
        try {
            sessionConfig.store = MongoStore.create({
                mongoUrl: MONGO_URI,
                ttl: 7 * 24 * 60 * 60,
            });
            console.log('✅ Session store: MongoDB');
        } catch (e) {
            console.log('⚠️  Session store: mémoire (MongoStore a échoué)');
        }
    } else {
        console.log('ℹ️  Session store: mémoire (MongoDB non connecté)');
    }

    sessionMiddleware = session(sessionConfig);
    app.use(sessionMiddleware);

    /* ============================================================
       4. Passport — Discord OAuth2
       ============================================================ */
    app.use(passport.initialize());
    app.use(passport.session());

    passport.serializeUser((user, done) => {
        done(null, user._id);
    });

    passport.deserializeUser(async (id, done) => {
        try {
            const user = await User.findById(id);
            done(null, user);
        } catch (err) {
            done(err, null);
        }
    });

    // Configure Discord strategy only if credentials are present
    if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
        passport.use(new Strategy({
            clientId:     process.env.DISCORD_CLIENT_ID,
            clientSecret: process.env.DISCORD_CLIENT_SECRET,
            callbackUrl:  process.env.DISCORD_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback',
            scope:        ['identify', 'guilds'],
        }, async (accessToken, refreshToken, profile, done) => {
            try {
                const user = await User.findOrCreateFromDiscord(profile);
                done(null, user);
            } catch (err) {
                done(err, null);
            }
        }));
        console.log('✅ Discord OAuth2 configuré');
    } else {
        console.log('⚠️  Discord OAuth2 non configuré (DISCORD_CLIENT_ID manquant dans .env)');
        console.log('   → Le mode connexion locale reste actif');
    }

    /* ============================================================
       5. Routes API
       ============================================================ */
    app.use('/auth', authRoutes);
    app.use('/api',  apiRoutes);

    // ---- API: status check ----
    app.get('/api/status', (req, res) => {
        res.json({
            ok: true,
            auth: req.isAuthenticated ? req.isAuthenticated() : false,
            discord: !!(process.env.DISCORD_CLIENT_ID),
            mongodb: mongoConnected && mongoose.connection.readyState === 1,
        });
    });

    /* ============================================================
       6. Fichiers statiques (le frontend existant)
       ============================================================ */
    app.use(express.static(path.join(__dirname, '..'), {
        extensions: ['html'],
    }));

    // Fallback → index.html
    app.get('/{*splat}', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'index.html'));
    });
}

/* ============================================================
   7. Socket.io + Matchmaking
   ============================================================ */
const { Server } = require('socket.io');
const io = new Server(server, {
    cors: { origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true },
});

// Rendre io accessible aux routes si besoin
app.set('io', io);

/* ---- Matchmaking Queue & Rooms ---- */
const mmQueue = [];        // { socketId, tags[], username, avatar, discord, tagline, joinedAt }
const mmRooms = new Map(); // roomId → { players: [socketId, socketId] }
const BROADEN_DELAY = 30000; // 30s before broadening
let mmTickInterval = null;

function startMMTicker() {
    if (mmTickInterval) return;
    mmTickInterval = setInterval(() => matchmakingTick(), 2000);
}

function stopMMTicker() {
    if (mmTickInterval && mmQueue.length === 0) {
        clearInterval(mmTickInterval);
        mmTickInterval = null;
    }
}

function matchmakingTick() {
    if (mmQueue.length < 2) return;
    const now = Date.now();

    // Pass 1: exact match
    for (let i = 0; i < mmQueue.length; i++) {
        for (let j = i + 1; j < mmQueue.length; j++) {
            const a = mmQueue[i];
            const b = mmQueue[j];
            if (tagsMatch(a.tags, b.tags)) {
                createMatch(i, j, a.tags);
                return; // one match per tick
            }
        }
    }

    // Pass 2: broadened match (players waiting > 30s)
    for (let i = 0; i < mmQueue.length; i++) {
        if (now - mmQueue[i].joinedAt < BROADEN_DELAY) continue;
        // Notify about broadening
        const sockA = io.sockets.sockets.get(mmQueue[i].socketId);
        if (sockA) sockA.emit('mm:broadened');

        const relaxedA = relaxTags(mmQueue[i].tags);
        for (let j = 0; j < mmQueue.length; j++) {
            if (i === j) continue;
            const relaxedB = relaxTags(mmQueue[j].tags);
            // Check if relaxed tags share at least one common tag
            const common = relaxedA.filter(t => relaxedB.includes(t));
            if (common.length > 0) {
                createMatch(i, j, common);
                return;
            }
        }
    }
}

function tagsMatch(tagsA, tagsB) {
    if (tagsA.length !== tagsB.length) return false;
    const sorted = (arr) => [...arr].sort();
    const sA = sorted(tagsA);
    const sB = sorted(tagsB);
    return sA.every((t, i) => t === sB[i]);
}

function relaxTags(tags) {
    // Keep only "jeu" and "niveau" category tags, drop style/contraintes/dispo
    // We need the categories list here
    const jeuTags = ['Valorant', 'R6Siege', 'Minecraft', 'Fortnite', 'LoL'];
    const niveauTags = ['Fer', 'Or', 'Diamant', 'Immortel', 'Noob', 'Chill'];
    return tags.filter(t => jeuTags.includes(t) || niveauTags.includes(t));
}

function createMatch(idxA, idxB, matchedTags) {
    const a = mmQueue[idxA];
    const b = mmQueue[idxB];

    // Remove from queue (higher index first)
    if (idxA > idxB) {
        mmQueue.splice(idxA, 1);
        mmQueue.splice(idxB, 1);
    } else {
        mmQueue.splice(idxB, 1);
        mmQueue.splice(idxA, 1);
    }

    const roomId = 'mm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    mmRooms.set(roomId, { players: [a.socketId, b.socketId] });

    // Join both sockets to the room
    const sockA = io.sockets.sockets.get(a.socketId);
    const sockB = io.sockets.sockets.get(b.socketId);

    if (sockA) {
        sockA.join(roomId);
        sockA.mmRoom = roomId;
        sockA.emit('mm:matched', {
            roomId,
            partner: { username: b.username, avatar: b.avatar, discord: b.discord, tagline: b.tagline },
            matchedTags,
        });
    }
    if (sockB) {
        sockB.join(roomId);
        sockB.mmRoom = roomId;
        sockB.emit('mm:matched', {
            roomId,
            partner: { username: a.username, avatar: a.avatar, discord: a.discord, tagline: a.tagline },
            matchedTags,
        });
    }

    console.log(`⚡ Match: ${a.username} <-> ${b.username} (room: ${roomId})`);
    stopMMTicker();
}

/* ============================================================
   8. Démarrage
   ============================================================ */
async function start() {
    // 1) Tenter la connexion MongoDB
    await connectMongo();

    // 2) Configurer les sessions + passport + routes (dépend du résultat MongoDB)
    await setupSession();

    // 3) Partager la session avec Socket.io
    io.use((socket, next) => {
        sessionMiddleware(socket.request, {}, next);
    });

    io.on('connection', (socket) => {
        const sess = socket.request.session;
        const userId = sess?.passport?.user;

        if (userId) {
            socket.userId = userId;
            socket.join(`user:${userId}`);
            User.findByIdAndUpdate(userId, { status: 'online', lastSeen: new Date() }).catch(() => {});
            console.log(`🟢 ${userId} connecté (socket)`);
        }

        /* ---- Matchmaking events ---- */
        socket.on('mm:join', (data) => {
            // Remove if already in queue
            const existIdx = mmQueue.findIndex(q => q.socketId === socket.id);
            if (existIdx !== -1) mmQueue.splice(existIdx, 1);

            mmQueue.push({
                socketId: socket.id,
                tags: data.tags || [],
                username: data.username || 'Anonyme',
                avatar: data.avatar || '',
                discord: data.discord || '',
                tagline: data.tagline || '',
                joinedAt: Date.now(),
            });

            socket.emit('mm:waiting', { queueSize: mmQueue.length });
            console.log(`🔍 ${data.username} rejoint la file MM (${mmQueue.length} en queue)`);
            startMMTicker();
        });

        socket.on('mm:cancel', () => {
            const idx = mmQueue.findIndex(q => q.socketId === socket.id);
            if (idx !== -1) {
                console.log(`❌ ${mmQueue[idx].username} quitte la file MM`);
                mmQueue.splice(idx, 1);
            }
            socket.emit('mm:cancelled');
            stopMMTicker();
        });

        socket.on('mm:chat-message', (data) => {
            if (!data.roomId) return;
            const room = mmRooms.get(data.roomId);
            if (!room) return;
            // Broadcast to the other player in the room
            const entry = mmQueue.find(q => q.socketId === socket.id);
            const username = entry?.username || (userId ? 'Joueur' : 'Anonyme');
            socket.to(data.roomId).emit('mm:chat-message', {
                username: data.username || username,
                text: data.text,
            });
        });

        socket.on('mm:leave-room', (data) => {
            if (!data.roomId) return;
            socket.leave(data.roomId);
            // Notify partner
            socket.to(data.roomId).emit('mm:partner-left');
            mmRooms.delete(data.roomId);
        });

        /* ---- Disconnect ---- */
        socket.on('disconnect', () => {
            // Remove from MM queue
            const qIdx = mmQueue.findIndex(q => q.socketId === socket.id);
            if (qIdx !== -1) {
                console.log(`❌ ${mmQueue[qIdx].username} déconnecté (retiré de la file MM)`);
                mmQueue.splice(qIdx, 1);
                stopMMTicker();
            }

            // Notify MM room partner
            if (socket.mmRoom) {
                socket.to(socket.mmRoom).emit('mm:partner-left');
                mmRooms.delete(socket.mmRoom);
            }

            if (socket.userId) {
                User.findByIdAndUpdate(socket.userId, { status: 'offline', lastSeen: new Date() }).catch(() => {});
                console.log(`🔴 ${socket.userId} déconnecté`);
            }
        });
    });

    // 4) Lancer le serveur HTTP
    server.listen(PORT, () => {
        console.log(`\n🚀 TTM Server démarré sur http://localhost:${PORT}\n`);
    });
}

start().catch(err => {
    console.error('❌ Erreur fatale au démarrage:', err);
    process.exit(1);
});

/* ---- Arrêt propre ---- */
process.on('SIGINT', async () => {
    console.log('\n🛑 Arrêt du serveur...');
    try { await mongoose.disconnect(); } catch (_) {}
    server.close(() => process.exit(0));
});
