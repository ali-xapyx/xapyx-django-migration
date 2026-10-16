/**
 * XAPYX Page View — ported from model/page_view.php
 * Cache-bust: ?v=1
 * Layout chain renamed to match dashboard shell.
 */
(function () {
    'use strict';

    (function createStars() {
        var container = document.getElementById('xpyStarsBg');
        if (!container) return;
        var count = window.innerWidth < 480 ? 80 : window.innerWidth < 768 ? 120 : 200;
        for (var i = 0; i < count; i++) {
            var star = document.createElement('div');
            star.className = 'xpy-star-dot';
            var size = Math.random() * 2.5 + 0.5;
            star.style.cssText =
                'width:' + size + 'px;height:' + size + 'px;' +
                'left:' + (Math.random() * 100) + '%;top:' + (Math.random() * 100) + '%;' +
                '--xpy-d:' + ((Math.random() * 4 + 1.5).toFixed(1)) + 's;' +
                'animation-delay:' + ((Math.random() * 6).toFixed(1)) + 's;' +
                'opacity:' + (Math.random() * 0.5 + 0.3) + ';';
            container.appendChild(star);
        }
    })();



    const _injected =
        (window.XAPYX_PAGE_VIEW && window.XAPYX_PAGE_VIEW.config) || {};

    const CONFIG = {
        pageId:             _injected.pageId      || null,
        userId:             _injected.userId      || null,
        isAdmin:            Boolean(_injected.isAdmin || (window.XPY_CONFIG && window.XPY_CONFIG.isStaff)),
        creatorId:          _injected.creatorId   || null,
        isFollower:         _injected.isFollower  || false,
        pageTitle:          _injected.pageTitle   || '',
        pageProfileImage:   _injected.pageProfileImage || '/static/images/avatars/default.png',
        mentionData:        _injected.mentionData || { followers: [], friends: [] }
    };




    let State = {
        currentPage: 1,
        isLoading: false,
        hasMorePosts: true,
        selectedFiles: [],
        pollData: null,
        postToDelete: null,
        isFollowing: CONFIG.isFollower
    };



    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }



    function showAlert(message, type = 'success') {
        const alertContainer = document.getElementById('alertContainer');
        if (!alertContainer) return;
        const alert = document.createElement('div');
        alert.className = `custom-alert custom-alert-${type}`;
        alert.innerHTML = `
            <div class="alert-content">
                <i class="bi ${type === 'success' ? 'bi-check-circle' : type === 'error' ? 'bi-exclamation-circle' : 'bi-info-circle'}"></i>
                <span>${message}</span>
            </div>
        `;
        alertContainer.appendChild(alert);
        
        setTimeout(() => {
            alert.style.opacity = '0';
            setTimeout(() => {
                if (alert.parentNode) alert.remove();
            }, 300);
        }, 3000);
    }



    function showAlertModal(title, message, type = 'info') {
        const modalEl = document.getElementById('alertModal');
        const alertIcon = document.getElementById('alertIcon');
        const alertTitle = document.getElementById('alertTitle');
        const alertMessage = document.getElementById('alertMessage');

        let iconClass = 'bi-info-circle';
        let iconColor = 'var(--xpy-primary)';

        if (type === 'success') {
            iconClass = 'bi-check-circle-fill';
            iconColor = 'var(--success-color)';
        } else if (type === 'error') {
            iconClass = 'bi-x-circle-fill';
            iconColor = 'var(--danger-color)';
        } else if (type === 'warning') {
            iconClass = 'bi-exclamation-triangle-fill';
            iconColor = 'var(--warning-color)';
        }

        alertIcon.innerHTML = `<i class="bi ${iconClass}" style="font-size: 3rem; color: ${iconColor}"></i>`;
        alertTitle.textContent = title;
        alertMessage.textContent = message;

        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }


    function openImagePreview(src) {
        if (window.openMediaLightbox) {
            window.openMediaLightbox(src);
        } else {
            const modal = new bootstrap.Modal(document.getElementById('imageViewerModal'));
            document.getElementById('viewerImage').src = src;
            modal.show();
        }
    }


    function sharePage() {
        navigator.clipboard.writeText(window.location.href);
        showAlert('Link copied to clipboard!', 'success');
    }


    function showPageInfoModal() {
        new bootstrap.Modal(document.getElementById('pageInfoModal')).show();
    }


    function showEditPageModal() {
        new bootstrap.Modal(document.getElementById('editPageModal')).show();
    }


    function previewImage(event, previewId) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                document.querySelector(`#${previewId} img`).src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    }



    async function viewAllFollowers() {
        const modal = new bootstrap.Modal(document.getElementById('allFollowersModal'));
        const container = document.getElementById('allFollowersList');
        container.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div></div>';
        modal.show();
        
        try {
            const response = await fetch(`/api/pages/${CONFIG.pageId}/followers/`, {
                credentials: 'same-origin'
            });
            const data = await response.json();
            
            if (data.success && data.followers) {
                container.innerHTML = data.followers.map(f => {
                    var av = f.picture || '/static/images/avatars/default.png';
                    var avThumb = av;
                    if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
                        avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
                    }
                    return `
                    <a href="/user/${f.username}/" class="follower-list-item">
                        <img src="${avThumb}" data-full-src="${av}" width="44" height="44" class="follower-avatar" onerror="this.onerror=null;this.src='${av}'">
                        <div class="follower-info">
                            <div class="follower-name">${escapeHtml(f.name)}</div>
                            <div class="follower-username">@${escapeHtml(f.username)}</div>
                        </div>
                        ${f.id === CONFIG.creatorId ? '<span class="follower-badge">Admin</span>' : ''}
                    </a>
                `;
                }).join('');
                if (data.followers.length === 0) container.innerHTML = '<div class="text-center text-muted py-4">No followers yet.</div>';
            }
        } catch (error) {
            console.error('Error loading followers:', error);
            container.innerHTML = '<div class="text-center text-danger py-4">Error loading followers</div>';
        }
    }




    async function toggleFollow() {
        const followBtn = document.getElementById('followBtn');
        const followBtnMobile = document.getElementById('followBtnMobile');
        const buttons = [followBtn, followBtnMobile].filter(Boolean);
        
        buttons.forEach(btn => {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>';
        });
        
        try {
            const response = await fetch(`/api/pages/${CONFIG.pageId}/toggle-follow/`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({})
            });
            
            const data = await response.json();
            
            if (data.success) {
                State.isFollowing = data.is_following;
                
                const followersCount = document.getElementById('desktopFollowersCount');
                const mobileFollowersCount = document.getElementById('mobileFollowersCount');
                
                if (followersCount) {
                    let current = parseInt(followersCount.textContent || '0');
                    followersCount.textContent = State.isFollowing ? current + 1 : Math.max(0, current - 1);
                }
                if (mobileFollowersCount) {
                    let current = parseInt(mobileFollowersCount.textContent || '0');
                    mobileFollowersCount.textContent = State.isFollowing ? current + 1 : Math.max(0, current - 1);
                }
                
                buttons.forEach(btn => {
                    btn.disabled = false;
                    if (State.isFollowing) {
                        btn.innerHTML = '<i class="bi bi-check"></i> Following';
                        btn.className = 'btn btn-follow-page following';
                    } else {
                        btn.innerHTML = '<i class="bi bi-plus"></i> Follow' + (btn.id === 'followBtn' ? ' Page' : '');
                        btn.className = 'btn btn-follow-page';
                    }
                });
                
                showAlert(State.isFollowing ? 'You are now following this page!' : 'You unfollowed this page', 'success');
                
                setTimeout(() => loadPosts(true), 500);
            } else {
                throw new Error(data.error || 'Failed to update follow status');
            }
        } catch (error) {
            console.error('Error toggling follow:', error);
            showAlertModal('Error', error.message || 'Network error. Please try again.', 'error');
            
            buttons.forEach(btn => {
                btn.disabled = false;
                if (State.isFollowing) {
                    btn.innerHTML = '<i class="bi bi-check"></i> Following';
                    btn.className = 'btn btn-follow-page following';
                } else {
                    btn.innerHTML = '<i class="bi bi-plus"></i> Follow' + (btn.id === 'followBtn' ? ' Page' : '');
                    btn.className = 'btn btn-follow-page';
                }
            });
        }
    }



    function updateCharCount() {
        const textarea = document.getElementById('postContent');
        const charCount = document.getElementById('charCount');
        if (textarea && charCount) {
            const remaining = 500 - textarea.value.length;
            charCount.textContent = remaining;
            charCount.className = 'char-count' + (remaining < 50 ? ' text-danger' : '');
        }
    }


    function handleMediaSelect(e) {
        const files = Array.from(e.target.files);

        files.forEach(file => {
            if (file.size > 10 * 1024 * 1024) {
                showAlertModal('Error', 'File size must be less than 10MB', 'error');
                return;
            }

            let type = 'file';
            if (file.type.startsWith('image/')) type = 'image';
            else if (file.type.startsWith('video/')) type = 'video';

            if (['image', 'video'].includes(type)) {
                State.selectedFiles.push({
                    type: type,
                    file: file,
                    preview: URL.createObjectURL(file)
                });
            }
        });

        updateMediaPreview();
        e.target.value = '';
    }


    function updateMediaPreview() {
        const preview = document.getElementById('mediaPreview');
        if (!preview) return;

        preview.innerHTML = '';
        if (State.selectedFiles.length === 0) {
            preview.classList.add('d-none');
            return;
        }

        preview.classList.remove('d-none');
        State.selectedFiles.forEach((media, index) => {
            const item = document.createElement('div');
            item.className = 'media-item';
            item.innerHTML = `
                ${media.type === 'image' ? `<img src="${media.preview}">` : `<video src="${media.preview}"></video>`}
                <button class="remove-media" onclick="removeMedia(${index})"><i class="bi bi-x"></i></button>
            `;
            preview.appendChild(item);
        });
    }


    function removeMedia(index) {
        if (State.selectedFiles[index]?.preview) URL.revokeObjectURL(State.selectedFiles[index].preview);
        State.selectedFiles.splice(index, 1);
        updateMediaPreview();
    }



    async function createPost() {
        const content = document.getElementById('postContent').value.trim();
        
        if (!content && State.selectedFiles.length === 0) {
            showAlertModal('Warning', 'Please add some content', 'warning');
            return;
        }
        
        const postBtn = document.getElementById('postSubmit');
        postBtn.disabled = true;
        postBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Posting...';
        
        const formData = new FormData();
        formData.append('content', content);
        
        State.selectedFiles.forEach((media) => {
            if (media.file) formData.append('media', media.file);
        });
        
        try {
            const response = await fetch(`/api/pages/${CONFIG.pageId}/posts/create/`, {
                method: 'POST',
                body: formData,
                credentials: 'same-origin',
                headers: { 'X-CSRFToken': getCsrfToken() }
            });
            
            const data = await response.json();
            
            if (data.success) {
                document.getElementById('postContent').value = '';
                State.selectedFiles.forEach(f => { if (f.preview) URL.revokeObjectURL(f.preview); });
                State.selectedFiles = [];
                updateMediaPreview();
                updateCharCount();
                
                if (data.post) {
                    const feedContainer = document.getElementById('feedContainer');
                    const postEl = createPostElement(data.post);
                    feedContainer.insertBefore(postEl, feedContainer.firstChild);
                    
                    ['desktopPostsCount', 'mobilePostsCount'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.textContent = parseInt(el.textContent || '0') + 1;
                    });
                }
                
                showAlert('Post created successfully!', 'success');
            } else {
                throw new Error(data.error || 'Failed to create post');
            }
        } catch (error) {
            console.error('Error creating post:', error);
            showAlertModal('Error', error.message || 'Failed to create post', 'error');
        } finally {
            postBtn.disabled = false;
            postBtn.innerHTML = 'Post';
        }
    }




