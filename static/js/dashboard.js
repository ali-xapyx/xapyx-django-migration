// dashboard js

// ============================================================
// COSMIC STARS
// ============================================================
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

// ============================================================
// SHOUT MARQUEE — pause on hover
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    var track = document.getElementById('shoutMarqueeTrack');
    if (track) {
        track.addEventListener('mouseenter', function() {
            this.style.animationPlayState = 'paused';
        });
        track.addEventListener('mouseleave', function() {
            this.style.animationPlayState = 'running';
        });
    }
});

// ============================================================
// CSRF TOKEN — Django requires this on every POST
// ============================================================
function getCsrfToken() {
    var name = 'csrftoken';
    var cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        var cookies = document.cookie.split(';');
        for (var i = 0; i < cookies.length; i++) {
            var cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

// ============================================================
// GLOBAL VARIABLES
// ============================================================
let pageNum = 1;
let nextCursor = null;
let isLoading = false;
let hasMorePosts = true;
let totalPostsCount = 0;
let selectedFiles = [];
let editFiles = [];
let editingPostId = null;
let pollData = null;
let friends = (window.XPY_CONFIG && window.XPY_CONFIG.friends) ? window.XPY_CONFIG.friends : [];
let blockedUsers = (window.XPY_CONFIG && window.XPY_CONFIG.blockedUsers) ? window.XPY_CONFIG.blockedUsers : [];
let activeTextarea = null;
let videoObserver = null;
let postObserver = null;
let viewTimers = new Map();
const VIEW_DURATION = 4000;

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    if (document.body.dataset.page !== 'dashboard') return;

    console.log('🚀 XAPYX Dashboard - Cosmic Theme');

    if (document.getElementById('feedContainer')) {
        loadPosts(true);
    }
    setupEventListeners();
    setupCustomConfirms();
    setupDynamicTextarea();
    setupMentionHandlers();
    setupInfiniteScroll();
    setupVideoScrollTracking();
    setupPostViewTracking();

    var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function(el) { return new bootstrap.Tooltip(el); });

    if (typeof window.sidebarNotifications !== 'undefined') {
        window.sidebarNotifications.setupPolling();
    }

    document.querySelectorAll('video').forEach(function(video) {
        video.addEventListener('error', function() {
            var parent = this.parentElement;
            var fallback = document.createElement('img');
            fallback.src = '/assets/xapyx_logo.png';
            fallback.style.cssText = 'width:100%;max-height:400px;object-fit:contain;padding:10px;background:rgba(0,0,0,0.3);';
            fallback.alt = 'Video unavailable';
            this.style.display = 'none';
            parent.appendChild(fallback);
        });
    });

    var feedContainer = document.getElementById('feedContainer');
    if (feedContainer) {
        var observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType === 1) {
                        node.querySelectorAll('video').forEach(function(video) {
                            video.addEventListener('error', function() {
                                var parent = this.parentElement;
                                var fallback = document.createElement('img');
                                fallback.src = '/assets/xapyx_logo.png';
                                fallback.style.cssText = 'width:100%;max-height:400px;object-fit:contain;padding:10px;background:rgba(0,0,0,0.3);';
                                fallback.alt = 'Video unavailable';
                                this.style.display = 'none';
                                parent.appendChild(fallback);
                            });
                        });
                    }
                });
            });
        });
        observer.observe(feedContainer, { childList: true, subtree: true });
    }
});

// ============================================================
// VIDEO SCROLL TRACKING
// ============================================================
function setupVideoScrollTracking() {
    videoObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            var video = entry.target;
            if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
                // 50%+ visible → play (muted)
                var playPromise = video.play();
                if (playPromise && playPromise.catch) {
                    playPromise.catch(function() { /* autoplay blocked — silent */ });
                }
            } else {
                // Out of view → pause and reset
                video.pause();
            }
        });
    }, { threshold: [0, 0.5, 0.75] });
    document.querySelectorAll('video').forEach(function(video) {
        videoObserver.observe(video);
    });
}

// ============================================================
// POST VIEW TRACKING
// ============================================================
function setupPostViewTracking() {
    if (postObserver) postObserver.disconnect();
    postObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            var postElement = entry.target;
            var postId = postElement.dataset.postId;
            var postType = postElement.dataset.source || 'user';
            if (!postId) return;
            if (entry.isIntersecting) {
                if (!viewTimers.has(postId)) {
                    var timer = setTimeout(function() {
                        recordView(postId, postType);
                        viewTimers.delete(postId);
                    }, VIEW_DURATION);
                    viewTimers.set(postId, timer);
                }
            } else {
                if (viewTimers.has(postId)) {
                    clearTimeout(viewTimers.get(postId));
                    viewTimers.delete(postId);
                }
            }
        });
    }, { threshold: 0.3, rootMargin: '0px 0px -50px 0px' });
    document.querySelectorAll('.post-card-vertical').forEach(function(post) {
        postObserver.observe(post);
    });
}

async function recordView(postId, type) {
    try {
        var response = await fetch('/api/posts/view/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ post_id: postId, type: type })
        });
        var data = await response.json();
        if (data.success && data.new_view_count !== undefined) {
            var postEl = document.querySelector('.post-card-vertical[data-post-id="' + postId + '"]');
            if (postEl) {
                var viewEl = postEl.querySelector('.post-views-count');
                if (viewEl) viewEl.innerHTML = '<i class="bi bi-eye"></i> ' + data.new_view_count;
            }
        }
    } catch (error) { console.error('Error recording view:', error); }
}

// ============================================================
// DYNAMIC TEXTAREA
// ============================================================
function setupDynamicTextarea() {
    var textarea = document.getElementById('postContent');
    if (textarea) {
        textarea.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 150) + 'px';
            updateCharCount();
        });
    }
}

// ============================================================
// MENTION HANDLERS
// ============================================================
function setupMentionHandlers() {
    var textarea = document.getElementById('postContent');
    var editTextarea = document.getElementById('editPostContent');
    if (textarea) {
        textarea.addEventListener('input', function(e) { activeTextarea = this; handleMentionInput(e); });
        textarea.addEventListener('keydown', function(e) { activeTextarea = this; handleMentionKeydown(e); });
    }
    if (editTextarea) {
        editTextarea.addEventListener('input', function(e) { activeTextarea = this; handleMentionInput(e); });
        editTextarea.addEventListener('keydown', function(e) { activeTextarea = this; handleMentionKeydown(e); });
    }
    document.addEventListener('click', function(e) {
        var dropdown = document.getElementById('mentionsDropdown');
        if (dropdown && !dropdown.contains(e.target)) {
            dropdown.classList.remove('show');
        }
    });
}

function handleMentionInput(e) {
    if (!activeTextarea) return;
    var value = activeTextarea.value;
    var cursorPos = activeTextarea.selectionStart;
    var startPos = -1;
    for (var i = cursorPos - 1; i >= 0; i--) {
        if (value[i] === '@' && (i === 0 || value[i-1] === ' ' || value[i-1] === '\n')) {
            startPos = i;
            break;
        }
    }
    if (startPos !== -1) {
        window.isMentioning = true;
        window.currentMentionStart = startPos;
        var search = value.substring(startPos + 1, cursorPos).toLowerCase();
        showMentionsDropdown(search);
    } else {
        window.isMentioning = false;
        var dropdown = document.getElementById('mentionsDropdown');
        if (dropdown) dropdown.classList.remove('show');
    }
}

function handleCommentInputForPost(postId, event, type) {
    activeTextarea = event.target;
    handleMentionInput(event);
}

