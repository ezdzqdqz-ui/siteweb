/* ===== app.js — Shared Utilities for TTM ===== */

/* ---- Navbar ---- */
function renderNavbar(activePage) {
    const profile = TTM.getProfile();
    const authName = TTM.Auth.getCurrentUsername() || 'Guest';
    const name = profile.username || authName;
    const avatar = profile.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}&backgroundColor=6c5ce7`;
    const chats = TTM.getChats();
    let totalUnread = 0;
    Object.values(chats).forEach(msgs => {
        totalUnread += msgs.filter(m => !m.read && !m.fromMe).length;
    });
    const badge = totalUnread > 0 ? `<span class="nav-badge">${totalUnread > 99 ? '99+' : totalUnread}</span>` : '';

    const links = [
        { id: 'home', href: 'index.html', icon: 'fas fa-compass', label: 'Découvrir' },
        { id: 'lfg', href: 'lfg.html', icon: 'fas fa-users', label: 'LFG' },
        { id: 'profile', href: 'profile.html', icon: 'fas fa-user', label: 'Profil' },
        { id: 'chat', href: 'chat.html', icon: 'fas fa-comment-dots', label: 'Chat', badge },
        { id: 'settings', href: 'settings.html', icon: 'fas fa-cog', label: 'Réglages' },
    ];

    const nav = document.getElementById('navbar');
    if (!nav) return;
    nav.innerHTML = `
        <div class="nav-inner">
            <a href="index.html" class="nav-logo">
                <img src="images/logosite.png" alt="TTM" class="logo-img">
            </a>
            <div class="nav-links">
                ${links.map(l => `<a href="${l.href}" class="nav-link${activePage === l.id ? ' active' : ''}"><i class="${l.icon}"></i><span>${l.label}</span>${l.badge || ''}</a>`).join('')}
            </div>
            <div class="nav-right">
                <button class="nav-search-btn" id="navSearchBtn" title="Rechercher (Ctrl+K)"><i class="fas fa-search"></i></button>
                <a href="${TTM.isProfileSetup() ? 'profile.html' : 'settings.html'}" class="nav-avatar-link" title="${name}">
                    <img src="${avatar}" alt="${name}" class="nav-avatar">
                </a>
                <button class="nav-logout-btn" id="navLogout" title="Déconnexion"><i class="fas fa-sign-out-alt"></i></button>
                <button class="nav-mobile-toggle" id="navMobileToggle"><i class="fas fa-bars"></i></button>
            </div>
        </div>
        <div class="nav-mobile" id="navMobile">
            ${links.map(l => `<a href="${l.href}" class="nav-mobile-link${activePage === l.id ? ' active' : ''}"><i class="${l.icon}"></i><span>${l.label}</span>${l.badge || ''}</a>`).join('')}
            <a href="#" class="nav-mobile-link" id="navMobileLogout"><i class="fas fa-sign-out-alt"></i><span>Déconnexion</span></a>
        </div>
    `;

    // Mobile toggle
    const toggle = document.getElementById('navMobileToggle');
    const mobileMenu = document.getElementById('navMobile');
    toggle?.addEventListener('click', () => mobileMenu.classList.toggle('open'));

    // Logout — use TTM_Auth if available for Discord support
    const logoutFn = () => {
        if (window.TTM_Auth && TTM_Auth.getMode() === 'server') {
            TTM_Auth.logout();
        } else {
            TTM.Auth.logout();
        }
    };
    document.getElementById('navLogout')?.addEventListener('click', logoutFn);
    document.getElementById('navMobileLogout')?.addEventListener('click', (e) => { e.preventDefault(); logoutFn(); });

    // Search
    initSearch();
}

/* ---- Search Overlay ---- */
function initSearch() {
    // Create overlay if not exists
    if (document.getElementById('searchOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'searchOverlay';
    overlay.className = 'search-overlay';
    overlay.innerHTML = `
        <div class="search-modal">
            <div class="search-input-wrap">
                <i class="fas fa-search"></i>
                <input type="text" id="searchInput" placeholder="Rechercher un joueur..." autocomplete="off">
                <kbd>ESC</kbd>
            </div>
            <div class="search-results" id="searchResults"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    const input = document.getElementById('searchInput');
    const results = document.getElementById('searchResults');

    overlay.addEventListener('click', e => { if (e.target === overlay) closeSearch(); });
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
        if (e.key === 'Escape') closeSearch();
    });
    document.getElementById('navSearchBtn')?.addEventListener('click', openSearch);

    input.addEventListener('input', () => {
        const q = input.value.trim();
        if (!q) { results.innerHTML = '<div class="search-hint">Tape le nom d\'un joueur...</div>'; return; }
        const found = TTM.searchPlayers(q);
        if (!found.length) { results.innerHTML = '<div class="search-hint">Aucun joueur trouvé</div>'; return; }
        results.innerHTML = found.slice(0, 8).map(p => `
            <a href="player.html?id=${p.id}" class="search-result">
                <img src="${p.avatar}" class="search-result-avatar">
                <div class="search-result-info"><span class="search-result-name">${p.name}</span><span class="search-result-tag">${p.tagline}</span></div>
                <span class="search-result-status ${p.status}"></span>
            </a>
        `).join('');
    });

    function openSearch() { overlay.classList.add('open'); input.value = ''; results.innerHTML = '<div class="search-hint">Tape le nom d\'un joueur...</div>'; setTimeout(()=>input.focus(), 100); }
    function closeSearch() { overlay.classList.remove('open'); }
}