// ============================================================
// SKELETON PLACEHOLDERS FOR PAGINATION
// ============================================================
function renderPostSkeleton() {
    return '<div class="post-card-vertical post-skeleton" aria-hidden="true">' +
        '<div class="post-header feed-post-header">' +
            '<div class="post-author d-flex align-items-center gap-2">' +
                '<div class="skeleton-shimmer skeleton-avatar"></div>' +
                '<div class="post-author-info post-header-meta post-user-details" style="flex:1;">' +
                    '<div class="skeleton-shimmer skeleton-line skeleton-title"></div>' +
                    '<div class="skeleton-shimmer skeleton-line skeleton-subtitle"></div>' +
                '</div>' +
            '</div>' +
        '</div>' +
        '<div class="post-content" style="padding: 12px 0 8px;">' +
            '<div class="skeleton-shimmer skeleton-line" style="width: 92%;"></div>' +
            '<div class="skeleton-shimmer skeleton-line" style="width: 68%;"></div>' +
        '</div>' +
        '<div class="skeleton-shimmer skeleton-media"></div>' +
        '<div class="post-footer d-flex justify-content-between pt-2">' +
            '<div class="skeleton-shimmer skeleton-action-btn"></div>' +
            '<div class="skeleton-shimmer skeleton-action-btn"></div>' +
            '<div class="skeleton-shimmer skeleton-action-btn"></div>' +
            '<div class="skeleton-shimmer skeleton-action-btn"></div>' +
        '</div>' +
    '</div>';
}