function handleMentionKeydown(e) {
    if (!window.isMentioning) return;
    var dropdown = document.getElementById('mentionsDropdown');
    if (!dropdown || !dropdown.classList.contains('show')) return;
    var items = dropdown.querySelectorAll('.mention-item');
    if (items.length === 0) return;

    var activeIndex = -1;
    items.forEach(function(item, index) {
        if (item.classList.contains('active')) activeIndex = index;
    });

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (activeIndex < items.length - 1) {
            if (activeIndex !== -1) items[activeIndex].classList.remove('active');
            items[activeIndex + 1].classList.add('active');
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (activeIndex > 0) {
            items[activeIndex].classList.remove('active');
            items[activeIndex - 1].classList.add('active');
        }
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex !== -1) selectMention(items[activeIndex]);
    } else if (e.key === 'Escape') {
        dropdown.classList.remove('show');
        window.isMentioning = false;
    }
}

function showMentionsDropdown(search) {
    var dropdown = document.getElementById('mentionsDropdown');
    if (!dropdown || !activeTextarea) return;
    var filtered = friends.filter(function(f) {
        return f.name.toLowerCase().includes(search) || f.username.toLowerCase().includes(search);
    });
    if (filtered.length === 0) {
        dropdown.classList.remove('show');
        return;
    }
    var rect = activeTextarea.getBoundingClientRect();
    var textBefore = activeTextarea.value.substring(0, activeTextarea.selectionStart);
    var lines = textBefore.split('\n');
    var currentLine = lines.length;
    var cursorX = activeTextarea.selectionStart - (lines.slice(0, -1).join('\n').length + (lines.length > 1 ? 1 : 0));
    dropdown.innerHTML = filtered.map(function(f, idx) {
        var av = f.picture || '/static/images/avatars/default.png';
        var avThumb = av;
        if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
            avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
        }
        return '<div class="mention-item ' + (idx === 0 ? 'active' : '') + '" data-user-id="' + f.id + '" data-username="' + f.username + '">' +
            '<img src="' + avThumb + '" data-full-src="' + av + '" width="40" height="40" onerror="this.onerror=null;this.src=\'' + av + '\'" class="mention-avatar">' +
            '<div><div class="mention-name">' + escapeHtml(f.name) + '</div><div class="mention-username">@' + escapeHtml(f.username) + '</div></div>' +
            '</div>';
    }).join('');
    dropdown.querySelectorAll('.mention-item').forEach(function(item) {
        item.addEventListener('click', function() { selectMention(item); });
    });
    dropdown.style.top = (rect.top + (currentLine * 24) + 5) + 'px';
    dropdown.style.left = (rect.left + (cursorX * 8)) + 'px';
    dropdown.classList.add('show');
}

function selectMention(item) {
    if (!activeTextarea) return;
    var username = item.dataset.username;
    var value = activeTextarea.value;
    var newValue = value.substring(0, window.currentMentionStart) + '@' + username + ' ' + value.substring(activeTextarea.selectionStart);
    activeTextarea.value = newValue;
    var newPos = window.currentMentionStart + username.length + 2;
    activeTextarea.setSelectionRange(newPos, newPos);
    if (activeTextarea.id === 'postContent') updateCharCount();
    if (activeTextarea.id === 'editPostContent') updateEditCharCount();
    var dropdown = document.getElementById('mentionsDropdown');
    dropdown.classList.remove('show');
    window.isMentioning = false;
    activeTextarea.dispatchEvent(new Event('input'));
}

// ============================================================
// INFINITE SCROLL
// ============================================================
function setupInfiniteScroll() {
    var sentinel = document.createElement('div');
    sentinel.id = 'scroll-sentinel';
    sentinel.style.cssText = 'height:10px;width:100%;visibility:hidden;';
    document.body.appendChild(sentinel);
    var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting && !isLoading && hasMorePosts) loadMorePosts();
        });
    }, { threshold: 0.1 });
    observer.observe(sentinel);
    var scrollTimeout;
    window.addEventListener('scroll', function() {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(function() {
            var scrollPos = window.innerHeight + window.scrollY;
            if (scrollPos >= document.body.offsetHeight - 500 && !isLoading && hasMorePosts) loadMorePosts();
        }, 150);
    });
    window.sentinelObserver = observer;
}

// ============================================================
// LOAD POSTS
// ============================================================
async function loadPosts(reset) {
    // Only run on pages that actually have a feed
    var container = document.getElementById('feedContainer');
    if (!container) return;

    if (isLoading) return;
    if (reset) {
        pageNum = 1;
        nextCursor = null;
        hasMorePosts = true;
        totalPostsCount = 0;
        container.innerHTML = '<div class="feed-skeleton"><div class="skeleton-post"><div class="skeleton-avatar"></div><div class="skeleton-content"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></div><div class="skeleton-post"><div class="skeleton-avatar"></div><div class="skeleton-content"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></div></div>';
    }
    if (!hasMorePosts && !reset) return;
    isLoading = true;
    try {
        var userUrl = '/api/posts/' + (nextCursor ? '?cursor=' + encodeURIComponent(nextCursor) : '');
        var userResp = await fetch(userUrl);
        var userData = await userResp.json();
        if (reset) container.innerHTML = '';
        var allPosts = [];
        if (userData.success && userData.posts) allPosts.push.apply(allPosts, userData.posts);
        allPosts.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });

        if (allPosts.length > 0) {
            allPosts.forEach(function(post) {
                container.appendChild(createPostElement(post));
            });
            nextCursor = userData.next_cursor || null;
            hasMorePosts = userData.has_more || false;
            if (allPosts.length > 0) pageNum++;
            var loading = document.getElementById('infiniteScrollLoading');
            if (loading) loading.remove();
            if (!hasMorePosts) {
                if (!document.getElementById('noMorePosts')) {
                    var endDiv = document.createElement('div');
                    endDiv.id = 'noMorePosts';
                    endDiv.className = 'text-center text-muted py-4';
                    endDiv.innerHTML = '<i class="bi bi-check-all"></i> You\'ve seen all posts';
                    container.appendChild(endDiv);
                }
            } else {
                var noMore = document.getElementById('noMorePosts');
                if (noMore) noMore.remove();
            }
        } else if (reset) {
            container.innerHTML = '<div class="empty-state"><i class="bi bi-newspaper"></i><h5>No posts yet</h5><p>Be the first to share something!</p></div>';
            hasMorePosts = false;
        }
    } catch (error) {
        console.error('Error loading posts:', error);
        if (reset && container) {
            container.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><h5>Error loading posts</h5><p>Failed to load posts. Please try again.</p><button class="btn btn-sm btn-primary mt-2" onclick="location.reload()">Try Again</button></div>';
        }
    } finally {
        isLoading = false;
    }
}

async function loadMorePosts() {
    if (isLoading || !hasMorePosts) return;
    var container = document.getElementById('feedContainer');

    var loading = document.createElement('div');
    loading.id = 'infiniteScrollLoading';
    loading.className = 'text-center py-3';
    loading.innerHTML = '<div class="spinner-border spinner-border-sm text-primary"></div> Loading more posts...';
    container.appendChild(loading);
    await loadPosts(false);
}

