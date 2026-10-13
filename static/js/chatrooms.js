/**
 * chatrooms.js — Chat Rooms Directory & Management (Task 18 Phase 3)
 */
(function () {
    'use strict';

    // ---- DOM Elements ----
    const chatroomsGrid = document.getElementById('chatroomsGrid');
    const chatroomsTabs = document.getElementById('chatroomsTabs');
    const chatroomsSearchInput = document.getElementById('chatroomsSearchInput');
    const chatroomsPrivacyFilter = document.getElementById('chatroomsPrivacyFilter');
    const openCreateModalBtn = document.getElementById('openCreateModalBtn');

    // Modals
    const createRoomModalEl = document.getElementById('createRoomModal');
    const createRoomForm = document.getElementById('createRoomForm');
    const createRoomName = document.getElementById('createRoomName');
    const createRoomDesc = document.getElementById('createRoomDesc');
    const createRoomPrivacy = document.getElementById('createRoomPrivacy');
    const createRoomLimit = document.getElementById('createRoomLimit');
    const createRoomPicture = document.getElementById('createRoomPicture');
    const createPicPreviewWrap = document.getElementById('createPicPreviewWrap');
    const createPicPreview = document.getElementById('createPicPreview');
    const createNameFeedback = document.getElementById('createNameFeedback');
    const submitCreateRoomBtn = document.getElementById('submitCreateRoomBtn');

    const editRoomModalEl = document.getElementById('editRoomModal');
    const editRoomForm = document.getElementById('editRoomForm');
    const editRoomId = document.getElementById('editRoomId');
    const editRoomName = document.getElementById('editRoomName');
    const editRoomDesc = document.getElementById('editRoomDesc');
    const editRoomPrivacy = document.getElementById('editRoomPrivacy');
    const editRoomLimit = document.getElementById('editRoomLimit');
    const editRoomPicture = document.getElementById('editRoomPicture');
    const editPicPreviewWrap = document.getElementById('editPicPreviewWrap');
    const editPicPreview = document.getElementById('editPicPreview');
    const editInviteCodeWrap = document.getElementById('editInviteCodeWrap');
    const editInviteCode = document.getElementById('editInviteCode');
    const copyInviteCodeBtn = document.getElementById('copyInviteCodeBtn');
    const editNameFeedback = document.getElementById('editNameFeedback');
    const submitEditRoomBtn = document.getElementById('submitEditRoomBtn');

    const joinPrivateModalEl = document.getElementById('joinPrivateModal');
    const joinPrivateForm = document.getElementById('joinPrivateForm');
    const joinPrivateRoomId = document.getElementById('joinPrivateRoomId');
    const joinPrivateRoomNameText = document.getElementById('joinPrivateRoomNameText');
    const joinInviteCode = document.getElementById('joinInviteCode');
    const submitJoinPrivateBtn = document.getElementById('submitJoinPrivateBtn');

    // Bootstrap Modal instances
    let bsCreateModal = null;
    let bsEditModal = null;
    let bsJoinPrivateModal = null;

    // State
    let currentTab = 'all';
    let searchQuery = '';
    let privacyFilter = 'all';
    let searchDebounceTimer = null;
    let nameCheckDebounceTimer = null;
    let loadedRooms = [];

    // ---- Utilities ----
    function getCsrfToken() {
        const inp = document.querySelector('[name=csrfmiddlewaretoken]');
        if (inp && inp.value) return inp.value;
        const m = document.cookie.match(/csrftoken=([^;]+)/);
        return m ? m[1] : '';
    }

    function escapeHtml(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = String(str);
        return d.innerHTML;
    }

    function getAvatarThumb(av) {
        if (!av || typeof av !== 'string') return '/static/images/avatars/default.png';
        if (av.indexOf('/static/images/avatars/default.png') !== -1) return av;
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(av) && av.indexOf('_avatar.webp') === -1) {
            return av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
        }
        return av;
    }

    // Direct upload helper using S3 presigned URL
    async function uploadImageToS3(file) {
        if (!file) return '';
        const presignRes = await fetch('/api/chat/upload/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({
                filename: file.name,
                content_type: file.type || 'image/jpeg'
            })
        });
        const presignData = await presignRes.json();
        if (!presignData.success) {
            throw new Error(presignData.error || 'Failed to get upload URL');
        }
        const s3Put = await fetch(presignData.upload_url, {
            method: 'PUT',
            headers: { 'Content-Type': file.type || 'image/jpeg' },
            body: file
        });
        if (!s3Put.ok) {
            throw new Error('S3 upload failed: ' + s3Put.status);
        }
        return presignData.key;
    }

    // ---- Load & Render Rooms ----
    async function loadRooms() {
        if (!chatroomsGrid) return;
        chatroomsGrid.innerHTML = `
            <div class="chatrooms-loading-state py-5 text-center col-12">
                <i class="fas fa-spinner fa-spin fa-2x text-primary mb-2"></i>
                <p class="text-muted">Loading chat rooms...</p>
            </div>
        `;

        try {
            const params = new URLSearchParams({
                tab: currentTab,
                search: searchQuery,
                privacy: privacyFilter
            });

            const res = await fetch(`/api/chatrooms/list/?${params.toString()}`, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            const data = await res.json();

            if (!data.success) {
                chatroomsGrid.innerHTML = `<div class="p-4 text-center text-danger col-12">${escapeHtml(data.error || 'Failed to load rooms')}</div>`;
                return;
            }

            loadedRooms = data.rooms || [];
            renderRooms(loadedRooms);

        } catch (e) {
            console.error('loadRooms error:', e);
            chatroomsGrid.innerHTML = '<div class="p-4 text-center text-danger col-12">Error loading chat rooms.</div>';
        }
    }

    function renderRooms(rooms) {
        if (!chatroomsGrid) return;

        if (rooms.length === 0) {
            chatroomsGrid.innerHTML = `
                <div class="chatrooms-empty-state text-center py-5 col-12">
                    <div class="mb-3">
                        <i class="fas fa-comments fa-3x opacity-50 text-muted"></i>
                    </div>
                    <h5>No Chat Rooms Found</h5>
                    <p class="text-muted">No rooms match your selected criteria. Try adjusting filters or create a new room!</p>
                </div>
            `;
            return;
        }

        chatroomsGrid.innerHTML = rooms.map(r => {
            const isPrivate = r.privacy === 'private';
            const badgeCls = isPrivate ? 'badge-private' : 'badge-public';
            const badgeIcon = isPrivate ? '<i class="fas fa-lock me-1"></i> Private' : '<i class="fas fa-globe me-1"></i> Public';

            const cardImgHtml = r.picture ? `
                <img src="${escapeHtml(r.picture)}" alt="${escapeHtml(r.name)}" class="chatroom-card-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                <div class="chatroom-card-img-placeholder" style="display:none;">${escapeHtml(r.name.charAt(0).toUpperCase())}</div>
            ` : `
                <div class="chatroom-card-img-placeholder">${escapeHtml(r.name.charAt(0).toUpperCase())}</div>
            `;

            // Action Buttons
            let actionButtons = '';
            if (r.is_member) {
                actionButtons += `
                    <a href="/chatrooms/${r.id}/" class="btn btn-primary btn-sm chatroom-btn-action" title="Enter Room">
                        <i class="fas fa-sign-in-alt me-1"></i> Enter
                    </a>
                    <button type="button" class="btn btn-outline-danger btn-sm chatroom-btn-icon" onclick="window.__exitRoom(${r.id})" title="Leave Room">
                        <i class="fas fa-door-open"></i>
                    </button>
                `;
            } else {
                if (isPrivate) {
                    actionButtons += `
                        <button type="button" class="btn btn-outline-warning btn-sm chatroom-btn-action" onclick="window.__openJoinPrivateModal(${r.id}, '${escapeHtml(r.name)}')" title="Join Private Room">
                            <i class="fas fa-key me-1"></i> Join
                        </button>
                    `;
                } else {
                    actionButtons += `
                        <button type="button" class="btn btn-outline-primary btn-sm chatroom-btn-action" onclick="window.__joinPublicRoom(${r.id})" title="Join Room">
                            <i class="fas fa-plus me-1"></i> Join
                        </button>
                    `;
                }
            }

            // Management buttons
            let manageButtons = '';
            if (r.is_admin || r.is_creator) {
                manageButtons += `
                    <button type="button" class="btn btn-outline-secondary btn-sm chatroom-btn-icon" onclick="window.__openEditModal(${r.id})" title="Edit Room Settings">
                        <i class="fas fa-cog"></i>
                    </button>
                `;
            }
            if (r.is_creator) {
                manageButtons += `
                    <button type="button" class="btn btn-outline-danger btn-sm chatroom-btn-icon" onclick="window.__deleteRoom(${r.id})" title="Delete Room">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                `;
            }

            const creatorAvatar = getAvatarThumb(r.creator_picture);

            return `
                <div class="chatroom-card" data-room-id="${r.id}">
                    <div class="chatroom-card-header">
                        ${cardImgHtml}
                        <span class="chatroom-badge-privacy ${badgeCls}">${badgeIcon}</span>
                    </div>
                    <div class="chatroom-card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h4 class="chatroom-card-title mb-0" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</h4>
                        </div>
                        <p class="chatroom-card-desc">${escapeHtml(r.description || 'No description provided.')}</p>
                        
                        <div class="chatroom-card-meta">
                            <span class="chatroom-meta-item">
                                <i class="fas fa-users me-1 text-primary"></i> ${r.member_count} / ${r.member_limit} members
                            </span>
                            <span class="chatroom-meta-item creator-meta" title="Created by ${escapeHtml(r.creator_name)}">
                                <img src="${creatorAvatar}" onerror="this.onerror=null;this.src='/static/images/avatars/default.png'" class="creator-mini-pic" alt="">
                                <span class="creator-name">${escapeHtml(r.creator_name)}</span>
                            </span>
                        </div>
                    </div>
                    <div class="chatroom-card-footer">
                        <div class="chatroom-footer-actions">
                            ${actionButtons}
                        </div>
                        <div class="chatroom-footer-manage">
                            ${manageButtons}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ---- Actions ----
    window.__joinPublicRoom = async function (roomId) {
        try {
            const res = await fetch(`/api/chatrooms/${roomId}/join/`, {
                method: 'POST',
                headers: { 'X-CSRFToken': getCsrfToken() }
            });
            const data = await res.json();
            if (data.success) {
                window.location.href = `/chatrooms/${roomId}/`;
            } else {
                alert(data.error || 'Failed to join chat room');
            }
        } catch (e) {
            console.error('joinPublicRoom error:', e);
            alert('Error joining room');
        }
    };

    window.__openJoinPrivateModal = function (roomId, roomName) {
        if (!joinPrivateModalEl) return;
        joinPrivateRoomId.value = roomId;
        joinPrivateRoomNameText.textContent = `Enter the invite code to join "${roomName}":`;
        joinInviteCode.value = '';
        if (bsJoinPrivateModal) bsJoinPrivateModal.show();
    };

    if (joinPrivateForm) {
        joinPrivateForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const roomId = joinPrivateRoomId.value;
            const code = joinInviteCode.value.trim().toUpperCase();
            if (!roomId || !code) return;

            if (submitJoinPrivateBtn) submitJoinPrivateBtn.disabled = true;

            try {
                const formData = new FormData();
                formData.append('invite_code', code);

                const res = await fetch(`/api/chatrooms/${roomId}/join-private/`, {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCsrfToken() },
                    body: formData
                });
                const data = await res.json();
                if (data.success) {
                    if (bsJoinPrivateModal) bsJoinPrivateModal.hide();
                    window.location.href = `/chatrooms/${roomId}/`;
                } else {
                    alert(data.error || 'Invalid invite code');
                }
            } catch (err) {
                console.error('join-private error:', err);
                alert('Error joining private room');
            } finally {
                if (submitJoinPrivateBtn) submitJoinPrivateBtn.disabled = false;
            }
        });
    }

    window.__exitRoom = async function (roomId) {
        if (!confirm('Are you sure you want to leave this chat room?')) return;
        try {
            const res = await fetch(`/api/chatrooms/${roomId}/exit/`, {
                method: 'POST',
                headers: { 'X-CSRFToken': getCsrfToken() }
            });
            const data = await res.json();
            if (data.success) {
                loadRooms();
            } else {
                alert(data.error || 'Failed to leave room');
            }
        } catch (e) {
            console.error('exitRoom error:', e);
            alert('Error leaving room');
        }
    };

    window.__deleteRoom = async function (roomId) {
        if (!confirm('Are you sure you want to delete this chat room? This action cannot be undone.')) return;
        try {
            const res = await fetch(`/api/chatrooms/${roomId}/delete/`, {
                method: 'POST',
                headers: { 'X-CSRFToken': getCsrfToken() }
            });
            const data = await res.json();
            if (data.success) {
                loadRooms();
            } else {
                alert(data.error || 'Failed to delete room');
            }
        } catch (e) {
            console.error('deleteRoom error:', e);
            alert('Error deleting room');
        }
    };

    window.__openEditModal = function (roomId) {
        const room = loadedRooms.find(r => Number(r.id) === Number(roomId));
        if (!room || !editRoomModalEl) return;

        editRoomId.value = room.id;
        editRoomName.value = room.name;
        editRoomDesc.value = room.description || '';
        editRoomPrivacy.value = room.privacy;
        editRoomLimit.value = room.member_limit || 20;

        if (room.privacy === 'private' && room.invite_code) {
            editInviteCodeWrap.classList.remove('d-none');
            editInviteCode.value = room.invite_code;
        } else {
            editInviteCodeWrap.classList.add('d-none');
            editInviteCode.value = '';
        }

        if (room.picture) {
            editPicPreview.src = room.picture;
            editPicPreviewWrap.classList.remove('d-none');
        } else {
            editPicPreviewWrap.classList.add('d-none');
        }

        if (editNameFeedback) editNameFeedback.innerHTML = '';
        if (bsEditModal) bsEditModal.show();
    };

    if (copyInviteCodeBtn && editInviteCode) {
        copyInviteCodeBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(editInviteCode.value).then(() => {
                alert('Invite code copied to clipboard!');
            }).catch(() => {
                editInviteCode.select();
                document.execCommand('copy');
            });
        });
    }

    // ---- Create Room Flow ----
    if (openCreateModalBtn) {
        openCreateModalBtn.addEventListener('click', () => {
            if (createRoomForm) createRoomForm.reset();
            if (createPicPreviewWrap) createPicPreviewWrap.classList.add('d-none');
            if (createNameFeedback) createNameFeedback.innerHTML = '';
            if (bsCreateModal) bsCreateModal.show();
        });
    }

    // Name uniqueness check helper
    function checkNameAvailability(nameInput, feedbackEl, roomId = null) {
        if (!nameInput || !feedbackEl) return;
        const name = nameInput.value.trim();
        if (!name) {
            feedbackEl.innerHTML = '';
            return;
        }
        feedbackEl.innerHTML = '<span class="text-muted"><i class="fas fa-spinner fa-spin"></i> Checking availability...</span>';

        fetch(`/api/chatrooms/check-name/?name=${encodeURIComponent(name)}${roomId ? `&room_id=${roomId}` : ''}`)
            .then(r => r.json())
            .then(d => {
                if (d.available) {
                    feedbackEl.innerHTML = '<span class="text-success"><i class="fas fa-check-circle me-1"></i> Name is available</span>';
                } else {
                    feedbackEl.innerHTML = '<span class="text-danger"><i class="fas fa-times-circle me-1"></i> Name is already taken</span>';
                }
            })
            .catch(() => {
                feedbackEl.innerHTML = '';
            });
    }

    if (createRoomName) {
        createRoomName.addEventListener('input', () => {
            if (nameCheckDebounceTimer) clearTimeout(nameCheckDebounceTimer);
            nameCheckDebounceTimer = setTimeout(() => {
                checkNameAvailability(createRoomName, createNameFeedback);
            }, 300);
        });
    }

    if (editRoomName) {
        editRoomName.addEventListener('input', () => {
            if (nameCheckDebounceTimer) clearTimeout(nameCheckDebounceTimer);
            nameCheckDebounceTimer = setTimeout(() => {
                checkNameAvailability(editRoomName, editNameFeedback, editRoomId.value);
            }, 300);
        });
    }

    // Picture Previews
    if (createRoomPicture) {
        createRoomPicture.addEventListener('change', (e) => {
            const f = e.target.files[0];
            if (f && createPicPreview && createPicPreviewWrap) {
                createPicPreview.src = URL.createObjectURL(f);
                createPicPreviewWrap.classList.remove('d-none');
            }
        });
    }

    if (editRoomPicture) {
        editRoomPicture.addEventListener('change', (e) => {
            const f = e.target.files[0];
            if (f && editPicPreview && editPicPreviewWrap) {
                editPicPreview.src = URL.createObjectURL(f);
                editPicPreviewWrap.classList.remove('d-none');
            }
        });
    }

    // Submit Create Room
    if (createRoomForm) {
        createRoomForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = createRoomName.value.trim();
            if (!name) return;

            if (submitCreateRoomBtn) submitCreateRoomBtn.disabled = true;

            try {
                let pictureKey = '';
                if (createRoomPicture && createRoomPicture.files[0]) {
                    pictureKey = await uploadImageToS3(createRoomPicture.files[0]);
                }

                const formData = new FormData();
                formData.append('name', name);
                formData.append('description', createRoomDesc.value.trim());
                formData.append('privacy', createRoomPrivacy.value);
                formData.append('member_limit', createRoomLimit.value || '20');
                if (pictureKey) formData.append('picture', pictureKey);

                const res = await fetch('/api/chatrooms/create/', {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCsrfToken() },
                    body: formData
                });
                const data = await res.json();
                if (data.success) {
                    if (bsCreateModal) bsCreateModal.hide();
                    createRoomForm.reset();
                    loadRooms();
                } else {
                    alert(data.error || 'Failed to create room');
                }
            } catch (err) {
                console.error('create room error:', err);
                alert('Error creating room: ' + err.message);
            } finally {
                if (submitCreateRoomBtn) submitCreateRoomBtn.disabled = false;
            }
        });
    }

    // Submit Edit Room
    if (editRoomForm) {
        editRoomForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const roomId = editRoomId.value;
            const name = editRoomName.value.trim();
            if (!roomId || !name) return;

            if (submitEditRoomBtn) submitEditRoomBtn.disabled = true;

            try {
                let pictureKey = '';
                if (editRoomPicture && editRoomPicture.files[0]) {
                    pictureKey = await uploadImageToS3(editRoomPicture.files[0]);
                }

                const formData = new FormData();
                formData.append('name', name);
                formData.append('description', editRoomDesc.value.trim());
                formData.append('privacy', editRoomPrivacy.value);
                formData.append('member_limit', editRoomLimit.value || '20');
                if (pictureKey) formData.append('picture', pictureKey);

                const res = await fetch(`/api/chatrooms/${roomId}/edit/`, {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCsrfToken() },
                    body: formData
                });
                const data = await res.json();
                if (data.success) {
                    if (bsEditModal) bsEditModal.hide();
                    loadRooms();
                } else {
                    alert(data.error || 'Failed to edit room');
                }
            } catch (err) {
                console.error('edit room error:', err);
                alert('Error editing room: ' + err.message);
            } finally {
                if (submitEditRoomBtn) submitEditRoomBtn.disabled = false;
            }
        });
    }

    // ---- Tabs & Filter Listeners ----
    if (chatroomsTabs) {
        chatroomsTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('.chatrooms-tab-btn');
            if (!btn) return;
            chatroomsTabs.querySelectorAll('.chatrooms-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTab = btn.dataset.tab || 'all';
            loadRooms();
        });
    }

    if (chatroomsSearchInput) {
        chatroomsSearchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.trim();
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                loadRooms();
            }, 300);
        });
    }

    if (chatroomsPrivacyFilter) {
        chatroomsPrivacyFilter.addEventListener('change', (e) => {
            privacyFilter = e.target.value;
            loadRooms();
        });
    }

    // ---- Init ----
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof bootstrap !== 'undefined') {
            if (createRoomModalEl) bsCreateModal = new bootstrap.Modal(createRoomModalEl);
            if (editRoomModalEl) bsEditModal = new bootstrap.Modal(editRoomModalEl);
            if (joinPrivateModalEl) bsJoinPrivateModal = new bootstrap.Modal(joinPrivateModalEl);
        }
        loadRooms();
    });

})();