function appendPostSkeletons(container, count) {
    if (!container) return;
    count = count || 2;
    var html = '';
    for (var i = 0; i < count; i++) {
        html += renderPostSkeleton();
    }
    container.insertAdjacentHTML('beforeend', html);
}

function removePostSkeletons(container) {
    if (!container) return;
    var skeletons = container.querySelectorAll('.post-skeleton');
    skeletons.forEach(function(sk) {
        sk.remove();
    });
}

    async function loadPosts(reset = false) {
        if (State.isLoading || (!State.hasMorePosts && !reset)) return;
        
        State.isLoading = true;
        const feedContainer = document.getElementById('feedContainer');
        const loadMoreContainer = document.getElementById('loadMoreContainer');
        
        if (reset) {
            State.currentPage = 1;
            State.hasMorePosts = true;
            feedContainer.innerHTML = '';
            appendPostSkeletons(feedContainer, 3);
            if (loadMoreContainer) loadMoreContainer.classList.add('d-none');
        } else {
            appendPostSkeletons(feedContainer, 2);
            if (loadMoreContainer) loadMoreContainer.classList.add('d-none');
        }
        
        try {
            const response = await fetch(`/api/pages/${CONFIG.pageId}/posts/?page=${State.currentPage}`, {
                credentials: 'same-origin'
            });
            const data = await response.json();
            removePostSkeletons(feedContainer);
            
            if (data.success) {
                if (reset) feedContainer.innerHTML = '';
                
                if (data.posts && data.posts.length > 0) {
                    data.posts.forEach(post => {
                        feedContainer.appendChild(createPostElement(post));
                    });
                    State.hasMorePosts = data.has_more === true;
                    if (loadMoreContainer) {
                        State.hasMorePosts ? loadMoreContainer.classList.remove('d-none') : loadMoreContainer.classList.add('d-none');
                    }
                    State.currentPage++;
                } else if (reset) {
                    feedContainer.innerHTML = `
                        <div class="empty-state" id="emptyState">
                            <div class="empty-icon"><i class="bi bi-newspaper"></i></div>
                            <h5>No posts yet</h5>
                            <p>Be the first to share something on this page!</p>
                            ${CONFIG.isAdmin
                                ? '<button class="btn btn-primary" onclick="document.getElementById(\'postContent\').focus()" style="background:linear-gradient(135deg,var(--xpy-primary),var(--xpy-secondary));border:none;color:white;">Create First Post</button>'
                                : ''}
                        </div>
                    `;
                }
            }
        } catch (error) {
            removePostSkeletons(feedContainer);
            console.error('Error loading posts:', error);
            if (reset) {
                feedContainer.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon"><i class="bi bi-exclamation-triangle" style="color:var(--danger-color);"></i></div>
                        <h5 style="color:var(--danger-color);">Error loading posts</h5>
                        <button class="btn btn-primary" onclick="location.reload()" style="background:linear-gradient(135deg,var(--xpy-primary),var(--xpy-secondary));border:none;color:white;">Refresh</button>
                    </div>
                `;
            }
        } finally {
            State.isLoading = false;
        }
    }



    function createPostElement(post) {
        var el = document.createElement('div');
        el.className = 'post-card-vertical post-card feed-post-item';
        el.dataset.postId = post.id;
        el.dataset.source = 'page';

        var postHeader = '<div class="post-header feed-post-header">'
            + '<div class="post-author post-user-info" onclick="window.location=\'/pages/'
            + CONFIG.pageId + '/\'">'
            +   '<img src="' + CONFIG.pageProfileImage + '" data-full-src="' + CONFIG.pageProfileImage + '" width="44" height="44" class="post-author-avatar">'
            +   '<div class="post-author-info post-header-meta post-user-details">'
            +     '<h6 class="post-author-name">' + escapeHtml(CONFIG.pageTitle) + '</h6>'
            +     '<span class="post-meta">Page · ' + post.time_ago
            +       (post.is_edited ? ' · <span class="badge-edit">Edited</span>' : '')
            +     '</span>'
            +   '</div>'
            + '</div>'
            + '<div class="post-actions-dropdown">'
            +   '<button class="post-action-btn" onclick="togglePostActionsMenu(this, ' + post.id + ')">'
            +     '<i class="bi bi-three-dots-vertical"></i>'
            +   '</button>'
            +   '<ul class="dropdown-menu">'
            +     '<li><a class="dropdown-item" href="#" onclick="sharePost(' + post.id + '); return false;">'
            +       '<i class="bi bi-link-45deg"></i> Copy Link</a></li>'
            +     (CONFIG.isAdmin
                  ? '<li><hr class="dropdown-divider"></li>'
                  + '<li><a class="dropdown-item text-danger" href="#" '
                  + 'onclick="confirmDeletePost(' + post.id + '); return false;">'
                  + '<i class="bi bi-trash"></i> Delete Post</a></li>'
                  : '')
            +   '</ul>'
            + '</div>'
            + '</div>';

        var mediaHtml = '';
        if (post.media && post.media.length > 0) {
            mediaHtml = '<div class="post-media-slider" id="slider-' + post.id + '" data-media=\'' + JSON.stringify(post.media) + '\'><div class="slider-container">' +
                post.media.map(function(m, idx) {
                    return '<div class="slider-item ' + (m.type === 'video' ? 'has-video ' : '') + (idx === 0 ? 'active' : '') + '" data-index="' + idx + '">' +
                        (m.type === 'video'
                            ? '<video controls preload="metadata" muted playsinline loop autoplay onclick="toggleVideoSound(this, event)"><source src="' + m.url + '" type="' + (m.mime_type || 'video/mp4') + '"></video>'
                            : '<img class="post-media-blur-bg" src="' + (m.thumbnail_url || m.url) + '" alt="" aria-hidden="true">' +
                              '<img src="' + (m.thumbnail_url || m.url) + '" class="post-image slider-image" width="800" height="600" loading="lazy" decoding="async" onload="if(typeof applyAmbientBackground===\'function\')applyAmbientBackground(this);if(this.naturalWidth>=this.naturalHeight)this.classList.add(\'landscape\')" onerror="this.onerror=null;this.src=\'' + m.url + '\'" onclick="openMediaLightbox(\'' + (m.url || '').replace(/'/g, "\\'") + '\')">') +
                        '</div>';
                }).join('') +
                '</div>' +
                (post.media.length > 1
                    ? '<button class="slider-prev" onclick="slideMedia(' + post.id + ', -1)"><i class="bi bi-chevron-left"></i></button><button class="slider-next" onclick="slideMedia(' + post.id + ', 1)"><i class="bi bi-chevron-right"></i></button><div class="slider-indicators">' +
                        post.media.map(function(_, idx) { return '<span class="indicator ' + (idx === 0 ? 'active' : '') + '" onclick="goToSlide(' + post.id + ', ' + idx + ')"></span>'; }).join('') +
                        '</div>'
                    : '') +
                '</div>';
        }

        var fullContent = post.content || '';
        var truncated = (typeof truncateContent === 'function')
            ? truncateContent(fullContent, 4)
            : (function(c, max) { var l = c.split('\n'); return l.length <= max ? c : l.slice(0, max).join('\n'); })(fullContent, 4);
        var formatted = (typeof formatMentions === 'function')
            ? formatMentions(escapeHtml(truncated))
            : escapeHtml(truncated);

        var statsTop = '<div class="post-stats-top" style="cursor:default;">'
            + '<span class="post-views-count"><i class="bi bi-eye"></i> '
            +   (post.views || 0) + '</span>'
            + '</div>';

        var postBody = '<div class="post-body">'
            + '<div class="post-content">' + formatted + '</div>'
            + mediaHtml
            + statsTop
            + '</div>';

        var postFooter = '<div class="post-footer">'
            + '<div class="post-actions-horizontal">'
            +   '<button class="post-action-btn-horizontal like-btn '
            +     (post.user_reaction === 'like' ? 'active' : '')
            +     '" onclick="reactToPost(' + post.id + ', \'like\', this)">'
            +     '<i class="bi bi-hand-thumbs-up'
            +       (post.user_reaction === 'like' ? '-fill' : '')
            +     '"></i>'
            +     '<span class="action-count">' + (post.likes || 0) + '</span>'
            +   '</button>'
            +   '<button class="post-action-btn-horizontal dislike-btn '
            +     (post.user_reaction === 'dislike' ? 'active' : '')
            +     '" onclick="reactToPost(' + post.id + ', \'dislike\', this)">'
            +     '<i class="bi bi-hand-thumbs-down'
            +       (post.user_reaction === 'dislike' ? '-fill' : '')
            +     '"></i>'
            +     '<span class="action-count">' + (post.dislikes || 0) + '</span>'
            +   '</button>'
            +   '<button class="post-action-btn-horizontal comment-btn" '
            +     'onclick="toggleComments(' + post.id + ')">'
            +     '<i class="bi bi-chat"></i>'
            +     '<span class="action-count">' + (post.comments_count || 0) + '</span>'
            +   '</button>'
            +   '<button class="post-action-btn-horizontal share-btn" '
            +     'onclick="sharePost(' + post.id + ')">'
            +     '<i class="bi bi-share"></i>'
            +     '<span class="action-count">' + (post.shares || 0) + '</span>'
            +   '</button>'
            + '</div>'
            + '</div>';

        var commentsHtml = '<div class="comments-section-expandable" '
            + 'id="comments-' + post.id + '">'
            + '<div class="comments-container" id="comments-container-' + post.id + '">'
            +   '<div class="no-comments">No comments yet. Be the first!</div>'
            + '</div>'
            + '<div class="comment-form-expandable">'
            +   '<input type="text" class="comment-input-expandable" '
            +     'placeholder="Write a comment..." '
            +     'id="comment-input-' + post.id + '" '
            +     'onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();submitComment(' + post.id + ');}">'
            +   '<button class="comment-submit-btn" '
            +     'onclick="submitComment(' + post.id + ')">Post</button>'
            + '</div>'
            + '</div>';

        el.innerHTML = postHeader + postBody + postFooter + commentsHtml;
        setTimeout(function() {
            el.querySelectorAll('video').forEach(function(v) {
                if (typeof videoObserver !== 'undefined' && videoObserver) videoObserver.observe(v);
            });
        }, 100);
        if (typeof postObserver !== 'undefined' && postObserver) postObserver.observe(el);
        return el;
    }


    async function toggleComments(postId) {
        const section = document.getElementById(`comments-${postId}`);
        if (!section) return;

        const isExpanded = section.classList.contains('expanded') || section.style.display === 'block';

        if (!isExpanded) {
            section.classList.add('expanded');
            section.style.display = 'block';
            await loadComments(postId);
            const input = document.getElementById(`comment-input-${postId}`);
            if (input) setTimeout(() => input.focus(), 100);
        } else {
            section.classList.remove('expanded');
            section.style.display = 'none';
        }
    }



    async function loadComments(postId) {
        const container = document.getElementById(`comments-container-${postId}`);
        if (!container) return;
        
        container.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Loading comments...</div>';
        
        try {
            const response = await fetch(`/api/pages/posts/${postId}/comments/`, {
                credentials: 'same-origin'
            });
            const data = await response.json();
            
            if (data.success) {
                container.innerHTML = '';
                if (data.comments.length === 0) {
                    container.innerHTML = '<div class="text-center text-muted py-3">No comments yet. Be the first to comment!</div>';
                    return;
                }
                data.comments.forEach(comment => {
                    container.appendChild(createCommentElement(comment));
                });
            }
        } catch (error) {
            console.error('Error loading comments:', error);
            container.innerHTML = '<div class="text-center text-danger py-3">Error loading comments</div>';
        }
    }



    function createCommentElement(comment) {
        const div = document.createElement('div');
        div.className = 'comment-item';
        div.dataset.commentId = comment.id;

        const isOwner = comment.author.id === CONFIG.userId || CONFIG.isAdmin;

        var av = (comment.author && comment.author.picture) ? comment.author.picture : '/static/images/avatars/default.png';
        var avThumb = av;
        if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
            avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
        }

        div.innerHTML = `
            <img src="${avThumb}" data-full-src="${av}" width="44" height="44" class="comment-avatar" width="36" height="36" onerror="this.onerror=null;this.src='${av}'">
            <div class="comment-content">
                <div class="comment-header">
                    <span class="comment-author" onclick="window.location='/user/${comment.author.username}/'">${escapeHtml(comment.author.name)}</span>
                    <span class="comment-time">${comment.time_ago}</span>
                </div>
                <div class="comment-text">${escapeHtml(comment.content)}</div>
                ${isOwner ? `<div class="comment-actions"><button class="btn" onclick="deleteComment(${comment.id})">Delete</button></div>` : ''}
            </div>
        `;
        return div;
    }



    async function submitComment(postId) {
        const input = document.getElementById(`comment-input-${postId}`);
        if (!input) return;
        const content = input.value.trim();
        if (!content) return;

        const savedContent = content;
        input.value = '';

        const postCard = document.querySelector(`.post-card-vertical[data-post-id="${postId}"]`);
        const commentCount = postCard?.querySelector('.comment-btn .action-count') || postCard?.querySelector('.comment-btn span');
        const prevCount = commentCount ? parseInt(commentCount.textContent || '0', 10) : 0;
        if (commentCount) commentCount.textContent = prevCount + 1;

        const container = document.getElementById(`comments-container-${postId}`);
        const noComments = container?.querySelector('.no-comments');
        const wasNoComments = Boolean(noComments);
        if (noComments) noComments.style.display = 'none';

        const tempId = 'temp-' + Date.now();
        const currentUserName = (function() {
            const el = document.querySelector('.user-info h4, .avatar-img');
            return el ? (el.alt || el.textContent.trim()) : 'You';
        })();
        const currentUsername = (function() {
            const el = document.querySelector('.user-info span');
            const u = el ? el.textContent.trim().replace(/^@/, '') : '';
            return u || 'you';
        })();
        const currentUserPic = (function() {
            const el = document.querySelector('.avatar-mini-img, .avatar-img');
            return el ? el.getAttribute('src') : '/static/images/avatars/default.png';
        })();

        const optimisticComment = {
            id: tempId,
            author: {
                id: CONFIG.userId,
                name: currentUserName,
                username: currentUsername,
                picture: currentUserPic
            },
            content: savedContent,
            time_ago: 'Just now'
        };

        const tempEl = createCommentElement(optimisticComment);
        tempEl.style.opacity = '0.65';
        tempEl.style.transition = 'opacity 0.2s ease';
        tempEl.dataset.isOptimistic = 'true';
        if (container) container.appendChild(tempEl);

        try {
            const response = await fetch(`/api/pages/posts/${postId}/comments/add/`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({ content: savedContent })
            });

            const data = await response.json();

            if (data.success) {
                if (tempEl) {
                    tempEl.style.opacity = '1';
                    tempEl.dataset.commentId = data.comment.id;
                    delete tempEl.dataset.isOptimistic;
                    const delBtn = tempEl.querySelector('.comment-actions button, button.comment-delete-btn');
                    if (delBtn) {
                        delBtn.setAttribute('onclick', `deleteComment(${data.comment.id})`);
                    }
                }
                if (wasNoComments && noComments) {
                    noComments.remove();
                }
            } else {
                if (tempEl) tempEl.remove();
                if (wasNoComments && noComments) noComments.style.display = '';
                if (commentCount) commentCount.textContent = prevCount;
                input.value = savedContent;
                showAlertModal('Error', data.error || 'Failed to post comment', 'error');
            }
        } catch (error) {
            if (tempEl) tempEl.remove();
            if (wasNoComments && noComments) noComments.style.display = '';
            if (commentCount) commentCount.textContent = prevCount;
            input.value = savedContent;
            showAlertModal('Error', 'Failed to post comment', 'error');
        } finally {
            input.focus();
        }
    }




    async function deleteComment(commentId) {
        if (!confirm('Delete this comment?')) return;
        
        try {
            const response = await fetch(`/api/pages/comments/${commentId}/delete/`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'X-CSRFToken': getCsrfToken() }
            });
            
            const data = await response.json();
            if (data.success) {
                const commentEl = document.querySelector(`.comment-item[data-comment-id="${commentId}"]`);
                commentEl?.remove();
            }
        } catch (error) {
            console.error('Error deleting comment:', error);
            showAlertModal('Error', 'Failed to delete comment', 'error');
        }
    }




    const reactingPagePosts = {};

    async function reactToPost(postId, reaction, btn) {
        if (!postId || (reaction !== 'like' && reaction !== 'dislike')) return;
        if (reactingPagePosts[postId]) return;

        const postCard = document.querySelector(`.post-card-vertical[data-post-id="${postId}"]`);
        if (!postCard) return;

        const likeBtn = postCard.querySelector('.like-btn');
        const dislikeBtn = postCard.querySelector('.dislike-btn');
        if (!likeBtn || !dislikeBtn) return;

        const likeCountEl = likeBtn.querySelector('.action-count') || likeBtn.querySelector('span');
        const dislikeCountEl = dislikeBtn.querySelector('.action-count') || dislikeBtn.querySelector('span');

        const currentLikes = parseInt(likeCountEl ? likeCountEl.textContent : '0', 10) || 0;
        const currentDislikes = parseInt(dislikeCountEl ? dislikeCountEl.textContent : '0', 10) || 0;

        const wasLiked = likeBtn.classList.contains('active');
        const wasDisliked = dislikeBtn.classList.contains('active');

        const prevState = {
            wasLiked: wasLiked,
            wasDisliked: wasDisliked,
            likes: currentLikes,
            dislikes: currentDislikes
        };

        let optLiked = false;
        let optDisliked = false;
        let optLikes = currentLikes;
        let optDislikes = currentDislikes;

        if (reaction === 'like') {
            if (wasLiked) {
                optLiked = false;
                optDisliked = false;
                optLikes = Math.max(0, currentLikes - 1);
                optDislikes = currentDislikes;
            } else if (wasDisliked) {
                optLiked = true;
                optDisliked = false;
                optLikes = currentLikes + 1;
                optDislikes = Math.max(0, currentDislikes - 1);
            } else {
                optLiked = true;
                optDisliked = false;
                optLikes = currentLikes + 1;
                optDislikes = currentDislikes;
            }
        } else if (reaction === 'dislike') {
            if (wasDisliked) {
                optLiked = false;
                optDisliked = false;
                optLikes = currentLikes;
                optDislikes = Math.max(0, currentDislikes - 1);
            } else if (wasLiked) {
                optLiked = false;
                optDisliked = true;
                optLikes = Math.max(0, currentLikes - 1);
                optDislikes = currentDislikes + 1;
            } else {
                optLiked = false;
                optDisliked = true;
                optLikes = currentLikes;
                optDislikes = currentDislikes + 1;
            }
        }

        function renderReactionState(isLiked, isDisliked, countLikes, countDislikes) {
            if (likeCountEl) likeCountEl.textContent = countLikes;
            if (dislikeCountEl) dislikeCountEl.textContent = countDislikes;

            likeBtn.classList.toggle('active', isLiked);
            const iconL = likeBtn.querySelector('i');
            if (iconL) iconL.className = `bi bi-hand-thumbs-up${isLiked ? '-fill' : ''}`;

            dislikeBtn.classList.toggle('active', isDisliked);
            const iconD = dislikeBtn.querySelector('i');
            if (iconD) iconD.className = `bi bi-hand-thumbs-down${isDisliked ? '-fill' : ''}`;
        }

        // Instant 0ms Optimistic UI update
        renderReactionState(optLiked, optDisliked, optLikes, optDislikes);
        reactingPagePosts[postId] = true;

        try {
            const response = await fetch(`/api/pages/posts/${postId}/react/`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({ reaction: reaction })
            });
            const data = await response.json();
            if (data.success) {
                renderReactionState(data.user_reaction === 'like', data.user_reaction === 'dislike', data.likes, data.dislikes);
            } else {
                renderReactionState(prevState.wasLiked, prevState.wasDisliked, prevState.likes, prevState.dislikes);
                showAlert(data.error || 'Failed to react', 'error');
            }
        } catch (error) {
            renderReactionState(prevState.wasLiked, prevState.wasDisliked, prevState.likes, prevState.dislikes);
            showAlert('Network error: reaction not saved', 'error');
        } finally {
            delete reactingPagePosts[postId];
        }
    }



    function confirmDeletePost(postId) {
        State.postToDelete = postId;
        new bootstrap.Modal(document.getElementById('deleteConfirmModal')).show();
    }



    async function deletePost(postId) {
        const modalEl = document.getElementById('deleteConfirmModal');
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();
        State.postToDelete = null;

        const postEl = document.querySelector(`.post-card-vertical[data-post-id="${postId}"]`);
        const desktopEl = document.getElementById('desktopPostsCount');
        const mobileEl = document.getElementById('mobilePostsCount');

        const prevDesk = desktopEl ? (parseInt(desktopEl.textContent || '0', 10) || 0) : null;
        const prevMob = mobileEl ? (parseInt(mobileEl.textContent || '0', 10) || 0) : null;

        if (desktopEl && prevDesk !== null) desktopEl.textContent = Math.max(0, prevDesk - 1);
        if (mobileEl && prevMob !== null) mobileEl.textContent = Math.max(0, prevMob - 1);

        let prevDisplay = '';
        if (postEl) {
            prevDisplay = postEl.style.display;
            postEl.style.transition = 'all 0.2s ease';
            postEl.style.opacity = '0';
            postEl.style.transform = 'scale(0.96)';
            setTimeout(() => {
                if (postEl && postEl.style.opacity === '0') {
                    postEl.style.display = 'none';
                }
            }, 200);
        }

        try {
            const response = await fetch(`/api/pages/posts/${postId}/delete/`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'X-CSRFToken': getCsrfToken() }
            });
            const data = await response.json();
            if (data.success) {
                if (postEl) postEl.remove();
                showAlert('Post deleted', 'success');
            } else {
                // Rollback on API failure
                if (postEl) {
                    postEl.style.display = prevDisplay;
                    setTimeout(() => {
                        postEl.style.opacity = '1';
                        postEl.style.transform = '';
                    }, 10);
                }
                if (desktopEl && prevDesk !== null) desktopEl.textContent = prevDesk;
                if (mobileEl && prevMob !== null) mobileEl.textContent = prevMob;
                showAlertModal('Error', data.error || 'Failed to delete post', 'error');
            }
        } catch (error) {
            console.error('Error deleting post:', error);
            if (postEl) {
                postEl.style.display = prevDisplay;
                setTimeout(() => {
                    postEl.style.opacity = '1';
                    postEl.style.transform = '';
                }, 10);
            }
            if (desktopEl && prevDesk !== null) desktopEl.textContent = prevDesk;
            if (mobileEl && prevMob !== null) mobileEl.textContent = prevMob;
            showAlertModal('Error', 'Failed to delete post', 'error');
        }
    }




    function sharePost(postId) {
        const url = `${window.location.origin}/pages/${CONFIG.pageId}/?post=${postId}`;
        navigator.clipboard.writeText(url);
        showAlert('Link copied to clipboard!', 'success');
    }



    document.addEventListener('DOMContentLoaded', function() {
        loadPosts(true);
        setupEventListeners();
        setupInfiniteScroll();



        // Close dropdowns when clicking outside
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.post-actions-dropdown')) {
                document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
                    menu.classList.remove('show');
                });
            }
        });
    });


    function setupEventListeners() {
        const postContent = document.getElementById('postContent');
        const postSubmit = document.getElementById('postSubmit');

        if (postContent) {
            postContent.addEventListener('input', updateCharCount);
        }

        if (postSubmit) {
            postSubmit.addEventListener('click', createPost);
        }

        document.getElementById('addPhotoBtn')?.addEventListener('click', () => document.getElementById('imageInput').click());
        document.getElementById('addVideoBtn')?.addEventListener('click', () => document.getElementById('videoInput').click());
        document.getElementById('imageInput')?.addEventListener('change', handleMediaSelect);
        document.getElementById('videoInput')?.addEventListener('change', handleMediaSelect);
        document.getElementById('loadMoreBtn')?.addEventListener('click', () => loadPosts());

        document.getElementById('followBtn')?.addEventListener('click', toggleFollow);
        document.getElementById('followBtnMobile')?.addEventListener('click', toggleFollow);

        document.getElementById('editPageBtn')?.addEventListener('click', showEditPageModal);
        document.getElementById('editPageBtnMobile')?.addEventListener('click', showEditPageModal);
        document.getElementById('sharePageBtn')?.addEventListener('click', sharePage);
        document.getElementById('sharePageBtnMobile')?.addEventListener('click', sharePage);
        document.getElementById('pageInfoBtnMobile')?.addEventListener('click', showPageInfoModal);

        document.getElementById('coverInput')?.addEventListener('change', function(e) { previewImage(e, 'coverPreview'); });
        document.getElementById('profileInput')?.addEventListener('change', function(e) { previewImage(e, 'profilePreview'); });
        document.getElementById('savePageChangesBtn')?.addEventListener('click', savePageChanges);
        document.getElementById('confirmDeleteBtn')?.addEventListener('click', function() {
            if (State.postToDelete) deletePost(State.postToDelete);
        });

        // Enter key for comments
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                const target = e.target;
                if (target.classList.contains('comment-input')) {
                    e.preventDefault();
                    const postId = target.id.replace('comment-input-', '');
                    submitComment(postId);
                }
            }
        });
    }


    function setupInfiniteScroll() {
        let timeout;
        window.addEventListener('scroll', function() {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 1000 && 
                    !State.isLoading && State.hasMorePosts) {
                    loadPosts();
                }
            }, 200);
        });
    }



    async function savePageChanges() {
        const formData = new FormData(document.getElementById('editPageForm'));
        
        const saveBtn = document.getElementById('savePageChangesBtn');
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';
        
        try {
            const response = await fetch(`/api/pages/${CONFIG.pageId}/update/`, {
                method: 'POST',
                body: formData,
                credentials: 'same-origin',
                headers: { 'X-CSRFToken': getCsrfToken() }
            });
            
            const data = await response.json();
            
            if (data.success) {
                if (data.page) updatePageUI(data.page);
                bootstrap.Modal.getInstance(document.getElementById('editPageModal')).hide();
                showAlert('Page updated successfully!', 'success');
            } else {
                throw new Error(data.error || 'Failed to update page');
            }
        } catch (error) {
            console.error('Error updating page:', error);
            showAlertModal('Error', error.message || 'Failed to update page', 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="bi bi-check-circle me-1"></i> Save Changes';
        }
    }



    function updatePageUI(page) {
        document.querySelectorAll('.page-title, .page-mobile-title').forEach(el => {
            el.textContent = page.title;
        });

        document.querySelectorAll('.page-description, .page-mobile-description').forEach(el => {
            el.textContent = page.description || 'No description';
        });

        if (page.cover_image_url) {
            document.querySelector('.page-cover').style.backgroundImage = `url('${page.cover_image_url}')`;
            document.querySelector('.page-cover-mobile').style.backgroundImage = `url('${page.cover_image_url}')`;
        }

        if (page.profile_image_url) {
            document.querySelectorAll('.page-profile-image img, .page-mobile-avatar').forEach(el => {
                el.src = page.profile_image_url;
            });
        }
    }



    document.addEventListener('DOMContentLoaded', function () {
        var messageHandler = async function () {
            if (!CONFIG.pageId) return;

            if (CONFIG.isAdmin) {
                // Page admin navigates to inbox filtered to their page
                window.location.href = '/pages/inbox/?page_id=' + encodeURIComponent(CONFIG.pageId);
                return;
            }

            // Visitor clicks Message: start or retrieve existing conversation
            try {
                var btn = this;
                var origText = btn.innerHTML;
                btn.disabled = true;

                var csrfToken = '';
                var csrfInput = document.querySelector('input[name="csrfmiddlewaretoken"]');
                if (csrfInput && csrfInput.value) {
                    csrfToken = csrfInput.value;
                } else {
                    var match = document.cookie.match(/csrftoken=([^;]+)/);
                    if (match) csrfToken = match[1];
                }

                var resp = await fetch('/api/pages/messages/start/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'X-CSRFToken': csrfToken,
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: new URLSearchParams({ page_id: CONFIG.pageId })
                });

                var data = await resp.json();
                if (data.success && data.conversation_id) {
                    window.location.href = '/pages/inbox/?conv_id=' + encodeURIComponent(data.conversation_id);
                } else {
                    showAlert(data.error || 'Failed to start conversation with page.', 'error');
                    btn.disabled = false;
                    btn.innerHTML = origText;
                }
            } catch (err) {
                console.error('Error starting page conversation:', err);
                showAlert('Failed to connect to page messaging.', 'error');
                if (btn) btn.disabled = false;
            }
        };

        var btn1 = document.getElementById('messagePageBtn');
        var btn2 = document.getElementById('messagePageBtnMobile');
        if (btn1) btn1.addEventListener('click', messageHandler);
        if (btn2) btn2.addEventListener('click', messageHandler);
    });




    // Make functions globally accessible
    window.openImagePreview = openImagePreview;
    window.toggleFollow = toggleFollow;
    window.sharePage = sharePage;
    window.showPageInfoModal = showPageInfoModal;
    window.showEditPageModal = showEditPageModal;
    window.viewAllFollowers = viewAllFollowers;
    window.toggleComments = toggleComments;
    window.submitComment = submitComment;
    window.deleteComment = deleteComment;
    window.reactToPost = reactToPost;
    window.confirmDeletePost = confirmDeletePost;
    window.deletePost = deletePost;
    window.sharePost = sharePost;
    window.removeMedia = removeMedia;
    window.showAlertModal = showAlertModal;
    window.loadPosts = loadPosts;

  // Override view tracking for page posts
  window.recordView = function(postId, postType) {
        if (postType !== 'page') return;  // ignore feed posts on this page
        fetch(`/api/pages/posts/${postId}/view/`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRFToken': getCsrfToken() }
        }).catch(function () { /* silent */ });
    };
})();