// ============================================================
// CUSTOM CONFIRM
// ============================================================
function setupCustomConfirms() {
    var overlay = document.getElementById('customConfirmOverlay');
    var box = document.getElementById('customConfirmBox');
    var cancel = document.getElementById('confirmCancel');
    var ok = document.getElementById('confirmOk');
    var delBox = document.getElementById('deleteConfirmBox');
    var delCancel = document.getElementById('deleteCancel');
    var delOk = document.getElementById('deleteOk');
    var resolveFn = null;

    window.showConfirm = function(title, message, options) {
        return new Promise(function(resolve) {
            resolveFn = resolve;
            document.getElementById('confirmTitle').textContent = title;
            document.getElementById('confirmMessage').textContent = message;
            if (options && options.okText) ok.textContent = options.okText;
            if (options && options.cancelText) cancel.textContent = options.cancelText;
            overlay.classList.add('show');
            box.classList.add('show');
        });
    };

    window.showDeleteConfirm = function() {
        return new Promise(function(resolve) {
            overlay.classList.add('show');
            delBox.classList.add('show');
            delOk.onclick = function() { hideAllConfirms(); resolve(true); };
            delCancel.onclick = function() { hideAllConfirms(); resolve(false); };
        });
    };

    if (cancel) cancel.onclick = function() { hideAllConfirms(); if (resolveFn) resolveFn(false); };
    if (ok) ok.onclick = function() { hideAllConfirms(); if (resolveFn) resolveFn(true); };
    if (overlay) overlay.onclick = function() { hideAllConfirms(); if (resolveFn) resolveFn(false); };
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { hideAllConfirms(); if (resolveFn) resolveFn(false); }
    });
}

function hideAllConfirms() {
    document.querySelectorAll('.custom-confirm-overlay').forEach(function(el) { el.classList.remove('show'); });
    document.querySelectorAll('.custom-confirm-box').forEach(function(el) { el.classList.remove('show'); });
}

// ============================================================
// ALERTS
// ============================================================
function showAlert(message, type, duration) {
    type = type || 'info';
    duration = duration || 5000;
    document.querySelectorAll('.custom-alert').forEach(function(a) { a.remove(); });
    var alertDiv = document.createElement('div');
    alertDiv.className = 'custom-alert ' + type;
    var icon = type === 'success' ? 'bi-check-circle-fill'
             : type === 'error' ? 'bi-x-circle-fill'
             : type === 'warning' ? 'bi-exclamation-triangle-fill'
             : 'bi-info-circle-fill';
    alertDiv.innerHTML = '<div class="d-flex align-items-center justify-content-between"><div class="d-flex align-items-center"><i class="bi ' + icon + ' alert-icon"></i><div>' + message + '</div></div><button type="button" class="btn-close" onclick="this.parentElement.parentElement.remove()"></button></div>';
    document.body.appendChild(alertDiv);
    if (duration > 0) setTimeout(function() { if (alertDiv.parentElement) alertDiv.remove(); }, duration);
}

// ============================================================
// POST FUNCTIONS
// ============================================================
function setupEventListeners() {
    var postSubmit = document.getElementById('postSubmit');
    if (postSubmit) postSubmit.addEventListener('click', createPost);
    var imageInput = document.getElementById('imageInput');
    if (imageInput) imageInput.addEventListener('change', handleMediaSelect);
    var videoInput = document.getElementById('videoInput');
    if (videoInput) videoInput.addEventListener('change', handleMediaSelect);
    var saveEditBtn = document.getElementById('saveEditBtn');
    if (saveEditBtn) saveEditBtn.addEventListener('click', savePostEdit);
}

function updateCharCount() {
    var ta = document.getElementById('postContent');
    var count = document.getElementById('charCount');
    if (!ta || !count) return;
    var remaining = 1000 - ta.value.length;
    count.textContent = remaining;
    count.className = remaining < 100 ? 'char-count text-danger' : 'char-count';
}

function updateEditCharCount() {
    var ta = document.getElementById('editPostContent');
    var count = document.getElementById('editCharCount');
    if (!ta || !count) return;
    var remaining = 1000 - ta.value.length;
    count.textContent = remaining;
    count.className = remaining < 100 ? 'char-count text-danger' : 'char-count';
}

function handleMediaSelect(e) {
    var files = Array.from(e.target.files);
    files.forEach(function(file) {
        var type = 'file';
        if (file.type.startsWith('image/')) type = 'image';
        else if (file.type.startsWith('video/')) type = 'video';
        if (['image', 'video'].includes(type)) {
            selectedFiles.push({ type: type, file: file, preview: URL.createObjectURL(file) });
        }
    });
    updateMediaPreview();
    e.target.value = '';
}

function handleEditMediaSelect(e, type) {
    var files = Array.from(e.target.files);
    files.forEach(function(file) {
        editFiles.push({ type: type, file: file, preview: URL.createObjectURL(file), isNew: true });
    });
    updateEditMediaPreview();
    e.target.value = '';
}

function updateMediaPreview() {
    var preview = document.getElementById('mediaPreview');
    if (!preview) return;
    preview.innerHTML = '';
    if (selectedFiles.length === 0) {
        preview.classList.add('d-none');
        return;
    }
    preview.classList.remove('d-none');
    selectedFiles.forEach(function(media, index) {
        var item = document.createElement('div');
        item.className = 'media-item';
        item.innerHTML = media.type === 'image'
            ? '<img src="' + media.preview + '"><button class="remove-media" data-index="' + index + '"><i class="bi bi-x"></i></button>'
            : '<video controls><source src="' + media.preview + '"></video><button class="remove-media" data-index="' + index + '"><i class="bi bi-x"></i></button>';
        preview.appendChild(item);
    });
    preview.querySelectorAll('.remove-media').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(this.dataset.index);
            removeMedia(idx);
        });
    });
}

function removeMedia(index) {
    if (index >= 0 && index < selectedFiles.length) {
        if (selectedFiles[index] && selectedFiles[index].preview) {
            URL.revokeObjectURL(selectedFiles[index].preview);
        }
        selectedFiles.splice(index, 1);
        updateMediaPreview();
    }
}

function updateEditMediaPreview() {
    var preview = document.getElementById('editMediaPreview');
    if (!preview) return;
    preview.innerHTML = '';
    if (editFiles.length === 0) return;
    editFiles.forEach(function(media, index) {
        var item = document.createElement('div');
        item.className = 'media-item';
        item.innerHTML = media.type === 'image'
            ? '<img src="' + (media.preview || media.url) + '"><button class="remove-media" data-edit-index="' + index + '"><i class="bi bi-x"></i></button>'
            : '<video controls><source src="' + (media.preview || media.url) + '"></video><button class="remove-media" data-edit-index="' + index + '"><i class="bi bi-x"></i></button>';
        preview.appendChild(item);
    });
    preview.querySelectorAll('.remove-media').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(this.dataset.editIndex);
            removeEditMedia(idx);
        });
    });
}

function removeEditMedia(index) {
    if (index >= 0 && index < editFiles.length) {
        if (editFiles[index] && editFiles[index].preview) {
            URL.revokeObjectURL(editFiles[index].preview);
        }
        editFiles.splice(index, 1);
        updateEditMediaPreview();
    }
}

function showPollModal() {
    new bootstrap.Modal(document.getElementById('pollModal')).show();
}

function addPollOption() {
    var container = document.getElementById('pollOptionsContainer');
    if (!container) return;
    var count = container.querySelectorAll('.input-group').length;
    if (count >= 6) return;
    var div = document.createElement('div');
    div.className = 'input-group mb-2';
    div.innerHTML = '<input type="text" class="form-control poll-option" placeholder="Option ' + (count + 1) + '"><button class="btn btn-outline-danger btn-sm" onclick="removePollOption(this)"><i class="bi bi-trash"></i></button>';
    container.appendChild(div);
}

function removePollOption(btn) {
    var container = document.getElementById('pollOptionsContainer');
    var options = container.querySelectorAll('.input-group');
    if (options.length > 2) {
        btn.closest('.input-group').remove();
        container.querySelectorAll('.input-group').forEach(function(opt, idx) {
            var input = opt.querySelector('.poll-option');
            if (input) input.placeholder = 'Option ' + (idx + 1);
        });
    }
}

