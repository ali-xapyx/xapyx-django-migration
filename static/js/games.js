/**
 * static/js/games.js - Games Hub & Leaderboard Client (Task 22 Phase 1)
 */
(function () {
    'use strict';

    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }
    const csrftoken = getCookie('csrftoken');

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function triggerToast(message, title, icon) {
        if (typeof window.showToast === 'function') {
            window.showToast(message, title || 'Games', icon || '🎮');
            return;
        }
        // Fallback toast alert
        const alertBox = document.createElement('div');
        alertBox.className = 'xpy-custom-toast';
        alertBox.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1e1e38;color:#fff;padding:12px 20px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);z-index:99999;font-weight:600;display:flex;align-items:center;gap:10px;animation:fadeIn 0.2s ease;';
        alertBox.innerHTML = `<span>${icon || '🎮'}</span> <span>${escapeHtml(message)}</span>`;
        document.body.appendChild(alertBox);
        setTimeout(() => {
            alertBox.style.opacity = '0';
            alertBox.style.transition = 'opacity 0.3s ease';
            setTimeout(() => alertBox.remove(), 300);
        }, 3200);
    }

    async function trackPlay(gameType, callback) {
        try {
            const res = await fetch('/api/games/track-play/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrftoken
                },
                body: JSON.stringify({ game_type: gameType })
            });
            const data = await res.json();
            if (data.success && typeof callback === 'function') {
                callback(data.plays_count);
            }
        } catch (err) {
            console.error('Error tracking game play:', err);
        }
    }

    async function loadLeaderboard(gameType) {
        const tbody = document.getElementById('leaderboardTbody');
        if (!tbody) return;

        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center py-4 text-muted">
                    <div class="spinner-border spinner-border-sm me-2" role="status"></div>
                    Loading ${escapeHtml(gameType)} leaderboard...
                </td>
            </tr>
        `;

        try {
            const res = await fetch(`/api/games/leaderboard/?game_type=${encodeURIComponent(gameType)}&limit=10`);
            const data = await res.json();

            if (!data.success || !data.leaderboard || data.leaderboard.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="4" class="text-center py-5 text-muted">
                            <i class="fas fa-trophy text-muted fa-2x mb-2 d-block"></i>
                            No recorded high scores yet for this game. Be the first to play!
                        </td>
                    </tr>
                `;
                return;
            }

            let html = '';
            data.leaderboard.forEach(item => {
                let rankBadge = `<span class="rank-badge rank-default">#${item.rank}</span>`;
                if (item.rank === 1) rankBadge = `<span class="rank-badge rank-1">🥇 1</span>`;
                else if (item.rank === 2) rankBadge = `<span class="rank-badge rank-2">🥈 2</span>`;
                else if (item.rank === 3) rankBadge = `<span class="rank-badge rank-3">🥉 3</span>`;

                const scoreDisplay = item.winner
                    ? `<span class="badge bg-success-subtle text-success border border-success-subtle px-2 py-1">Won (${escapeHtml(item.winner)})</span>`
                    : `<strong class="text-primary font-monospace">${item.score.toLocaleString()}</strong>`;

                html += `
                    <tr class="leaderboard-row">
                        <td>${rankBadge}</td>
                        <td>
                            <div class="d-flex align-items-center gap-2">
                                <a href="/user/${encodeURIComponent(item.username)}/" class="text-decoration-none">
                                    <img src="${escapeHtml(item.picture)}" data-full-src="${escapeHtml(item.picture)}" alt="${escapeHtml(item.name)}" class="avatar-mini-img rounded-circle" width="34" height="34" onerror="this.onerror=null;this.src='/static/images/avatars/default.png';">
                                </a>
                                <div>
                                    <a href="/user/${encodeURIComponent(item.username)}/" class="fw-semibold text-reset text-decoration-none d-block lh-sm">
                                        ${escapeHtml(item.name)}
                                    </a>
                                    <small class="text-muted">@${escapeHtml(item.username)}</small>
                                </div>
                            </div>
                        </td>
                        <td>${scoreDisplay}</td>
                        <td class="text-muted small">${escapeHtml(item.created_at)}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        } catch (err) {
            console.error('Failed to load leaderboard:', err);
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center py-4 text-danger">
                        Failed to load leaderboard. Please try again later.
                    </td>
                </tr>
            `;
        }
    }

    async function refreshHubData() {
        try {
            const res = await fetch('/api/games/hub/');
            const data = await res.json();
            if (data.success) {
                if (data.total_plays !== undefined) {
                    const totalEl = document.getElementById('totalPlatformPlays');
                    if (totalEl) totalEl.textContent = data.total_plays.toLocaleString();
                }
                if (data.games) {
                    data.games.forEach(g => {
                        const countEl = document.querySelector(`.plays-count-val[data-game-id="${g.id}"]`);
                        if (countEl) countEl.textContent = g.plays_count.toLocaleString();
                    });
                }
            }
        } catch (e) {
            // Non-critical background refresh
        }
    }

    function initGamesHub() {
        // Handle Play buttons
        document.querySelectorAll('.game-play-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const gameType = this.dataset.gameType;
                let routeKey = gameType;
                if (gameType === '1' || gameType.includes('tic')) routeKey = 'tictactoe';
                else if (gameType.includes('space') || gameType === '7') routeKey = 'spaceshooter';
                else if (gameType.includes('love') || gameType === '14') routeKey = 'lovemeter';
                else if (gameType.includes('catch') || gameType === '15') routeKey = 'catchme';
                const gameTitle = this.dataset.gameTitle || 'Game';

                const gameRoutes = {
                    'spaceshooter': '/games/spaceshooter/',
                    'lovemeter': '/games/lovemeter/',
                    'catchme': '/games/catchme/',
                    'tictactoe': '/games/tictactoe/'
                };

                // Track play asynchronously
                trackPlay(gameType, (newCount) => {
                    const countEl = document.querySelector(`.plays-count-val[data-game-id="${gameType}"]`);
                    if (countEl) countEl.textContent = newCount.toLocaleString();
                });

                if (gameRoutes[routeKey]) {
                    window.location.href = gameRoutes[routeKey];
                } else {
                    // Multiplayer coming in Phase 3
                    triggerToast(
                        `${gameTitle} multiplayer is launching in Phase 3!`,
                        'Coming Soon',
                        '🎮'
                    );
                }
            });
        });

        // Handle Leaderboard Tabs
        const tabBtns = document.querySelectorAll('.games-tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', function () {
                tabBtns.forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                const gameType = this.dataset.gameType;
                let routeKey = gameType;
                if (gameType === '1' || gameType.includes('tic')) routeKey = 'tictactoe';
                else if (gameType.includes('space') || gameType === '7') routeKey = 'spaceshooter';
                else if (gameType.includes('love') || gameType === '14') routeKey = 'lovemeter';
                else if (gameType.includes('catch') || gameType === '15') routeKey = 'catchme';
                loadLeaderboard(gameType);
            });
        });

        // Load initial leaderboard
        loadLeaderboard('spaceshooter');

        // Refresh live hub counts
        refreshHubData();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initGamesHub);
    } else {
        initGamesHub();
    }
})();