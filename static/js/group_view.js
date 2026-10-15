/* ============================================================
   GROUP DETAIL PAGE
   ============================================================ */
(function () {
  'use strict';

  const CFG = window.GV_CONFIG || {};
  const USER_ID = CFG.userId;
  const GROUP_ID = CFG.groupId;
  const IS_ADMIN = !!CFG.isAdmin;
  const CAN_POST = !!CFG.canPost;

  let page = 1;
  let isLoading = false;
  let hasMore = true;
  let totalPosts = 0;
  let selectedMedia = [];
  let deletePostId = null;

  function getCsrfToken() {
    const m = document.cookie.match(/csrftoken=([^;]+)/);
    return m ? m[1] : '';
  }

  function escapeHtml(t) {
    if (t == null) return '';
    const d = document.createElement('div');
    d.textContent = String(t);
    return d.innerHTML;
  }

  function formatFileSize(b) {
    if (!b) return '0 B';
    const k = 1024, u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + u[i];
  }

  function toast(msg, type) {
    type = type || 'info';
    document.querySelectorAll('.custom-alert').forEach(a => a.remove());
    const div = document.createElement('div');
    div.className = 'custom-alert ' + type;
    const icon = type === 'success' ? 'bi-check-circle-fill'
              : type === 'error'   ? 'bi-x-circle-fill'
              : type === 'warning' ? 'bi-exclamation-triangle-fill'
              :                      'bi-info-circle-fill';
    div.innerHTML = '<div class="d-flex align-items-center justify-content-between">'
      + '<div class="d-flex align-items-center"><i class="bi ' + icon + ' alert-icon"></i><div>' + msg + '</div></div>'
      + '<button type="button" class="btn-close" onclick="this.parentElement.parentElement.remove()"></button>'
      + '</div>';
    document.body.appendChild(div);
    setTimeout(() => { if (div.parentElement) div.remove(); }, 4000);
  }

  function confirmDialog(title, message, okText) {
    return new Promise(resolve => {
      const overlay = document.getElementById('customConfirmOverlay');
      const box = document.getElementById('customConfirmBox');
      document.getElementById('confirmTitle').textContent = title;
      document.getElementById('confirmMessage').textContent = message;
      const okBtn = document.getElementById('confirmOk');
      const cancelBtn = document.getElementById('confirmCancel');
      if (okText) okBtn.textContent = okText;
      overlay.classList.add('show');
      box.classList.add('show');
      const cleanup = () => {
        overlay.classList.remove('show');
        box.classList.remove('show');
        okBtn.onclick = null; cancelBtn.onclick = null; overlay.onclick = null;
      };
      okBtn.onclick = () => { cleanup(); resolve(true); };
      cancelBtn.onclick = () => { cleanup(); resolve(false); };
      overlay.onclick = () => { cleanup(); resolve(false); };
    });
  }

  async function postForm(url, fd) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'X-CSRFToken': getCsrfToken() },
      body: fd,
    });
    return r.json();
  }

  async function postJSON(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken(),
      },
      body: JSON.stringify(body || {}),
    });
    return r.json();
  }

  // ============================================================
  // POST RENDERING
  // ============================================================
  function renderMedia(post) {
    if (!post.media || !post.media.length) return '';
    const mid = 'gvSlider' + post.id;
    const items = post.media.map((m, i) => {
      const active = i === 0 ? ' active' : '';
      if (m.type === 'image') {
        return '<div class="slider-item' + active + '" data-index="' + i + '">' +
          '<img class="post-media-blur-bg" src="' + (m.thumbnail_url || m.url) + '" alt="" aria-hidden="true">' +
          '<img src="' + (m.thumbnail_url || m.url) + '" class="post-image slider-image" width="800" height="600" loading="lazy" decoding="async" onload="if(typeof applyAmbientBackground===\'function\')applyAmbientBackground(this);if(this.naturalWidth>=this.naturalHeight)this.classList.add(\'landscape\')" onerror="this.onerror=null;this.src=\'' + m.url + '\'" onclick="openMediaLightbox(\'' + (m.url || '').replace(/'/g, "\\'") + '\')">' +
          '</div>';
      }
      return '<div class="slider-item has-video' + active + '" data-index="' + i + '">' +
        '<video controls preload="metadata" muted playsinline loop onclick="gvToggleVideoSound(this, event)">' +
        '<source src="' + m.url + '" type="' + (m.mime_type || 'video/mp4') + '">' +
        '</video></div>';
    }).join('');

    const nav = post.media.length > 1
      ? '<button class="slider-prev" type="button" onclick="gvSlideMedia(' + post.id + ', -1)"><i class="bi bi-chevron-left"></i></button>' +
        '<button class="slider-next" type="button" onclick="gvSlideMedia(' + post.id + ', 1)"><i class="bi bi-chevron-right"></i></button>' +
        '<div class="slider-indicators">' +
        post.media.map((_, i) => '<span class="indicator' + (i === 0 ? ' active' : '') +
          '" onclick="gvGoToSlide(' + post.id + ', ' + i + ')"></span>').join('') +
        '</div>'
      : '';

    return '<div class="post-media-slider" id="' + mid + '">' +
      '<div class="slider-container">' + items + '</div>' + nav + '</div>';
  }

  function renderPost(post) {
    const isMine = post.author.id === USER_ID;
    const canDelete = isMine || IS_ADMIN || Boolean(window.XPY_CONFIG && window.XPY_CONFIG.isStaff);
    const hasLiked = post.user_reaction === 'like';
    const hasDisliked = post.user_reaction === 'dislike';

    const authorUsername = (post.author && post.author.username) 
        ? post.author.username : '';
    const authorOnclick = authorUsername
        ? "window.location.href='/user/" + encodeURIComponent(authorUsername) + "/'"
        : "return false";

    var av = (post.author && post.author.picture) ? post.author.picture : '/static/images/avatars/default.png';
    var avThumb = av;
    if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
      avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
    }

    var isPending = post.status === 'pending';
    var pendingBadge = isPending ? ' · <span class="badge bg-warning text-dark badge-pending">Pending Approval</span>' : '';
    var adminApproveHtml = (isPending && IS_ADMIN)
      ? '<div class="post-pending-actions mt-2 mb-2 d-flex gap-2">' +
          '<button class="btn btn-sm btn-success" type="button" onclick="gvApprovePost(' + post.id + ')"><i class="bi bi-check-lg"></i> Approve</button>' +
          '<button class="btn btn-sm btn-outline-danger" type="button" onclick="gvRejectPost(' + post.id + ')"><i class="bi bi-x-lg"></i> Reject</button>' +
        '</div>'
      : '';

    return '' +
      '<div class="post-card-vertical" data-post-id="' + post.id + '">' +
        '<div class="post-header">' +
          '<div class="post-author" onclick="' + authorOnclick + '">' +
            '<img src="' + avThumb + '" data-full-src="' + av + '" width="40" height="40" class="post-author-avatar" alt="" onerror="this.onerror=null;this.src=\'' + av + '\'">' +
            '<div class="post-author-info">' +
              '<h6>' + escapeHtml(post.author.name) + '</h6>' +
              '<span class="post-meta">@' + escapeHtml(post.author.username) + ' · ' + escapeHtml(post.time_ago) +
                (post.is_edited ? ' · <span class="badge-edit">Edited</span>' : '') +
                pendingBadge +
              '</span>' +
            '</div>' +
          '</div>' +
          '<div class="post-actions-dropdown">' +
            '<button class="post-action-btn" type="button" onclick="gvToggleActionsMenu(this)"><i class="bi bi-three-dots"></i></button>' +
            '<ul class="dropdown-menu">' +
              '<li><a class="dropdown-item" href="#" onclick="gvCopyLink(' + post.id + '); return false;"><i class="bi bi-link-45deg"></i> Copy Link</a></li>' +
                (isMine ? '<li><a class="dropdown-item" href="#" onclick="gvOpenEditPost(' + post.id + '); return false;"><i class="bi bi-pencil"></i> Edit Post</a></li>' : '') +
                (canDelete ? '<li><a class="dropdown-item text-danger" href="#" onclick="gvConfirmDelete(' + post.id + '); return false;"><i class="bi bi-trash"></i> Delete Post</a></li>' : '') +   
            '</ul>' +
          '</div>' +
        '</div>' +
        '<div class="post-body">' +
          (post.content ? '<div class="post-content">' + escapeHtml(post.content).replace(/\n/g, '<br>') + '</div>' : '') +
          adminApproveHtml +
          renderMedia(post) +
          '<div class="post-stats-top">' +
            '<span class="post-views-count"><i class="bi bi-eye"></i> ' + (post.views || 0) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="post-footer">' +
          '<div class="post-actions-horizontal">' +
            '<button class="post-action-btn-horizontal like-btn' + (hasLiked ? ' active' : '') + '" type="button" onclick="gvReact(' + post.id + ', \'like\')">' +
              '<i class="bi bi-hand-thumbs-up' + (hasLiked ? '-fill' : '') + '"></i>' +
              '<span class="action-count">' + post.likes + '</span>' +
            '</button>' +
            '<button class="post-action-btn-horizontal dislike-btn' + (hasDisliked ? ' active' : '') + '" type="button" onclick="gvReact(' + post.id + ', \'dislike\')">' +
              '<i class="bi bi-hand-thumbs-down' + (hasDisliked ? '-fill' : '') + '"></i>' +
              '<span class="action-count">' + post.dislikes + '</span>' +
            '</button>' +
            '<button class="post-action-btn-horizontal comment-btn" type="button" onclick="gvToggleComments(' + post.id + ', event)">' +
              '<i class="bi bi-chat"></i>' +
              '<span class="action-count">' + post.comments_count + '</span>' +
            '</button>' +
          '</div>' +
          '<div class="comments-section-expandable" id="gvComments-' + post.id + '">' +
            '<div class="comments-container" id="gvCommentsContainer-' + post.id + '"></div>' +
            '<div class="comment-form-expandable">' +
              '<input type="text" class="comment-input-expandable" placeholder="Write a comment..." maxlength="500" id="gvCommentInput-' + post.id + '">' +
              '<button class="comment-submit-btn" type="button" onclick="gvSubmitComment(' + post.id + ')">Post</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

// ============================================================
// SKELETON PLACEHOLDERS FOR PAGINATION
// ============================================================
function renderPostSkeleton() {
    return '<div class="post-card-vertical post-skeleton" aria-hidden="true">' +
        '<div class="post-header">' +
            '<div class="post-author d-flex align-items-center gap-2">' +
                '<div class="skeleton-shimmer skeleton-avatar"></div>' +
                '<div class="post-author-info" style="flex:1;">' +
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

  // ============================================================
  // LOAD POSTS
  // ============================================================
  async function loadPosts(reset) {
    if (isLoading) return;
    if (!hasMore && !reset) return;
    isLoading = true;

    const feed = document.getElementById('gvFeedContainer');
    const loadMoreBox = document.getElementById('gvLoadMoreContainer');

    if (reset) {
      page = 1;
      hasMore = true;
      feed.innerHTML = '';
      appendPostSkeletons(feed, 3);
      if (loadMoreBox) loadMoreBox.classList.add('d-none');
    } else {
      appendPostSkeletons(feed, 2);
      if (loadMoreBox) loadMoreBox.classList.add('d-none');
    }

    try {
      const r = await fetch('/api/groups/' + GROUP_ID + '/posts/?page=' + page);
      const d = await r.json();
      removePostSkeletons(feed);
      if (!d.success) throw new Error(d.error || 'Failed');

      if (reset) feed.innerHTML = '';

      if (!d.posts.length && reset) {
        feed.innerHTML =
          '<div class="gv-empty-feed">' +
            '<div class="gv-empty-icon"><i class="bi bi-chat-square-text"></i></div>' +
            '<h5>No posts yet</h5>' +
            '<p>Be the first to share something!</p>' +
          '</div>';
        hasMore = false;
        loadMoreBox.classList.add('d-none');
        return;
      }

      d.posts.forEach(post => feed.insertAdjacentHTML('beforeend', renderPost(post)));
      gvSetupVideoScrollTracking();

      hasMore = d.has_more;
      if (hasMore) {
        loadMoreBox.classList.remove('d-none');
      } else {
        loadMoreBox.classList.add('d-none');
      }
      page++;
    } catch (e) {
      removePostSkeletons(feed);
      console.warn('loadPosts failed', e);
      if (reset) {
        feed.innerHTML = '<div class="gv-empty-feed"><div class="gv-empty-icon"><i class="bi bi-exclamation-triangle"></i></div><h5>Failed to load posts</h5><p>Please refresh and try again.</p></div>';
      }
    } finally {
      isLoading = false;
    }
  }

  // ============================================================
  // CREATE POST
  // ============================================================
  function updateCharCount() {
    const ta = document.getElementById('gvPostContent');
    const count = document.getElementById('gvCharCount');
    if (!ta || !count) return;
    const remaining = 1000 - ta.value.length;
    count.textContent = remaining;
    count.className = remaining < 100 ? 'char-count text-danger' : 'char-count';
  }

  function handleMediaSelect(e) {
    const files = Array.from(e.target.files || []);
    files.forEach(f => {
      if (f.size > 10 * 1024 * 1024) { toast(f.name + ' too large', 'warning'); return; }
      const isImg = f.type.startsWith('image/');
      const isVid = f.type.startsWith('video/');
      if (!isImg && !isVid) return;
      selectedMedia.push({
        type: isImg ? 'image' : 'video',
        file: f,
        preview: URL.createObjectURL(f),
      });
    });
    updateMediaPreview();
    e.target.value = '';
  }

  function updateMediaPreview() {
    const preview = document.getElementById('gvMediaPreview');
    if (!preview) return;
    if (!selectedMedia.length) { preview.classList.add('d-none'); preview.innerHTML = ''; return; }
    preview.classList.remove('d-none');
    preview.innerHTML = selectedMedia.map((m, i) => `
      <div class="media-item">
        ${m.type === 'image' ? '<img src="' + m.preview + '">' : '<video src="' + m.preview + '"></video>'}
        <button class="remove-media" type="button" onclick="gvRemoveMedia(${i})"><i class="bi bi-x"></i></button>
      </div>`).join('');
  }

  window.gvRemoveMedia = function (i) {
    if (selectedMedia[i] && selectedMedia[i].preview) URL.revokeObjectURL(selectedMedia[i].preview);
    selectedMedia.splice(i, 1);
    updateMediaPreview();
  };

  async function createPost() {
    const ta = document.getElementById('gvPostContent');
    const content = ta.value.trim();
    if (!content && !selectedMedia.length) {
      toast('Please add content or media', 'warning');
      return;
    }

    const btn = document.getElementById('gvPostSubmit');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

    const fd = new FormData();
    fd.append('content', content);
    selectedMedia.forEach(m => fd.append('media[]', m.file));

    try {
      const d = await postForm('/api/groups/' + GROUP_ID + '/posts/create/', fd);
      if (!d.success) {
        toast(d.error || 'Failed to post', 'error');
        return;
      }

      ta.value = '';
      ta.style.height = 'auto';
      selectedMedia.forEach(m => URL.revokeObjectURL(m.preview));
      selectedMedia = [];
      updateMediaPreview();
      updateCharCount();

      if (d.status === 'pending') {
        toast('Post submitted for admin approval', 'info');
      } else {
        toast('Post created!', 'success');
        await loadPosts(true);
      }
    } catch (e) {
      toast('Network error', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  // ============================================================
  // REACTIONS (Optimistic UI)
  // ============================================================
  const reactingGroupPosts = {};

  window.gvReact = async function (postId, reaction) {
    if (!postId || (reaction !== 'like' && reaction !== 'dislike')) return;
    if (reactingGroupPosts[postId]) return;

    const card = document.querySelector('.post-card-vertical[data-post-id="' + postId + '"]');
    if (!card) return;
    const likeBtn = card.querySelector('.like-btn');
    const dislikeBtn = card.querySelector('.dislike-btn');
    if (!likeBtn || !dislikeBtn) return;

    const likeCountEl = likeBtn.querySelector('.action-count');
    const dislikeCountEl = dislikeBtn.querySelector('.action-count');

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

      if (isLiked) {
        likeBtn.classList.add('active');
        const iconL = likeBtn.querySelector('i');
        if (iconL) iconL.className = 'bi bi-hand-thumbs-up-fill';
      } else {
        likeBtn.classList.remove('active');
        const iconL = likeBtn.querySelector('i');
        if (iconL) iconL.className = 'bi bi-hand-thumbs-up';
      }

      if (isDisliked) {
        dislikeBtn.classList.add('active');
        const iconD = dislikeBtn.querySelector('i');
        if (iconD) iconD.className = 'bi bi-hand-thumbs-down-fill';
      } else {
        dislikeBtn.classList.remove('active');
        const iconD = dislikeBtn.querySelector('i');
        if (iconD) iconD.className = 'bi bi-hand-thumbs-down';
      }
    }

    // Instant 0ms Optimistic UI update
    renderReactionState(optLiked, optDisliked, optLikes, optDislikes);
    reactingGroupPosts[postId] = true;

    try {
      const d = await postJSON('/api/groups/posts/' + postId + '/react/', { reaction });
      if (d.success) {
        renderReactionState(d.user_reaction === 'like', d.user_reaction === 'dislike', d.likes, d.dislikes);
      } else {
        renderReactionState(prevState.wasLiked, prevState.wasDisliked, prevState.likes, prevState.dislikes);
        toast(d.error || 'Failed', 'error');
      }
    } catch (e) {
      renderReactionState(prevState.wasLiked, prevState.wasDisliked, prevState.likes, prevState.dislikes);
      toast('Network error', 'error');
    } finally {
      delete reactingGroupPosts[postId];
    }
  };

  // ============================================================
  // COMMENTS
  // ============================================================
  window.gvToggleComments = function (postId, e) {
    if (e) e.stopPropagation();
    const sec = document.getElementById('gvComments-' + postId);
    if (!sec) return;
    const isOpen = sec.classList.contains('expanded');
    document.querySelectorAll('.comments-section-expandable.expanded').forEach(s => {
      if (s.id !== 'gvComments-' + postId) s.classList.remove('expanded');
    });
    sec.classList.toggle('expanded');
    if (!isOpen) {
      loadComments(postId);
      setTimeout(() => document.getElementById('gvCommentInput-' + postId)?.focus(), 300);
    }
  };

  async function loadComments(postId) {
    const c = document.getElementById('gvCommentsContainer-' + postId);
    if (!c) return;
    c.innerHTML = '<div class="text-center py-2"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
    try {
      const r = await fetch('/api/groups/posts/' + postId + '/comments/');
      const d = await r.json();
      if (!d.success) { c.innerHTML = '<div class="no-comments">Error loading comments</div>'; return; }
      if (!d.comments.length) {
        c.innerHTML = '<div class="no-comments">No comments yet. Be the first!</div>';
        return;
      }
      c.innerHTML = d.comments.map(cm => renderComment(cm, postId)).join('');
    } catch (e) {
      c.innerHTML = '<div class="no-comments">Failed to load comments</div>';
    }
  }

  function renderComment(cm, postId) {
    const isMine = cm.author.id === USER_ID;
    const canDelete = isMine || IS_ADMIN || Boolean(window.XPY_CONFIG && window.XPY_CONFIG.isStaff);
    var av = (cm.author && cm.author.picture) ? cm.author.picture : '/static/images/avatars/default.png';
    var avThumb = av;
    if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
      avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
    }
    return '' +
      '<div class="comment-item" data-comment-id="' + cm.id + '">' +
        '<img src="' + avThumb + '" data-full-src="' + av + '" width="40" height="40" class="comment-avatar" onerror="this.onerror=null;this.src=\'' + av + '\'">' +
        '<div class="comment-content">' +
          '<div class="comment-header">' +
            '<strong>' + escapeHtml(cm.author.name.split(' ')[0]) + '</strong>' +
            '<span class="comment-meta">' + escapeHtml(cm.time_ago) + '</span>' +
            (canDelete ? '<button class="comment-delete-btn" type="button" onclick="gvDeleteComment(' + cm.id + ', ' + postId + ')"><i class="bi bi-trash"></i></button>' : '') +
          '</div>' +
          '<div class="comment-text">' + escapeHtml(cm.content).replace(/\n/g, '<br>') + '</div>' +
        '</div>' +
      '</div>';
  }

  window.gvSubmitComment = async function (postId) {
    const input = document.getElementById('gvCommentInput-' + postId);
    if (!input) return;
    const content = input.value.trim();
    if (!content) return;
    const btn = input.nextElementSibling;
    const orig = btn ? btn.innerHTML : 'Post';

    const savedContent = content;
    input.value = '';

    // Snapshot comment count
    const card = document.querySelector('.post-card-vertical[data-post-id="' + postId + '"]');
    const countEl = card ? card.querySelector('.comment-btn .action-count') : null;
    const prevCount = countEl ? parseInt(countEl.textContent || '0', 10) : 0;
    if (countEl) countEl.textContent = prevCount + 1;

    // Optimistic comment DOM insertion
    const c = document.getElementById('gvCommentsContainer-' + postId);
    const noComments = c ? c.querySelector('.no-comments') : null;
    const wasNoComments = Boolean(noComments);
    if (noComments) noComments.style.display = 'none';

    const tempId = 'temp-' + Date.now();
    const currentUserName = document.querySelector('.user-info h4, .avatar-img')?.alt || 'You';
    const currentUserPic = document.querySelector('.avatar-mini-img, .avatar-img')?.getAttribute('src') || '/static/images/avatars/default.png';

    const optimisticCm = {
      id: tempId,
      author: {
        id: USER_ID,
        name: currentUserName,
        username: (window.XPY_CONFIG && window.XPY_CONFIG.username) || currentUserName,
        picture: currentUserPic
      },
      time_ago: 'Just now',
      content: savedContent
    };

    if (c) {
      c.insertAdjacentHTML('beforeend', renderComment(optimisticCm, postId));
    }
    const tempEl = c ? c.querySelector('.comment-item[data-comment-id="' + tempId + '"]') : null;
    if (tempEl) {
      tempEl.style.opacity = '0.65';
      tempEl.style.transition = 'opacity 0.2s ease';
      tempEl.dataset.isOptimistic = 'true';
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    }

    try {
      const d = await postJSON('/api/groups/posts/' + postId + '/comments/add/', { content: savedContent });
      if (d.success) {
        if (tempEl) {
          tempEl.style.opacity = '1';
          tempEl.dataset.commentId = d.comment.id;
          delete tempEl.dataset.isOptimistic;
          const delBtn = tempEl.querySelector('.comment-delete-btn');
          if (delBtn) {
            delBtn.setAttribute('onclick', 'gvDeleteComment(' + d.comment.id + ', ' + postId + ')');
          }
        }
        if (wasNoComments && noComments) {
          noComments.remove();
        }
      } else {
        if (tempEl) tempEl.remove();
        if (wasNoComments && noComments) noComments.style.display = '';
        if (countEl) countEl.textContent = prevCount;
        input.value = savedContent;
        toast(d.error || 'Failed to post comment', 'error');
      }
    } catch (e) {
      if (tempEl) tempEl.remove();
      if (wasNoComments && noComments) noComments.style.display = '';
      if (countEl) countEl.textContent = prevCount;
      input.value = savedContent;
      toast('Network error', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
      input.focus();
    }
  };

  // Group Admin Moderation Actions
  window.gvApprovePost = async function(postId) {
    try {
      const d = await postJSON('/api/groups/posts/' + postId + '/approve/', {});
      if (d.success) {
        toast('Post approved', 'success');
        const card = document.querySelector('.post-card-vertical[data-post-id="' + postId + '"]');
        if (card) {
          card.querySelector('.badge-pending')?.remove();
          card.querySelector('.post-pending-actions')?.remove();
        }
      } else {
        toast(d.error || 'Failed to approve', 'error');
      }
    } catch (e) {
      toast('Network error', 'error');
    }
  };

  window.gvRejectPost = async function(postId) {
    const ok = await confirmDialog('Reject Post', 'Are you sure you want to reject this post?', 'Reject');
    if (!ok) return;
    try {
      const d = await postJSON('/api/groups/posts/' + postId + '/reject/', {});
      if (d.success) {
        toast('Post rejected', 'success');
        const card = document.querySelector('.post-card-vertical[data-post-id="' + postId + '"]');
        if (card) card.remove();
      } else {
        toast(d.error || 'Failed to reject', 'error');
      }
    } catch (e) {
      toast('Network error', 'error');
    }
  };

  window.gvDeleteComment = async function (commentId, postId) {
    const ok = await confirmDialog('Delete Comment', 'Delete this comment?', 'Delete');
    if (!ok) return;
    const d = await postJSON('/api/groups/posts/comments/' + commentId + '/delete/', {});
    if (!d.success) { toast(d.error || 'Failed', 'error'); return; }
    const el = document.querySelector('.comment-item[data-comment-id="' + commentId + '"]');
    if (el) el.remove();
    const card = document.querySelector('.post-card-vertical[data-post-id="' + postId + '"]');
    if (card) {
      const countEl = card.querySelector('.comment-btn .action-count');
      if (countEl) countEl.textContent = Math.max(0, parseInt(countEl.textContent) - 1);
    }
  };

  // ============================================================
  // POST ACTIONS DROPDOWN
  // ============================================================
  window.gvToggleActionsMenu = function (btn) {
    event.stopPropagation();
    const dropdown = btn.nextElementSibling;
    const isOpen = dropdown.classList.contains('show');
    document.querySelectorAll('.post-actions-dropdown .dropdown-menu.show').forEach(m => m.classList.remove('show'));
    if (!isOpen) dropdown.classList.add('show');
  };

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.post-actions-dropdown')) {
      document.querySelectorAll('.post-actions-dropdown .dropdown-menu.show').forEach(m => m.classList.remove('show'));
    }
  });

  window.gvCopyLink = function (postId) {
    const url = window.location.origin + '/groups/' + GROUP_ID + '/#post-' + postId;
    navigator.clipboard.writeText(url).then(() => toast('Link copied', 'success'));
  };

  // ============================================================
  // DELETE POST
  // ============================================================
  window.gvConfirmDelete = function (postId) {
    deletePostId = postId;
    const overlay = document.getElementById('customConfirmOverlay');
    const box = document.getElementById('gvDeleteConfirmBox');
    overlay.classList.add('show');
    box.classList.add('show');
    const cleanup = () => {
      overlay.classList.remove('show');
      box.classList.remove('show');
    };
    const ok = document.getElementById('gvDeleteOk');
    const cancel = document.getElementById('gvDeleteCancel');
    ok.onclick = async () => {
      cleanup();

      const card = document.querySelector('.post-card-vertical[data-post-id="' + deletePostId + '"]');
      const countEl = document.getElementById('gvPostCount');
      const countElMob = document.getElementById('gvPostCountMobile');

      const prevCount = countEl ? (parseInt(countEl.textContent || '0', 10) || 0) : null;
      const prevCountMob = countElMob ? (parseInt(countElMob.textContent || '0', 10) || 0) : null;

      if (countEl && prevCount !== null) countEl.textContent = Math.max(0, prevCount - 1);
      if (countElMob && prevCountMob !== null) countElMob.textContent = Math.max(0, prevCountMob - 1);

      let prevDisplay = '';
      if (card) {
        prevDisplay = card.style.display;
        card.style.transition = 'all 0.2s ease';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.96)';
        setTimeout(() => {
          if (card && card.style.opacity === '0') {
            card.style.display = 'none';
          }
        }, 200);
      }

      try {
        const d = await postJSON('/api/groups/posts/' + deletePostId + '/delete/', {});
        if (d.success) {
          if (card) card.remove();
          toast('Post deleted', 'success');
        } else {
          // Rollback on failure
          if (card) {
            card.style.display = prevDisplay;
            setTimeout(() => {
              card.style.opacity = '1';
              card.style.transform = '';
            }, 10);
          }
          if (countEl && prevCount !== null) countEl.textContent = prevCount;
          if (countElMob && prevCountMob !== null) countElMob.textContent = prevCountMob;
          toast(d.error || 'Failed', 'error');
        }
      } catch (err) {
        // Rollback on network error
        if (card) {
          card.style.display = prevDisplay;
          setTimeout(() => {
            card.style.opacity = '1';
            card.style.transform = '';
          }, 10);
        }
        if (countEl && prevCount !== null) countEl.textContent = prevCount;
        if (countElMob && prevCountMob !== null) countElMob.textContent = prevCountMob;
        toast('Failed to delete post', 'error');
      }
    };
    cancel.onclick = cleanup;
    overlay.onclick = cleanup;
  };

  // ============================================================
  // MEDIA SLIDER
  // ============================================================
  window.gvSlideMedia = function (postId, dir) {
    const slider = document.querySelector('.post-card-vertical[data-post-id="' + postId + '"] .post-media-slider');
    if (!slider) return;
    const items = slider.querySelectorAll('.slider-item');
    const inds = slider.querySelectorAll('.indicator');
    const activeIdx = Array.from(items).findIndex(i => i.classList.contains('active'));
    items[activeIdx].classList.remove('active');
    inds[activeIdx].classList.remove('active');
    let ni = activeIdx + dir;
    if (ni < 0) ni = items.length - 1;
    if (ni >= items.length) ni = 0;
    items[ni].classList.add('active');
    inds[ni].classList.add('active');
  };

  window.gvGoToSlide = function (postId, idx) {
    const slider = document.querySelector('.post-card-vertical[data-post-id="' + postId + '"] .post-media-slider');
    if (!slider) return;
    slider.querySelectorAll('.slider-item, .indicator').forEach(el => el.classList.remove('active'));
    slider.querySelectorAll('.slider-item')[idx].classList.add('active');
    slider.querySelectorAll('.indicator')[idx].classList.add('active');
  };

  window.gvOpenImageViewer = function (url) {
    if (window.openMediaLightbox) {
      window.openMediaLightbox(url);
    } else {
      document.getElementById('gvImageViewerImg').src = url;
      new bootstrap.Modal(document.getElementById('gvImageViewerModal')).show();
    }
  };

  // ============================================================
  // GROUP ACTIONS
  // ============================================================
  window.gvJoinGroup = async function () {
    if (CFG.privacy === 'private') {
      // Send request with empty message
      const d = await postJSON('/api/groups/' + GROUP_ID + '/request-join/', { message: '' });
      if (d.success) {
        toast('Request sent!', 'success');
        setTimeout(() => location.reload(), 800);
      } else {
        toast(d.error || 'Failed', 'error');
      }
      return;
    }
    const d = await postJSON('/api/groups/' + GROUP_ID + '/join/', {});
    if (d.success) {
      toast('Joined!', 'success');
      setTimeout(() => location.reload(), 800);
    } else {
      toast(d.error || 'Failed', 'error');
    }
  };

  window.gvLeaveGroup = async function () {
    const ok = await confirmDialog('Leave Group', 'Leave this group?', 'Leave');
    if (!ok) return;
    const d = await postJSON('/api/groups/' + GROUP_ID + '/leave/', {});
    if (d.success) {
      toast('Left group', 'success');
      setTimeout(() => location.reload(), 800);
    } else {
      toast(d.error || 'Failed', 'error');
    }
  };

  window.gvShareGroup = function () {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: CFG.groupTitle, url }).catch(() => {
        navigator.clipboard.writeText(url).then(() => toast('Link copied', 'success'));
      });
    } else {
      navigator.clipboard.writeText(url).then(() => toast('Link copied', 'success'));
    }
  };

  window.gvShowInfoModal = function () {
    new bootstrap.Modal(document.getElementById('gvInfoModal')).show();
  };

  window.gvOpenMembersModal = async function () {
    const modal = new bootstrap.Modal(document.getElementById('gvMembersModal'));
    modal.show();
    const container = document.getElementById('gvMembersList');
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';
    try {
      const r = await fetch('/api/groups/' + GROUP_ID + '/members/');
      const d = await r.json();
      if (!d.success || !d.members.length) {
        container.innerHTML = '<div class="text-center py-4" style="color:var(--xpy-text-muted);">No members yet</div>';
        return;
      }
      container.innerHTML = d.members.map(m => {
        var av = m.picture || '/static/images/avatars/default.png';
        var avThumb = av;
        if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
          avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
        }
        return `
        <a href="/user/${m.username}/" class="gv-modal-member">
          <img src="${avThumb}" data-full-src="${av}" class="avatar-img" width="40" height="40" onerror="this.onerror=null;this.src='${av}'">
          <div class="gv-modal-member-info">
            <div class="gv-modal-member-name">${escapeHtml(m.name)}</div>
            <div class="gv-modal-member-username">@${escapeHtml(m.username)}</div>
          </div>
          ${m.is_admin ? '<span class="gv-modal-member-badge">Admin</span>' : ''}
        </a>`;
      }).join('');
    } catch (e) {
      container.innerHTML = '<div class="text-center py-4" style="color:var(--danger-color);">Failed to load</div>';
    }
  };

    // ============================================================
  // EDIT POST
  // ============================================================
  let editPostId = null;
  let editMediaFiles = [];

  window.gvOpenEditPost = async function (postId) {
    editPostId = postId;
    editMediaFiles = [];

    // Fetch current post
    let post = null;
    try {
      // Find in already-rendered posts by re-fetching from the feed list
      const card = document.querySelector('.post-card-vertical[data-post-id="' + postId + '"]');
      if (!card) return;

      // Pull content from the DOM (safe: we control rendering)
      const contentEl = card.querySelector('.post-content');
      const contentText = contentEl ? contentEl.innerText : '';

      // Pull media from the slider's data attribute if present
      const slider = card.querySelector('.post-media-slider');
      if (slider) {
        // Rebuild media list from rendered <img>/<video>
        const items = slider.querySelectorAll('.slider-item');
        items.forEach(item => {
          const img = item.querySelector('img');
          const vid = item.querySelector('video source');
          if (img) {
            editMediaFiles.push({ type: 'image', url: img.getAttribute('src'), preview: img.getAttribute('src'), existing: true });
          } else if (vid) {
            editMediaFiles.push({ type: 'video', url: vid.getAttribute('src'), preview: vid.getAttribute('src'), existing: true });
          }
        });
      }

      document.getElementById('editPostContent').value = contentText;
      updateEditCharCount();
      updateEditMediaPreview();

      // Attach one-time change handlers to the media inputs
      const imgInput = document.getElementById('editImageInput');
      const vidInput = document.getElementById('editVideoInput');
      if (imgInput) { imgInput.onchange = (e) => gvHandleEditMediaSelect(e, 'image'); }
      if (vidInput) { vidInput.onchange = (e) => gvHandleEditMediaSelect(e, 'video'); }

      // Attach save handler
      const saveBtn = document.getElementById('saveEditBtn');
      if (saveBtn) { saveBtn.onclick = gvSavePostEdit; }

      const modalEl = document.getElementById('editPostModal');
      new bootstrap.Modal(modalEl).show();
    } catch (e) {
      console.warn('open edit failed', e);
      toast('Failed to open editor', 'error');
    }
  };

  function updateEditCharCount() {
    const ta = document.getElementById('editPostContent');
    const c = document.getElementById('editCharCount');
    if (!ta || !c) return;
    const remaining = 500 - ta.value.length;
    c.textContent = remaining;
    c.className = remaining < 100 ? 'char-count text-danger' : 'char-count';
  }

  function updateEditMediaPreview() {
    const preview = document.getElementById('editMediaPreview');
    if (!preview) return;
    if (!editMediaFiles.length) {
      preview.innerHTML = '';
      preview.classList.add('d-none');
      return;
    }
    preview.classList.remove('d-none');
    preview.innerHTML = editMediaFiles.map((m, i) => `
      <div class="media-item">
        ${m.type === 'image' ? '<img src="' + (m.preview || m.url) + '">' : '<video src="' + (m.preview || m.url) + '"></video>'}
        <button type="button" class="remove-media" onclick="gvRemoveEditMedia(${i})"><i class="bi bi-x"></i></button>
      </div>`).join('');
  }

  window.gvRemoveEditMedia = function (i) {
    if (editMediaFiles[i] && editMediaFiles[i].isNew && editMediaFiles[i].preview) {
      URL.revokeObjectURL(editMediaFiles[i].preview);
    }
    editMediaFiles.splice(i, 1);
    updateEditMediaPreview();
  };

  function gvHandleEditMediaSelect(e, type) {
    const files = Array.from(e.target.files || []);
    files.forEach(f => {
      if (f.size > 10 * 1024 * 1024) { toast(f.name + ' too large', 'warning'); return; }
      editMediaFiles.push({
        type,
        file: f,
        preview: URL.createObjectURL(f),
        isNew: true,
      });
    });
    updateEditMediaPreview();
    e.target.value = '';
  }

  async function gvSavePostEdit() {
    if (!editPostId) return;
    const content = document.getElementById('editPostContent').value.trim();
    if (!content && !editMediaFiles.length) {
      toast('Post cannot be empty', 'warning');
      return;
    }

    const btn = document.getElementById('saveEditBtn');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...';

    const fd = new FormData();
    fd.append('content', content);
    const existing = editMediaFiles.filter(m => m.existing).map(m => m.url);
    if (existing.length) fd.append('existing_media', existing.join(','));
    editMediaFiles.filter(m => m.isNew && m.file).forEach(m => fd.append('new_media[]', m.file));

    try {
      const d = await postForm('/api/groups/posts/' + editPostId + '/edit/', fd);
      if (d.success) {
        // Replace the post card in the DOM
        const oldCard = document.querySelector('.post-card-vertical[data-post-id="' + editPostId + '"]');
        if (oldCard && d.post) {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = renderPost(d.post);
          oldCard.replaceWith(wrapper.firstElementChild);
        }
        toast('Post updated', 'success');
        bootstrap.Modal.getInstance(document.getElementById('editPostModal')).hide();
        editPostId = null;
        editMediaFiles = [];
      } else {
        toast(d.error || 'Failed to update', 'error');
      }
    } catch (e) {
      toast('Network error', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  // ============================================================
  // INIT
  // ============================================================
  document.addEventListener('DOMContentLoaded', function () {
    const ta = document.getElementById('gvPostContent');
    if (ta) {
      ta.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 150) + 'px';
        updateCharCount();
      });
    }
    document.getElementById('gvImageInput')?.addEventListener('change', handleMediaSelect);
    document.getElementById('gvVideoInput')?.addEventListener('change', handleMediaSelect);
    document.getElementById('gvPostSubmit')?.addEventListener('click', createPost);
    document.getElementById('gvLoadMoreBtn')?.addEventListener('click', () => loadPosts(false));

    let gvScrollTimeout;
    window.addEventListener('scroll', function() {
      clearTimeout(gvScrollTimeout);
      gvScrollTimeout = setTimeout(function() {
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 600 && !isLoading && hasMore) {
          loadPosts(false);
        }
      }, 150);
    });
    document.getElementById('editPostContent')?.addEventListener('input', updateEditCharCount);

    // Enter key on comment inputs
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        const t = e.target;
        if (t && t.classList && t.classList.contains('comment-input-expandable')) {
          e.preventDefault();
          const postId = t.id.replace('gvCommentInput-', '');
          gvSubmitComment(parseInt(postId));
        }
      }
    });

    loadPosts(true);
  });
})();

function gvToggleVideoSound(video, e) {
    if (e) e.stopPropagation();
    video.muted = !video.muted;
}

let gvVideoObserver = null;
function gvSetupVideoScrollTracking() {
    if (gvVideoObserver) gvVideoObserver.disconnect();
    gvVideoObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            var video = entry.target;
            if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
                var p = video.play();
                if (p && p.catch) p.catch(function() {});
            } else {
                video.pause();
            }
        });
    }, { threshold: [0, 0.5, 0.75] });
    document.querySelectorAll('.grp-post-card video').forEach(function(v) {
        gvVideoObserver.observe(v);
    });
}