function addPollToPost() {
    var question = document.getElementById('pollQuestion');
    var duration = document.getElementById('pollDuration');
    if (!question || !duration) return;
    var qText = question.value.trim();
    var opts = Array.from(document.querySelectorAll('.poll-option')).map(function(i) { return i.value.trim(); }).filter(function(o) { return o.length > 0; });
    if (!qText || opts.length < 2) {
        showAlert('Please enter a question and at least 2 options', 'warning');
        return;
    }
    pollData = { question: qText, options: opts, duration: duration.value };
    var preview = document.getElementById('pollPreview');
    preview.innerHTML = '<div class="poll-question"><strong>' + escapeHtml(qText) + '</strong></div><div class="poll-options mt-2">' + opts.map(function(o) { return '<div class="poll-option-item">' + escapeHtml(o) + '</div>'; }).join('') + '</div><button class="btn btn-sm btn-outline-danger mt-2" onclick="removePoll()"><i class="bi bi-trash"></i> Remove Poll</button>';
    preview.classList.remove('d-none');
    bootstrap.Modal.getInstance(document.getElementById('pollModal')).hide();
}

function removePoll() {
    pollData = null;
    var preview = document.getElementById('pollPreview');
    if (preview) preview.classList.add('d-none');
}

async function createPost() {
    var content = document.getElementById('postContent').value.trim();
    if (!content && selectedFiles.length === 0 && !pollData) {
        showAlert('Please add some content, media, or create a poll', 'warning');
        return;
    }
    var mentions = extractMentions(content);
    var btn = document.getElementById('postSubmit');
    var original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Posting...';

    // 1. Direct S3 Upload for selected files
    var uploadedKeys = [];
    if (selectedFiles.length > 0 && typeof uploadFileDirect === 'function') {
        try {
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Uploading...';
            for (var i = 0; i < selectedFiles.length; i++) {
                var m = selectedFiles[i];
                if (m.file) {
                    var upRes = await uploadFileDirect(m.file, 'post');
                    uploadedKeys.push(upRes.key);
                }
            }
        } catch (uploadErr) {
            console.error('Direct S3 upload failed:', uploadErr);
            showAlert('Failed to upload image to S3: ' + (uploadErr.message || uploadErr), 'error');
            btn.disabled = false;
            btn.innerHTML = original;
            return;
        }
    }

    try {
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Posting...';
        var response;
        if (uploadedKeys.length > 0) {
            // Send JSON with direct s3_keys
            var payload = {
                content: content,
                mentions: mentions,
                s3_keys: uploadedKeys
            };
            if (pollData) {
                payload.poll_question = pollData.question;
                payload.poll_options = pollData.options;
                payload.poll_duration = pollData.duration;
            }
            response = await fetch('/api/posts/create/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify(payload)
            });
        } else {
            // Fallback: multipart if no files or uploadFileDirect not available
            var formData = new FormData();
            formData.append('content', content);
            if (mentions.length > 0) formData.append('mentions', JSON.stringify(mentions));
            if (pollData) {
                formData.append('poll_question', pollData.question);
                formData.append('poll_options', JSON.stringify(pollData.options));
                formData.append('poll_duration', pollData.duration);
            }
            selectedFiles.forEach(function(m) { if (m.file) formData.append('media[]', m.file); });
            response = await fetch('/api/posts/create/', {
                method: 'POST',
                headers: { 'X-CSRFToken': getCsrfToken() },
                body: formData
            });
        }
        var data = await response.json();
        if (data.success) {
            document.getElementById('postContent').value = '';
            document.getElementById('postContent').style.height = 'auto';
            selectedFiles.forEach(function(f) { if (f.preview) URL.revokeObjectURL(f.preview); });
            selectedFiles = [];
            updateMediaPreview();
            pollData = null;
            var preview = document.getElementById('pollPreview');
            if (preview) { preview.classList.add('d-none'); preview.innerHTML = ''; }

            // Reset the poll modal so next open is clean
            var pollQ = document.getElementById('pollQuestion');
            if (pollQ) pollQ.value = '';
            var container = document.getElementById('pollOptionsContainer');
            if (container) {
                var groups = container.querySelectorAll('.input-group');
                groups.forEach(function (g, i) {
                    if (i >= 2) {
                        g.remove();
                    } else {
                        var inp = g.querySelector('.poll-option');
                        if (inp) {
                            inp.value = '';
                            inp.placeholder = 'Option ' + (i + 1);
                        }
                    }
                });
            }
            var pollDur = document.getElementById('pollDuration');
            if (pollDur) pollDur.value = '7';

            updateCharCount();
            
            if (data.post) addNewPostToFeed(data.post);
            else { pageNum = 1; nextCursor = null; hasMorePosts = true; await loadPosts(true); }
            showAlert('Post created successfully!', 'success');
        } else {
            showAlert(data.error || 'Failed to create post', 'error');
        }
    } catch (error) {
        showAlert('Error creating post. Please try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
    }
}

function addNewPostToFeed(postData) {
    var container = document.getElementById('feedContainer');
    if (!container) return;
    var spinner = container.querySelector('.loading-spinner');
    var empty = container.querySelector('.empty-state');
    if (spinner) spinner.remove();
    if (empty) empty.remove();
    var postEl = createPostElement(postData);
    if (container.firstChild) container.insertBefore(postEl, container.firstChild);
    else container.appendChild(postEl);
    if (postObserver) postObserver.observe(postEl);
    postEl.querySelectorAll('video').forEach(function(v) { if (videoObserver) videoObserver.observe(v); });
}

function extractMentions(text) {
    var regex = /@(\w+)/g;
    var mentions = [];
    var match;
    while ((match = regex.exec(text)) !== null) {
        var username = match[1];
        var friend = friends.find(function(f) { return f.username === username; });
        if (friend) {
            mentions.push({ user_id: friend.id, username: friend.username, position: match.index });
        }
    }
    return mentions;
}

function formatMentions(text) {
    if (!text) return '';
    var formatted = text;
    friends.forEach(function(f) {
        var regex = new RegExp('@' + f.username + '\\b', 'g');
        formatted = formatted.replace(regex, '<a href="/user/' + f.username + '/" class="mention-link" data-user-id="' + f.id + '">@' + f.username + '</a>');
    });
    return formatted;
}