/* ---- Toast Notifications ---- */
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer') || (() => { const c = document.createElement('div'); c.id = 'toastContainer'; c.className = 'toast-container'; document.body.appendChild(c); return c; })();
    const icons = { success: 'fas fa-check-circle', warning: 'fas fa-exclamation-circle', error: 'fas fa-times-circle', info: 'fas fa-info-circle' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="${icons[type] || icons.info}"></i><span>${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
}

/* ---- Animated Counter ---- */
function animateCounter(el, target) {
    const dur = 1500;
    const start = performance.now();
    const step = (now) => {
        const progress = Math.min((now - start) / dur, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.floor(target * ease).toLocaleString('fr-FR');
        if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

/* ---- Update Chat Badge in Navbar ---- */
function updateMsgBadge() {
    const chats = TTM.getChats();
    let total = 0;
    Object.values(chats).forEach(msgs => {
        total += msgs.filter(m => !m.read && !m.fromMe).length;
    });
    document.querySelectorAll('.nav-badge').forEach(b => {
        if (total > 0) { b.textContent = total > 99 ? '99+' : total; b.style.display = ''; }
        else b.style.display = 'none';
    });
}

/* ---- Game Icon Helper ---- */
function getGameIconHTML(gameInfo, fallbackIcon) {
    if (gameInfo && gameInfo.logo) {
        return `<img src="${gameInfo.logo}" alt="${gameInfo.name}">`;
    }
    const icon = (gameInfo && gameInfo.icon) || fallbackIcon || 'fas fa-gamepad';
    return `<i class="${icon}"></i>`;
}

/* ---- Level Badge ---- */
function getLevelBadge(level) {
    let tier, icon;
    if (level >= 50) { tier = 'legend'; icon = 'fas fa-fire'; }
    else if (level >= 35) { tier = 'master'; icon = 'fas fa-crown'; }
    else if (level >= 25) { tier = 'diamond'; icon = 'fas fa-gem'; }
    else if (level >= 15) { tier = 'plat'; icon = 'fas fa-medal'; }
    else if (level >= 10) { tier = 'gold'; icon = 'fas fa-star'; }
    else if (level >= 5) { tier = 'silver'; icon = 'fas fa-shield-alt'; }
    else { tier = 'bronze'; icon = 'fas fa-seedling'; }
    return `<span class="level-badge tier-${tier}"><i class="${icon}"></i> Niv. ${level}</span>`;
}

/* ---- Scroll Reveal ---- */
function initReveal() {
    const obs = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
}

/* ---- Listen for new messages globally ---- */
window.addEventListener('ttm-new-message', () => updateMsgBadge());

/* ---- Update Nav Avatar ---- */
function updateNavAvatar() {
    const profile = TTM.getProfile();
    const avatar = profile.avatar || (profile.username ? `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(profile.username)}&backgroundColor=6c5ce7` : '');
    const navAv = document.querySelector('.nav-avatar');
    if (navAv && avatar) navAv.src = avatar;
}
