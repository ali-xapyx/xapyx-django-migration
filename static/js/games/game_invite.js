/**
 * XAPYX Arcade — Shared Game Friend Invite & Share Engine
 * Handles in-app friend discovery, direct game invites, and social sharing.
 */

(function() {
    'use strict';

    function getCsrfToken() {
        const input = document.querySelector('input[name="csrfmiddlewaretoken"]');
        if (input && input.value) return input.value;
        const name = 'csrftoken';
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const c = cookies[i].trim();
                if (c.substring(0, name.length + 1) === (name + '=')) {
                    return decodeURIComponent(c.substring(name.length + 1));
                }
            }
        }
        return '';
    }

    function showGameToast(msg, title = 'Arcade', icon = '🎮') {
        if (typeof window.showToast === 'function') {
            window.showToast(msg, title, icon);
            return;
        }
        let toast = document.querySelector('.game-floating-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'game-floating-toast';
            document.body.appendChild(toast);
        }
        toast.innerHTML = `<span class="me-2 fs-5">${icon}</span><span>${msg}</span>`;
        toast.classList.add('show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => {
            toast.classList.remove('show');
        }, 3200);
    }

    function copyGameLinkToClipboard(text, successMessage = 'Game invite link copied to clipboard!') {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => {
                showGameToast(successMessage, 'Copied', '📋');
            }).catch(() => fallbackCopy(text, successMessage));
        } else {
            fallbackCopy(text, successMessage);
        }
    }

    function fallbackCopy(text, successMessage) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            showGameToast(successMessage, 'Copied', '📋');
        } catch (e) {
            prompt('Copy this link manually:', text);
        }
        document.body.removeChild(textArea);
    }

    function openGameFriendsInviteModal(gameType, gameTitle, roomCode) {
        const modalEl = document.getElementById('gameInviteFriendsModal');
        if (!modalEl) {
            console.warn('[GameInvite] #gameInviteFriendsModal element not found');
            return;
        }

        const roomCodeEl = document.getElementById('modalActiveRoomCode');
        if (roomCodeEl) roomCodeEl.textContent = roomCode || '------';

        const listContainer = document.getElementById('gameFriendsListContainer');
        const searchInput = document.getElementById('gameFriendSearchInput');
        if (searchInput) searchInput.value = '';

        if (window.bootstrap && window.bootstrap.Modal) {
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
        }

        if (listContainer) {
            listContainer.innerHTML = `
                <div class="text-center py-4 text-muted">
                    <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
                    <span>Loading friends...</span>
                </div>
            `;
        }

        fetch('/api/games/friends/')
            .then(r => r.json())
            .then(data => {
                if (!data.success || !data.friends || data.friends.length === 0) {
                    if (listContainer) {
                        listContainer.innerHTML = `
                            <div class="text-center py-4 text-muted">
                                <i class="bi bi-people fs-2 d-block mb-2 opacity-50"></i>
                                <span>No friends found yet. Add friends on XAPYX to invite them directly!</span>
                            </div>
                        `;
                    }
                    return;
                }

                renderFriendsList(data.friends, gameType, roomCode);

                if (searchInput) {
                    searchInput.oninput = function() {
                        const q = this.value.toLowerCase().trim();
                        const filtered = data.friends.filter(f =>
                            (f.name && f.name.toLowerCase().includes(q)) ||
                            (f.username && f.username.toLowerCase().includes(q))
                        );
                        renderFriendsList(filtered, gameType, roomCode);
                    };
                }
            })
            .catch(() => {
                if (listContainer) {
                    listContainer.innerHTML = `
                        <div class="text-center py-4 text-danger small">
                            <i class="bi bi-exclamation-triangle fs-4 d-block mb-1"></i>
                            Failed to load friends list. Please try again.
                        </div>
                    `;
                }
            });
    }

    function renderFriendsList(friends, gameType, roomCode) {
        const listContainer = document.getElementById('gameFriendsListContainer');
        if (!listContainer) return;

        if (friends.length === 0) {
            listContainer.innerHTML = `<div class="text-center py-4 text-muted small">No matching friends found.</div>`;
            return;
        }

        listContainer.innerHTML = friends.map(f => {
            const isOnline = !!f.is_online;
            const statusDotStyle = isOnline
                ? 'background: #10b981; border: 2px solid #1e293b; box-shadow: 0 0 6px #10b981;'
                : 'background: #64748b; border: 2px solid #1e293b;';
            const statusText = isOnline ? '<span class="text-success ms-1 fw-bold">● Online</span>' : '';

            return `
                <div class="d-flex align-items-center justify-content-between p-2 rounded friend-invite-row" style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08);">
                    <div class="d-flex align-items-center gap-2 text-truncate" style="min-width: 0;">
                        <div class="position-relative flex-shrink-0">
                            <img src="${f.avatar || '/static/images/avatars/default.png'}" alt="${f.name}" class="rounded-circle" width="40" height="40" style="object-fit: cover;" onerror="this.src='/static/images/avatars/default.png';">
                            <span class="position-absolute bottom-0 end-0 rounded-circle" style="width: 10px; height: 10px; ${statusDotStyle}"></span>
                        </div>
                        <div class="text-truncate">
                            <div class="fw-semibold text-truncate small">${f.name}</div>
                            <div class="text-muted extra-small" style="font-size: 0.72rem;">@${f.username} ${statusText}</div>
                        </div>
                    </div>
                    <button type="button" class="btn btn-sm btn-outline-warning px-3 fw-semibold flex-shrink-0 btn-send-game-invite" data-id="${f.id}" onclick="window.sendGameInviteToFriend(${f.id}, '${gameType}', '${roomCode}', this)">
                        <i class="bi bi-send me-1"></i>Invite
                    </button>
                </div>
            `;
        }).join('');
    }

    function sendGameInviteToFriend(friendId, gameType, roomCode, btn) {
        if (!friendId || !roomCode) return;
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1" role="status"></span>Inviting...`;
        }

        fetch('/api/games/invite/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({
                friend_id: friendId,
                game_type: gameType,
                room_code: roomCode
            })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                if (btn) {
                    btn.className = 'btn btn-sm btn-success px-3 fw-semibold flex-shrink-0';
                    btn.innerHTML = `<i class="bi bi-check-lg me-1"></i>Invited`;
                }
                showGameToast('Game invite sent with one-tap join link!', 'Invite Sent', '🎮');
            } else {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = `<i class="bi bi-send me-1"></i>Invite`;
                }
                showGameToast(data.error || 'Failed to send invite.', 'Error', '⚠️');
            }
        })
        .catch(() => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i class="bi bi-send me-1"></i>Invite`;
            }
            showGameToast('Network error sending invite.', 'Error', '⚠️');
        });
    }

    // Expose globals
    window.openGameFriendsInviteModal = openGameFriendsInviteModal;
    window.sendGameInviteToFriend = sendGameInviteToFriend;
    window.showGameToast = showGameToast;
    window.copyGameLinkToClipboard = copyGameLinkToClipboard;

})();