function truncateContent(content, maxLines) {
    maxLines = maxLines || 4;
    if (!content) return '';
    var lines = content.split('\n');
    if (lines.length <= maxLines) return content;
    return lines.slice(0, maxLines).join('\n');
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function createPostElement(post) {
    var el = document.createElement('div');
    el.className = 'post-card-vertical';
    el.dataset.postId = post.id;
    el.dataset.source = post.source || 'user';

    var pollEnded = post.poll && !post.poll.ends_in;
    var pollHtml = '';
    if (post.poll) {
        pollHtml = '<div class="poll-container mt-3 ' + (pollEnded ? 'poll-ended' : '') + '"><div class="poll-question">' + escapeHtml(post.poll.question) + '</div><div class="poll-options">' +
            post.poll.options.map(function(opt, idx) {
                return '<div class="poll-option-item ' + (post.poll.user_vote === idx ? 'user-vote' : '') + '" ' + (pollEnded ? '' : 'onclick="votePoll(' + post.id + ', ' + idx + ')"') + '><div class="poll-option-text">' + escapeHtml(opt.text) + '</div><div class="poll-bar-container"><div class="poll-bar" style="width: ' + opt.percentage + '%"></div></div><div class="poll-stats"><span class="poll-percentage">' + opt.percentage + '%</span><span class="poll-count">(' + opt.votes + ')</span></div></div>';
            }).join('') +
            '</div><div class="poll-meta"><small class="text-muted">' + post.poll.total_votes + ' votes • ' + (pollEnded ? 'Poll ended' : 'Ends in ' + post.poll.ends_in) + '</small></div></div>';
    }

    var mediaHtml = '';
    if (post.media && post.media.length > 0) {
        mediaHtml = '<div class="post-media-slider" id="slider-' + post.id + '" data-media=\'' + JSON.stringify(post.media) + '\'><div class="slider-container">' +
            post.media.map(function(m, idx) {
                return '<div class="slider-item ' + (idx === 0 ? 'active' : '') + '" data-index="' + idx + '">' +
                    (m.type === 'image'
                        ? '<img src="' + (m.thumbnail_url || m.url) + '" width="800" height="600" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'' + m.url + '\'" onclick="openMediaViewerFromPost(' + post.id + ', ' + idx + ')">'
                        : '<video controls preload="metadata" muted playsinline loop autoplay onclick="toggleVideoSound(this, event)"><source src="' + m.url + '" type="' + (m.mime_type || 'video/mp4') + '"></video>') +
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
    var truncated = truncateContent(fullContent, 4);
    var formatted = formatMentions(truncated);
    var needsSeeMore = fullContent.split('\n').length > 4;

    var userId = window.XPY_CONFIG.userId;
    var postHeader = '';
    if (post.is_page_post && post.page_info) {
        postHeader = '<div class="post-header"><div class="post-author" onclick="window.location=\'/feed/\'"><img src="' + post.page_info.profile_image + '" data-full-src="' + post.page_info.profile_image + '" width="40" height="40" class="post-author-avatar"><div class="post-author-info"><h6>' + escapeHtml(post.page_info.title) + '</h6><span class="post-meta">Page · ' + post.time_ago + (post.is_edited ? '<span class="badge-edit">Edited</span>' : '') + '</span></div></div><div class="post-actions-dropdown"><button class="post-action-btn" onclick="togglePostActionsMenu(this, ' + post.id + ')"><i class="bi bi-three-dots-vertical"></i></button><ul class="dropdown-menu"><li><a class="dropdown-item" href="#" onclick="copyToClipboard(\'' + post.share_url + '\'); return false;"><i class="bi bi-link-45deg"></i> Copy Link</a></li></ul></div></div>';
        } else {
        var authorName = post.author ? post.author.name.split(' ')[0] : 'User';

        var metaLine = '@' + (post.author ? escapeHtml(post.author.username) : 'user')
            + ' · ' + post.time_ago
            + ' · <i class="bi bi-globe2" title="Public"></i>'
            + (post.is_edited ? ' · <span class="badge-edit">Edited</span>' : '');

        var av = (post.author && post.author.picture) ? post.author.picture : '/static/images/avatars/default.png';
        var avThumb = av;
        if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
            avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
        }

        postHeader = '<div class="post-header">'
            + (function() {
                var u = (post.author && post.author.username) ? post.author.username : '';
                return u
                    ? '<div class="post-author" onclick="window.location=\'/user/' 
                      + encodeURIComponent(u) + '/\'">'
                    : '<div class="post-author">';
            })()
            +   '<img src="' + avThumb + '" data-full-src="' + av + '" width="40" height="40" onerror="this.onerror=null;this.src=\'' + av + '\'" class="post-author-avatar">'
            +   '<div class="post-author-info">'
            +     '<h6 class="post-author-name">' + escapeHtml(authorName) + '</h6>'
            +     '<span class="post-meta">' + metaLine + '</span>'
            +   '</div>'
            + '</div>'
            + '<div class="post-actions-dropdown">'
            +   '<button class="post-action-btn" onclick="togglePostActionsMenu(this, ' + post.id + ')"><i class="bi bi-three-dots"></i></button>'
            +   '<ul class="dropdown-menu">'
            +     '<li><a class="dropdown-item" href="#" onclick="copyToClipboard(window.location.origin + \'/post/' + post.id + '/\'); return false;"><i class="bi bi-link-45deg"></i> Copy Link</a></li>'
            +     '<li><a class="dropdown-item" href="#" onclick="toggleSave(' + post.id + '); return false;"><i class="bi ' + (post.is_saved ? 'bi-bookmark-fill' : 'bi-bookmark') + '"></i> ' + (post.is_saved ? 'Saved' : 'Save Post') + '</a></li>'
            +     (post.author && post.author.id === userId ? '<li><a class="dropdown-item" href="#" onclick="editPostModal(' + post.id + '); return false;"><i class="bi bi-pencil"></i> Edit Post</a></li>' : '') + ((post.author && post.author.id === userId) || (window.XPY_CONFIG && window.XPY_CONFIG.isStaff) ? '<li><a class="dropdown-item text-danger" href="#" onclick="confirmDeletePost(' + post.id + '); return false;"><i class="bi bi-trash"></i> Delete Post</a></li>' : '')
            +   '</ul>'
            + '</div>'
            + '</div>';
    }

    var postFooter = '<div class="post-footer"><div class="post-actions-horizontal"><button class="post-action-btn-horizontal like-btn ' + (post.user_reaction === 'like' ? 'active' : '') + '" onclick="reactPost(' + post.id + ', \'like\', this, \'' + (post.source || 'user') + '\')"><i class="bi ' + (post.user_reaction === 'like' ? 'bi-hand-thumbs-up-fill' : 'bi-hand-thumbs-up') + '"></i><span class="action-count">' + (post.likes || 0) + '</span></button><button class="post-action-btn-horizontal dislike-btn ' + (post.user_reaction === 'dislike' ? 'active' : '') + '" onclick="reactPost(' + post.id + ', \'dislike\', this, \'' + (post.source || 'user') + '\')"><i class="bi ' + (post.user_reaction === 'dislike' ? 'bi-hand-thumbs-down-fill' : 'bi-hand-thumbs-down') + '"></i><span class="action-count">' + (post.dislikes || 0) + '</span></button><button class="post-action-btn-horizontal comment-btn" onclick="toggleComments(' + post.id + ', event, \'' + (post.source || 'user') + '\')"><i class="bi bi-chat"></i><span class="action-count">' + (post.comments_count || 0) + '</span></button><button class="post-action-btn-horizontal share-btn" onclick="sharePost(' + post.id + ', \'' + (post.source || 'user') + '\')"><i class="bi bi-share"></i><span class="action-count">' + (post.shares || 0) + '</span></button></div></div>';

    var commentsHtml = '<div class="comments-section-expandable" id="comments-' + post.id + '"><div class="comments-container" id="comments-container-' + post.id + '"><div class="no-comments">No comments yet. Be the first!</div></div><div class="comment-form-expandable"><input type="text" class="comment-input-expandable" placeholder="Write a comment..." id="comment-input-' + post.id + '" oninput="handleCommentInputForPost(' + post.id + ', event, \'' + (post.source || 'user') + '\')"><button class="comment-submit-btn" onclick="submitComment(' + post.id + ', \'' + (post.source || 'user') + '\')">Post</button></div></div>';

    var onDetailPage = document.body.dataset.page === 'view_post';
    var statsTop = '<div class="post-stats-top" style="gap:12px;"'
    + (onDetailPage ? ' style="cursor:default;gap:12px;"' : ' onclick="viewPost(' + post.id + ', \'' + (post.source || 'user') + '\')"')
    + '>'
    + (onDetailPage
        ? ''
        : '<span style="color:var(--xpy-primary);font-weight:600;font-size:0.8rem;margin-right:auto;">View post <i class="bi bi-arrow-right-short"></i></span>')
    + '<span class="post-views-count"><i class="bi bi-eye"></i> ' + (post.views || 0) + '</span>'
    + '</div>';

    el.innerHTML = postHeader + '<div class="post-body"><div class="post-content">' + formatted + '</div>' + (needsSeeMore ? '<div class="see-more-container"><a href="javascript:void(0)" class="see-more-link" onclick="viewPost(' + post.id + ', \'' + (post.source || 'user') + '\')">See more <i class="bi bi-arrow-right"></i></a></div>' : '') + mediaHtml + pollHtml + statsTop + '</div>' + postFooter + commentsHtml;
    setTimeout(function() {
        el.querySelectorAll('video').forEach(function(v) { if (videoObserver) videoObserver.observe(v); });
    }, 100);
    if (postObserver) postObserver.observe(el);
    return el;
}

function viewPost(postId, type) {
    if (type === 'page') window.location.href = '/feed/';
    else window.location.href = '/post/' + postId + '/';
}

function togglePostActionsMenu(btn, postId) {
    event.stopPropagation();
    var dropdown = btn.nextElementSibling;
    var isOpen = dropdown.classList.contains('show');
    document.querySelectorAll('.post-actions-dropdown .dropdown-menu.show').forEach(function(menu) {
        if (menu !== dropdown) {
            menu.classList.remove('show');
            var toggle = menu.parentElement.querySelector('.dropdown-toggle');
            if (toggle) toggle.classList.remove('active');
        }
    });
    dropdown.classList.toggle('show');
    btn.classList.toggle('active', !isOpen);
}

async function confirmDeletePost(postId) {
    var confirmed = await showDeleteConfirm();
    if (confirmed) deletePost(postId);
}

async function deletePost(postId) {
    try {
        var response = await fetch('/api/posts/delete/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ post_id: postId, type: 'user' })
        });
        var data = await response.json();
        if (data.success) {
            var el = document.querySelector('.post-card-vertical[data-post-id="' + postId + '"]');
            if (el) el.remove();
            showAlert('Post deleted successfully', 'success');
        } else {
            showAlert(data.error || 'Failed to delete post', 'error');
        }
    } catch (error) {
        showAlert('Failed to delete post', 'error');
    }
}

async function toggleSave(postId) {
    try {
        var response = await fetch('/api/posts/save/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ post_id: postId })
        });
        var data = await response.json();
        if (data.success) {
            showAlert(data.is_saved ? 'Post saved' : 'Post unsaved', 'success');
            var el = document.querySelector('.post-card-vertical[data-post-id="' + postId + '"]');
            if (el) {
                var saveBtn = el.querySelector('.dropdown-item[onclick*="toggleSave"]');
                if (saveBtn) {
                    var icon = saveBtn.querySelector('i');
                    if (data.is_saved) {
                        icon.className = 'bi bi-bookmark-fill';
                        saveBtn.lastChild.textContent = ' Saved';
                    } else {
                        icon.className = 'bi bi-bookmark';
                        saveBtn.lastChild.textContent = ' Save Post';
                    }
                }
            }
        } else {
            showAlert(data.error || 'Failed to save', 'error');
        }
    } catch (e) {
        showAlert('Failed to save', 'error');
    }
}

// Track in-flight reactions per post to guard against rapid double-clicks
var reactingPosts = {};

async function reactPost(postId, reaction, btn, type) {
    if (!postId || (reaction !== 'like' && reaction !== 'dislike')) return;

    // Prevent racing requests on the exact same post
    if (reactingPosts[postId]) return;

    var el = document.querySelector('[data-post-id="' + postId + '"]');
    if (!el) return;

    var likeBtn = el.querySelector('.like-btn');
    var dislikeBtn = el.querySelector('.dislike-btn');
    if (!likeBtn || !dislikeBtn) return;

    var likeCountEl = likeBtn.querySelector('.action-count');
    var dislikeCountEl = dislikeBtn.querySelector('.action-count');

    var currentLikes = parseInt(likeCountEl ? likeCountEl.textContent : '0', 10) || 0;
    var currentDislikes = parseInt(dislikeCountEl ? dislikeCountEl.textContent : '0', 10) || 0;

    var wasLiked = likeBtn.classList.contains('active');
    var wasDisliked = dislikeBtn.classList.contains('active');

    // Snapshot pre-click state for reconciliation or error rollback
    var prevState = {
        wasLiked: wasLiked,
        wasDisliked: wasDisliked,
        likes: currentLikes,
        dislikes: currentDislikes
    };

    // Calculate optimistic state
    var optLiked = false;
    var optDisliked = false;
    var optLikes = currentLikes;
    var optDislikes = currentDislikes;

    if (reaction === 'like') {
        if (wasLiked) {
            // Toggle off (unlike)
            optLiked = false;
            optDisliked = false;
            optLikes = Math.max(0, currentLikes - 1);
            optDislikes = currentDislikes;
        } else if (wasDisliked) {
            // Switch from dislike to like
            optLiked = true;
            optDisliked = false;
            optLikes = currentLikes + 1;
            optDislikes = Math.max(0, currentDislikes - 1);
        } else {
            // Fresh like
            optLiked = true;
            optDisliked = false;
            optLikes = currentLikes + 1;
            optDislikes = currentDislikes;
        }
    } else if (reaction === 'dislike') {
        if (wasDisliked) {
            // Toggle off (undislike)
            optLiked = false;
            optDisliked = false;
            optLikes = currentLikes;
            optDislikes = Math.max(0, currentDislikes - 1);
        } else if (wasLiked) {
            // Switch from like to dislike
            optLiked = false;
            optDisliked = true;
            optLikes = Math.max(0, currentLikes - 1);
            optDislikes = currentDislikes + 1;
        } else {
            // Fresh dislike
            optLiked = false;
            optDisliked = true;
            optLikes = currentLikes;
            optDislikes = currentDislikes + 1;
        }
    }

    function renderReactionState(isLiked, isDisliked, countLikes, countDislikes) {
        if (likeCountEl) likeCountEl.textContent = countLikes;
        if (dislikeCountEl) dislikeCountEl.textContent = countDislikes;

        if (isLiked) {
            likeBtn.classList.add('active');
            likeBtn.setAttribute('aria-pressed', 'true');
            var iconL = likeBtn.querySelector('i');
            if (iconL) iconL.className = 'bi bi-hand-thumbs-up-fill';
        } else {
            likeBtn.classList.remove('active');
            likeBtn.setAttribute('aria-pressed', 'false');
            var iconL = likeBtn.querySelector('i');
            if (iconL) iconL.className = 'bi bi-hand-thumbs-up';
        }

        if (isDisliked) {
            dislikeBtn.classList.add('active');
            dislikeBtn.setAttribute('aria-pressed', 'true');
            var iconD = dislikeBtn.querySelector('i');
            if (iconD) iconD.className = 'bi bi-hand-thumbs-down-fill';
        } else {
            dislikeBtn.classList.remove('active');
            dislikeBtn.setAttribute('aria-pressed', 'false');
            var iconD = dislikeBtn.querySelector('i');
            if (iconD) iconD.className = 'bi bi-hand-thumbs-down';
        }
    }

    // [INSTANT UI UPDATE] Apply optimistic state immediately
    renderReactionState(optLiked, optDisliked, optLikes, optDislikes);

    reactingPosts[postId] = true;

    try {
        var response = await fetch('/api/posts/react/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ post_id: postId, reaction: reaction })
        });

        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }

        var data = await response.json();
        if (data.success) {
            // Reconcile with authoritative server counts
            var finalLiked = data.user_reaction === 'like';
            var finalDisliked = data.user_reaction === 'dislike';
            renderReactionState(finalLiked, finalDisliked, data.likes, data.dislikes);
        } else {
            // Revert to snapshot on API failure
            renderReactionState(prevState.wasLiked, prevState.wasDisliked, prevState.likes, prevState.dislikes);
            showAlert(data.error || 'Failed to react to post', 'error');
        }
    } catch (error) {
        // Revert to snapshot on network failure / offline
        renderReactionState(prevState.wasLiked, prevState.wasDisliked, prevState.likes, prevState.dislikes);
        showAlert('Network error: reaction not saved', 'error');
    } finally {
        delete reactingPosts[postId];
    }
}

async function toggleComments(postId, event, type) {
    if (event) event.stopPropagation();
    var section = document.getElementById('comments-' + postId);
    if (!section) return;
    var isExpanded = section.classList.contains('expanded');
    document.querySelectorAll('.comments-section-expandable.expanded').forEach(function(s) {
        if (s.id !== 'comments-' + postId) s.classList.remove('expanded');
    });
    section.classList.toggle('expanded');
    if (!isExpanded) {
        await loadComments(postId, 1, type);
        var input = document.getElementById('comment-input-' + postId);
        if (input) input.focus();
    }
}

async function loadComments(postId, page, type) {
    var container = document.getElementById('comments-container-' + postId);
    if (!container) return;
    container.innerHTML = '<div class="text-center py-2"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
    try {
        var response = await fetch('/api/posts/comments/?post_id=' + postId + '&page=' + page + '&limit=10&type=' + type);
        var data = await response.json();
        if (data.success) {
            container.innerHTML = '';
            if (data.comments.length === 0) {
                container.innerHTML = '<div class="no-comments">No comments yet. Be the first!</div>';
                return;
            }
            data.comments.reverse().forEach(function(c) { container.appendChild(createCommentElement(c, type)); });
            if (data.total_comments > data.comments.length) {
                var btn = document.createElement('a');
                btn.href = 'javascript:void(0)';
                btn.className = 'btn btn-sm btn-outline-primary w-100 mt-2';
                btn.innerHTML = '<i class="bi bi-arrow-down"></i> Load more comments';
                btn.onclick = function() { loadComments(postId, page + 1, type); };
                container.appendChild(btn);
            }
        } else {
            container.innerHTML = '<div class="error-message">Error loading comments</div>';
        }
    } catch (error) {
        container.innerHTML = '<div class="error-message">Failed to load comments</div>';
    }
}

function createCommentElement(comment, type) {
    var el = document.createElement('div');
    el.className = 'comment-item';
    el.dataset.commentId = comment.id;
    var userId = window.XPY_CONFIG.userId;
    var isOwner = (comment.author.id === userId) || Boolean(window.XPY_CONFIG && window.XPY_CONFIG.isStaff);
    var av = (comment.author && comment.author.picture) ? comment.author.picture : '/static/images/avatars/default.png';
    var avThumb = av;
    if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
        avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
    }
    el.innerHTML = '<img src="' + avThumb + '" data-full-src="' + av + '" width="40" height="40" onerror="this.onerror=null;this.src=\'' + av + '\'" class="comment-avatar"><div class="comment-content"><div class="comment-header"><strong>' + escapeHtml(comment.author.name.split(' ')[0]) + '</strong><span class="comment-meta">' + comment.time_ago + '</span>' + (isOwner ? '<button class="comment-delete-btn" onclick="deleteComment(' + comment.id + ', null, \'' + type + '\')"><i class="bi bi-trash"></i></button>' : '') + '</div><div class="comment-text">' + formatMentions(comment.content) + '</div></div>';
    return el;
    
}

async function submitComment(postId, type) {
    var input = document.getElementById('comment-input-' + postId);
    if (!input) return;
    var btn = input.nextElementSibling;
    var content = input.value.trim();
    if (!content) {
        showAlert('Please enter a comment', 'warning');
        input.focus();
        return;
    }
    var mentions = extractMentions(content);
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    try {
        var response = await fetch('/api/posts/comments/add/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
            body: JSON.stringify({ post_id: postId, content: content, mentions: mentions, type: type })
        });
        var data = await response.json();
        if (data.success) {
            input.value = '';
            var container = document.getElementById('comments-container-' + postId);
            if (container) {
                var noComments = container.querySelector('.no-comments');
                if (noComments) noComments.remove();
                container.appendChild(createCommentElement(data.comment, type));
            }
            var el = document.querySelector('.post-card-vertical[data-post-id="' + postId + '"]');
            if (el) {
                var count = el.querySelector('.comment-btn .action-count');
                if (count) count.textContent = parseInt(count.textContent) + 1;
            }
            showAlert('Comment posted successfully!', 'success');
        } else {
            showAlert(data.error || 'Failed to post comment', 'error');
        }
    } catch (error) {
        showAlert('Failed to post comment', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Post';
        input.focus();
    }
}

async function deleteComment(commentId, postId, type) {
    if (!confirm('Delete this comment?')) return;
    try {
        var response = await fetch('/api/posts/comments/delete/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
            body: JSON.stringify({ comment_id: commentId, post_id: postId, type: type })
        });
        var data = await response.json();
        if (data.success) {
            var el = document.querySelector('.comment-item[data-comment-id="' + commentId + '"]');
            if (el) el.remove();
            if (postId) {
                var postEl = document.querySelector('.post-card-vertical[data-post-id="' + postId + '"]');
                if (postEl) {
                    var count = postEl.querySelector('.comment-btn .action-count');
                    if (count) count.textContent = Math.max(0, parseInt(count.textContent) - 1);
                }
            }
            showAlert('Comment deleted', 'success');
        } else {
            showAlert(data.error || 'Failed to delete comment', 'error');
        }
    } catch (error) {
        showAlert('Failed to delete comment', 'error');
    }
}

async function editPostModal(postId) {
    editingPostId = postId;
    editFiles = [];
    try {
        var response = await fetch('/api/posts/get/?post_id=' + postId);
        var data = await response.json();
        if (data.success && data.post) {
            var content = data.post.content.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
            var editContent = document.getElementById('editPostContent');
            if (editContent) editContent.value = content;
            updateEditCharCount();
            if (data.post.media) {
                data.post.media.forEach(function(m) {
                    editFiles.push({ type: m.type, url: m.url, preview: m.url, existing: true });
                });
            }
            updateEditMediaPreview();
            new bootstrap.Modal(document.getElementById('editPostModal')).show();
        } else {
            showAlert(data.error || 'Failed to load post', 'error');
        }
    } catch (error) {
        showAlert('Failed to load post data', 'error');
    }
}

async function savePostEdit() {
    if (!editingPostId) return;
    var content = document.getElementById('editPostContent').value.trim();
    if (!content && editFiles.length === 0) {
        showAlert('Post content cannot be empty', 'warning');
        return;
    }
    var mentions = extractMentions(content);
    var btn = document.getElementById('saveEditBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...';
    var formData = new FormData();
    formData.append('post_id', editingPostId);
    formData.append('content', content);
    formData.append('type', 'user');
    if (mentions.length > 0) formData.append('mentions', JSON.stringify(mentions));
    var existing = editFiles.filter(function(m) { return m.existing; }).map(function(m) { return m.url; });
    if (existing.length > 0) formData.append('existing_media', existing.join(','));
    editFiles.filter(function(m) { return m.isNew && m.file; }).forEach(function(m) { formData.append('new_media[]', m.file); });
    try {
        var response = await fetch('/api/posts/edit/', {
            method: 'POST',
            headers: { 'X-CSRFToken': getCsrfToken() },
            body: formData
        });
        var data = await response.json();
        if (data.success) {
            var old = document.querySelector('.post-card-vertical[data-post-id="' + editingPostId + '"]');
            if (old) old.replaceWith(createPostElement(data.post));
            showAlert('Post updated successfully!', 'success');
            bootstrap.Modal.getInstance(document.getElementById('editPostModal')).hide();
            editFiles = [];
            editingPostId = null;
        } else {
            showAlert(data.error || 'Failed to update post', 'error');
        }
    } catch (error) {
        showAlert('Network error. Please try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Save Changes';
    }
}

async function votePoll(postId, optionIndex) {
    try {
        var response = await fetch('/api/posts/vote/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
            body: JSON.stringify({ post_id: postId, option_index: optionIndex })
        });
        var data = await response.json();
        if (data.success) {
            var el = document.querySelector('.post-card-vertical[data-post-id="' + postId + '"]');
            if (el && data.poll) {
                var container = el.querySelector('.poll-container');
                if (container) {
                    var pollEnded = !data.poll.ends_in;
                    container.className = 'poll-container mt-3 ' + (pollEnded ? 'poll-ended' : '');
                    container.innerHTML = '<div class="poll-question">' + escapeHtml(data.poll.question) + '</div><div class="poll-options">' +
                        data.poll.options.map(function(opt, idx) {
                            return '<div class="poll-option-item ' + (data.poll.user_vote === idx ? 'user-vote' : '') + '" ' + (pollEnded ? '' : 'onclick="votePoll(' + postId + ', ' + idx + ')"') + '><div class="poll-option-text">' + escapeHtml(opt.text) + '</div><div class="poll-bar-container"><div class="poll-bar" style="width: ' + opt.percentage + '%"></div></div><div class="poll-stats"><span class="poll-percentage">' + opt.percentage + '%</span><span class="poll-count">(' + opt.votes + ')</span></div></div>';
                        }).join('') +
                        '</div><div class="poll-meta"><small class="text-muted">' + data.poll.total_votes + ' votes • ' + (pollEnded ? 'Poll ended' : 'Ends in ' + data.poll.ends_in) + '</small></div>';
                }
            }
            showAlert('Vote recorded!', 'success');
        } else {
            showAlert(data.error || 'Failed to vote', 'error');
        }
    } catch (error) {
        showAlert('Failed to vote', 'error');
    }
}

// toggle video sound

function toggleVideoSound(video, event) {
    // Only toggle if user clicked the video surface, not the controls
    if (event && event.target !== video) return;
    video.muted = !video.muted;
    if (!video.muted) {
        // Give visual feedback via a brief scale pulse
        video.style.transition = 'transform 0.15s ease';
        video.style.transform = 'scale(1.02)';
        setTimeout(function() { video.style.transform = ''; }, 150);
    }
}

function sharePost(postId, type) {
    var url = type === 'page'
        ? window.location.origin + '/feed/'
        : window.location.origin + '/post/' + postId + '/';
    if (navigator.share) navigator.share({ title: 'Check out this post on XAPYX', url: url }).catch(function() { copyToClipboard(url); });
    else copyToClipboard(url);
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(function() { showAlert('Link copied to clipboard!', 'success'); });
}

function openMediaViewerFromPost(postId, index) {
    var slider = document.querySelector('#slider-' + postId);
    if (!slider) return;
    var mediaData = JSON.parse(slider.dataset.media);
    var inner = document.getElementById('mediaCarouselInner');
    var indicators = document.getElementById('mediaIndicators');
    if (!inner || !indicators) return;
    inner.innerHTML = '';
    indicators.innerHTML = '';
    mediaData.forEach(function(media, idx) {
        var item = document.createElement('div');
        item.className = 'carousel-item ' + (idx === index ? 'active' : '');
        item.innerHTML = media.type === 'image'
            ? '<div class="d-flex align-items-center justify-content-center" style="height:70vh;"><img src="' + media.url + '" style="max-height:70vh;object-fit:contain;"></div>'
            : '<div class="d-flex align-items-center justify-content-center" style="height:70vh;"><video controls style="max-width:100%;max-height:70vh;"><source src="' + media.url + '"></video></div>';
        inner.appendChild(item);
        var ind = document.createElement('button');
        ind.type = 'button';
        ind.dataset.bsTarget = '#mediaCarousel';
        ind.dataset.bsSlideTo = idx;
        ind.className = idx === index ? 'active' : '';
        indicators.appendChild(ind);
    });
    var modal = new bootstrap.Modal(document.getElementById('mediaViewerModal'));
    modal.show();
    window.history.pushState({ modalOpen: true }, '', window.location.href);
}

window.addEventListener('popstate', function(event) {
    var el = document.getElementById('mediaViewerModal');
    if (el && el.classList.contains('show')) {
        var modal = bootstrap.Modal.getInstance(el);
        if (modal) modal.hide();
        history.pushState({ modalOpen: true }, '', window.location.href);
    }
});

var mediaViewerModal = document.getElementById('mediaViewerModal');
if (mediaViewerModal) {
    mediaViewerModal.addEventListener('hidden.bs.modal', function() {
        if (window.history.state && window.history.state.modalOpen) {
            history.replaceState(null, '', window.location.href);
        }
    });
}

function slideMedia(postId, direction) {
    var slider = document.querySelector('#slider-' + postId);
    if (!slider) return;
    var items = slider.querySelectorAll('.slider-item');
    var indicators = slider.querySelectorAll('.indicator');
    var active = Array.from(items).findIndex(function(item) { return item.classList.contains('active'); });
    items[active].classList.remove('active');
    indicators[active].classList.remove('active');
    var newIndex = active + direction;
    if (newIndex < 0) newIndex = items.length - 1;
    if (newIndex >= items.length) newIndex = 0;
    items[newIndex].classList.add('active');
    indicators[newIndex].classList.add('active');
}

function goToSlide(postId, index) {
    var slider = document.querySelector('#slider-' + postId);
    if (!slider) return;
    slider.querySelectorAll('.slider-item, .indicator').forEach(function(el) { el.classList.remove('active'); });
    var items = slider.querySelectorAll('.slider-item');
    var indicators = slider.querySelectorAll('.indicator');
    if (items[index]) items[index].classList.add('active');
    if (indicators[index]) indicators[index].classList.add('active');
}

// ============================================================
// CLEANUP
// ============================================================
window.addEventListener('beforeunload', function() {
    if (window.sentinelObserver) window.sentinelObserver.disconnect();
    if (videoObserver) videoObserver.disconnect();
    if (postObserver) postObserver.disconnect();
    viewTimers.forEach(function(t) { clearTimeout(t); });
    viewTimers.clear();
});

// ============================================================
// AMBIENT MEDIA BACKGROUND
// ============================================================
function applyAmbientBackground(media) {
    var sliderItem = media.closest('.slider-item, .xapyx-slider-item');
    if (!sliderItem) return;
    var src = '';
    if (media.tagName === 'IMG') {
        src = media.currentSrc || media.src;
    } else if (media.tagName === 'VIDEO') {
        if (media.poster) {
            src = media.poster;
        } else {
            sliderItem.style.setProperty('--ambient-image', 'none');
            return;
        }
    }
    if (src) sliderItem.style.setProperty('--ambient-image', 'url("' + src + '")');
}

function applyAllAmbientBackgrounds() {
    document.querySelectorAll('.post-media-slider img, .post-media-slider video').forEach(function(media) {
        if (media.tagName === 'IMG') {
            if (media.complete && media.currentSrc) {
                applyAmbientBackground(media);
            } else {
                media.addEventListener('load', function() { applyAmbientBackground(media); }, { once: true });
            }
        } else if (media.tagName === 'VIDEO') {
            if (media.readyState >= 1) {
                applyAmbientBackground(media);
            } else {
                media.addEventListener('loadedmetadata', function() { applyAmbientBackground(media); }, { once: true });
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', function() {
    setTimeout(applyAllAmbientBackgrounds, 600);
    setTimeout(applyAllAmbientBackgrounds, 1800);
    var feed = document.getElementById('feedContainer');
    if (feed) {
        var observer = new MutationObserver(function() {
            applyAllAmbientBackgrounds();
        });
        observer.observe(feed, { childList: true, subtree: true });
    }
    /* Global: swap broken avatars for the default */
    document.addEventListener('error', function (e) {
        var t = e.target;
        if (t.tagName === 'IMG' && !t.dataset.fallbackTried) {
            t.dataset.fallbackTried = '1';
            t.src = '/static/images/avatars/default.png';
        }
    }, true);
});