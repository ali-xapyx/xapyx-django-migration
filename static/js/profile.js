

/* ============================================================
   PROFILE PAGE SCRIPT
   ============================================================ */
(function() {
  'use strict';

  const CFG = window.PROFILE_CONFIG;
  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content
    || document.querySelector('[name=csrfmiddlewaretoken]')?.value
    || (document.cookie.match(/csrftoken=([^;]+)/) || [])[1]
    || '';

  function csrfFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (CSRF) options.headers['X-CSRFToken'] = CSRF;
    if (options.method && options.method.toUpperCase() !== 'GET') {
      options.credentials = 'same-origin';
    }
    return fetch(url, options);
  }


  /* ============================================================
     GLOBAL STATE
     ============================================================ */
  let currentPage = 1;
  let isLoading = false;
  let hasMorePosts = true;
  let selectedFiles = [];
  let editFiles = [];
  let editingPostId = null;
  let profileUserId = CFG.viewUserId;
  let loggedUserId = CFG.loggedUserId;
  let friendStatus = CFG.friendStatus;
  let isOwnProfile = CFG.isOwnProfile;
  let isBlocked = CFG.isBlocked;
  let loggedUserHasBlocked = CFG.loggedUserHasBlocked;
  let pollData = null;
  let newProfilePicture = null;

  let visiblePosts = new Map();
  let postViewTimeouts = new Map();
  let postObserver = null;

  let friends = CFG.friends;
  let isMentioning = false;
  let currentMentionStart = -1;
  let mentionSearch = '';
  let activeTextarea = null;

  const BP = '/';
  const DEFAULT_AVATAR = CFG.defaultAvatar;

  /* ============================================================
     VIEW TRACKING
     ============================================================ */
  function setupViewTracking() {
    if (postObserver) postObserver.disconnect();
    postObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const postId = parseInt(entry.target.dataset.postId);
        if (!postId) return;
        if (entry.isIntersecting) startViewTimer(postId);
        else clearViewTimer(postId);
      });
    }, { threshold: 0.5 });
    document.querySelectorAll('.post-card-vertical').forEach(p => postObserver.observe(p));
  }
  function startViewTimer(postId) {
    clearViewTimer(postId);
    const tid = setInterval(() => {
      recordView(postId);
    }, 5000);
    postViewTimeouts.set(postId, tid);
  }
  function clearViewTimer(postId) {
    if (postViewTimeouts.has(postId)) {
      clearInterval(postViewTimeouts.get(postId));
      postViewTimeouts.delete(postId);
    }
    visiblePosts.delete(postId);
  }
  async function recordView(postId) {
    try {
      const r = await csrfFetch('/api/posts/view/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId, type: 'user' })
      });
      const d = await r.json();
      if (d.success) updatePostViewCount(postId, d.new_view_count);
    } catch (e) { console.error(e); }
  }
  function updatePostViewCount(postId, count) {
    const el = document.querySelector(`.post-card-vertical[data-post-id="${postId}"] .post-views-count`);
    if (el && count != null) {
      const iconEl = el.querySelector('i, svg');
      if (iconEl) {
        el.innerHTML = `${iconEl.outerHTML} ${count}`;
      } else {
        el.innerHTML = `<i class="bi bi-eye"></i> ${count}`;
      }
    }
  }

  /* ============================================================
     CUSTOM CONFIRM
     ============================================================ */
  function setupCustomConfirms() {
    const overlay = document.getElementById('customConfirmOverlay');
    const box = document.getElementById('customConfirmBox');
    const cancel = document.getElementById('confirmCancel');
    const ok = document.getElementById('confirmOk');
    const dBox = document.getElementById('deleteConfirmBox');
    const dCancel = document.getElementById('deleteCancel');
    const dOk = document.getElementById('deleteOk');
    let resolveFn = null, rejectFn = null;

    window.showConfirm = function(title, message, opts = {}) {
      return new Promise((resolve, reject) => {
        resolveFn = resolve; rejectFn = reject;
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMessage').textContent = message;
        if (opts.okText) ok.textContent = opts.okText;
        if (opts.cancelText) cancel.textContent = opts.cancelText;
        overlay.classList.add('show');
        box.classList.add('show');
      });
    };
    window.showDeleteConfirm = function() {
      return new Promise((resolve) => {
        overlay.classList.add('show');
        dBox.classList.add('show');
        dOk.onclick = () => { hideAllConfirms(); resolve(true); };
        dCancel.onclick = () => { hideAllConfirms(); resolve(false); };
      });
    };
    cancel.onclick = () => { hideAllConfirms(); if (rejectFn) rejectFn(false); };
    ok.onclick = () => { hideAllConfirms(); if (resolveFn) resolveFn(true); };
    overlay.onclick = () => { hideAllConfirms(); if (rejectFn) rejectFn(false); };
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { hideAllConfirms(); if (rejectFn) rejectFn(false); }
    });
  }
  function hideAllConfirms() {
    document.querySelectorAll('.custom-confirm-overlay, .custom-confirm-box').forEach(el => el.classList.remove('show'));
  }

  /* ============================================================
     ALERTS
     ============================================================ */
  window.showAlert = function(message, type = 'info', duration = 5000) {
    document.querySelectorAll('.custom-alert').forEach(a => a.remove());
    const div = document.createElement('div');
    div.className = `custom-alert ${type}`;
    const icon = {success:'bi-check-circle-fill', error:'bi-x-circle-fill', warning:'bi-exclamation-triangle-fill'}[type] || 'bi-info-circle-fill';
    const color = {success:'var(--success-color)', error:'var(--danger-color)', warning:'var(--warning-color)'}[type] || 'var(--info-color)';
    div.innerHTML = `<div class="d-flex align-items-center justify-content-between">
      <div class="d-flex align-items-center">
        <i class="bi ${icon} alert-icon" style="color:${color}"></i>
        <div>${message}</div>
      </div>
      <button type="button" class="btn-close btn-close-white" onclick="this.parentElement.parentElement.remove()"></button>
    </div>`;
    document.body.appendChild(div);
    if (duration > 0) setTimeout(() => div.remove(), duration);
  };

  /* ============================================================
     MENTIONS
     ============================================================ */
  function setupMentionHandlers() {
    const ta = document.getElementById('postContent');
    const editTa = document.getElementById('editPostContent');
    if (ta) {
      ta.addEventListener('input', function(e){ activeTextarea = this; handleMentionInput(e); });
      ta.addEventListener('keydown', function(e){ activeTextarea = this; handleMentionKeydown(e); });
    }
    if (editTa) {
      editTa.addEventListener('input', function(e){ activeTextarea = this; handleMentionInput(e); });
      editTa.addEventListener('keydown', function(e){ activeTextarea = this; handleMentionKeydown(e); });
    }
    document.addEventListener('input', function(e) {
      if (e.target && e.target.classList && e.target.classList.contains('comment-input-expandable')) {
        activeTextarea = e.target;
        handleMentionInput(e);
      }
    });
    document.addEventListener('keydown', function(e) {
      if (e.target && e.target.classList && e.target.classList.contains('comment-input-expandable')) {
        activeTextarea = e.target;
        handleMentionKeydown(e);
      }
    });
    document.addEventListener('click', function(e) {
      const dd = document.getElementById('mentionsDropdown');
      if (dd && !dd.contains(e.target) && e.target !== ta && e.target !== editTa &&
          !(e.target.classList && e.target.classList.contains('comment-input-expandable'))) {
        dd.classList.remove('show');
        isMentioning = false;
      }
    });
  }
  function handleMentionInput(e) {
    if (!activeTextarea) return;
    const v = activeTextarea.value;
    const pos = activeTextarea.selectionStart;
    let start = -1;
    for (let i = pos - 1; i >= 0; i--) {
      if (v[i] === '@' && (i === 0 || /[\s\n\t]/.test(v[i-1]))) { start = i; break; }
    }
    if (start !== -1 && (pos === start + 1 || v[start + 1] !== ' ')) {
      isMentioning = true;
      currentMentionStart = start;
      mentionSearch = v.substring(start + 1, pos).toLowerCase();
      showMentionsDropdown(mentionSearch);
    } else {
      isMentioning = false;
      const dd = document.getElementById('mentionsDropdown');
      if (dd) dd.classList.remove('show');
    }
  }
  function handleMentionKeydown(e) {
    if (!isMentioning || !activeTextarea) return;
    const dd = document.getElementById('mentionsDropdown');
    if (!dd || !dd.classList.contains('show')) return;
    const items = dd.querySelectorAll('.mention-item');
    if (!items.length) return;
    let active = -1;
    items.forEach((it, i) => { if (it.classList.contains('active')) active = i; });
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (active < items.length - 1) {
        if (active !== -1) items[active].classList.remove('active');
        items[active + 1].classList.add('active');
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (active > 0) {
        items[active].classList.remove('active');
        items[active - 1].classList.add('active');
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active !== -1) selectMention(items[active]);
    } else if (e.key === 'Escape') {
      dd.classList.remove('show');
      isMentioning = false;
    }
  }
  function showMentionsDropdown(search) {
    const dd = document.getElementById('mentionsDropdown');
    if (!dd || !activeTextarea) return;
    const filtered = friends.filter(f =>
      f.name.toLowerCase().includes(search) || f.username.toLowerCase().includes(search)
    );
    if (!filtered.length) { dd.classList.remove('show'); return; }
    const rect = activeTextarea.getBoundingClientRect();
    const style = getComputedStyle(activeTextarea);
    const lineH = parseInt(style.lineHeight) || 22;
    const padTop = parseInt(style.paddingTop) || 0;
    const before = activeTextarea.value.substring(0, activeTextarea.selectionStart);
    const lines = before.split('\n');
    const cursorX = activeTextarea.selectionStart - lines.slice(0, -1).join('\n').length - (lines.length > 1 ? 1 : 0);
    dd.innerHTML = filtered.map((f, i) => {
      var av = f.picture || '/static/images/avatars/default.png';
      var avThumb = av;
      if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
        avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
      }
      return `
      <div class="mention-item ${i === 0 ? 'active' : ''}"
           data-user-id="${f.id}" data-username="${f.username}">
        <img src="${avThumb}" data-full-src="${av}" width="44" height="44" onerror="this.onerror=null;this.src='${av}'" class="mention-avatar" alt="">
        <div><div class="mention-name">${f.name}</div><div class="mention-username">@${f.username}</div></div>
      </div>`;
    }).join('');
    dd.querySelectorAll('.mention-item').forEach(item => item.addEventListener('click', () => selectMention(item)));
    dd.style.top = (rect.top + padTop + lines.length * lineH + 5) + 'px';
    dd.style.left = (rect.left + cursorX * 8) + 'px';
    dd.classList.add('show');
  }
  function selectMention(item) {
    if (!activeTextarea) return;
    const u = item.dataset.username;
    const v = activeTextarea.value;
    activeTextarea.value = v.substring(0, currentMentionStart) + '@' + u + ' ' + v.substring(activeTextarea.selectionStart);
    const np = currentMentionStart + u.length + 2;
    activeTextarea.setSelectionRange(np, np);
    if (activeTextarea.id === 'postContent') updateCharCount();
    if (activeTextarea.id === 'editPostContent') updateEditCharCount();
    document.getElementById('mentionsDropdown').classList.remove('show');
    isMentioning = false;
    activeTextarea.dispatchEvent(new Event('input'));
  }
  function extractMentions(text) {
    const re = /@(\w+)/g;
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      const f = friends.find(x => x.username === m[1]);
      if (f) out.push({ user_id: f.id, username: f.username, position: m.index });
    }
    return out;
  }
  function formatMentions(text) {
    if (!text) return '';
    let out = text;
    friends.forEach(f => {
      out = out.replace(new RegExp('@' + f.username + '\\b', 'g'),
      `<a href="/user/${f.username}/" class="mention-link" data-user-id="${f.id}">@${f.username}</a>`);
    });
    return out;
  }

  /* ============================================================
     INIT
     ============================================================ */
document.addEventListener('DOMContentLoaded', function() {
    if (document.body.dataset.page !== 'profile') return;

    if (!isBlocked) loadPosts(true);
    setupEventListeners();
    setupCustomConfirms();
    setupMentionHandlers();
    setupViewTracking();
      setupProfileVideoScrollTracking();

    const ta = document.getElementById('postContent');
    if (ta) ta.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 150) + 'px';
      updateCharCount();
    });

    const sp = document.getElementById('saveProfileBtn');
    if (sp) sp.addEventListener('click', saveProfile);

    document.addEventListener('click', function(e) {
      if (e.target.classList.contains('mention-link')) {
        e.preventDefault();
        const uid = e.target.dataset.userId;
        if (uid) window.location.href = `/user/${uid}/`;
      }
    });

    document.getElementById('editImageInput')?.addEventListener('change', e => handleEditMediaSelect(e, 'image'));
    document.getElementById('editVideoInput')?.addEventListener('change', e => handleEditMediaSelect(e, 'video'));
  });

  function setupEventListeners() {
    document.getElementById('postContent')?.addEventListener('input', updateCharCount);
    document.getElementById('postSubmit')?.addEventListener('click', createPost);
    document.getElementById('imageInput')?.addEventListener('change', handleMediaSelect);
    document.getElementById('videoInput')?.addEventListener('change', handleMediaSelect);
    document.getElementById('editPostContent')?.addEventListener('input', updateEditCharCount);
    document.getElementById('saveEditBtn')?.addEventListener('click', savePostEdit);
    document.getElementById('loadMoreBtn')?.addEventListener('click', () => loadPosts(false));
    document.getElementById('friendButton')?.addEventListener('click', handleFriendAction);

    document.addEventListener('click', function(e) {
      if (!e.target.closest('.post-menu-container')) {
        document.querySelectorAll('.post-menu-dropdown.show').forEach(m => m.classList.remove('show'));
      }
    });

    let scrollT;
    window.addEventListener('scroll', () => {
      clearTimeout(scrollT);
      scrollT = setTimeout(handleScroll, 100);
    });
  }

  function updateCharCount() {
    const t = document.getElementById('postContent');
    const c = document.getElementById('charCount');
    if (!t || !c) return;
    const r = 1000 - t.value.length;
    c.textContent = r;
    c.className = r < 100 ? 'char-count text-danger' : 'xapyx-option-count';
  }
  function updateEditCharCount() {
    const t = document.getElementById('editPostContent');
    const c = document.getElementById('editCharCount');
    if (!t || !c) return;
    const r = 1000 - t.value.length;
    c.textContent = r;
    c.className = r < 100 ? 'char-count text-danger' : 'xapyx-option-count';
  }

  function handleMediaSelect(e) {
    Array.from(e.target.files).forEach(file => {
      let type = 'file';
      if (file.type.startsWith('image/')) type = 'image';
      else if (file.type.startsWith('video/')) type = 'video';
      if (['image', 'video'].includes(type)) {
        selectedFiles.push({ type, file, preview: URL.createObjectURL(file) });
      }
    });
    updateMediaPreview();
    e.target.value = '';
  }
  function updateMediaPreview() {
    const p = document.getElementById('mediaPreview');
    p.innerHTML = '';
    if (!selectedFiles.length) { p.classList.add('d-none'); return; }
    p.classList.remove('d-none');
    selectedFiles.forEach((m, i) => {
      const d = document.createElement('div');
      d.className = 'media-item';
      d.innerHTML = m.type === 'image'
        ? `<img src="${m.preview}" alt=""><button type="button" class="remove-media" onclick="window.__removeMedia(${i})"><i class="bi bi-x"></i></button>`
        : `<video><source src="${m.preview}" type="${m.file.type}"></video><button type="button" class="remove-media" onclick="window.__removeMedia(${i})"><i class="bi bi-x"></i></button>`;
      p.appendChild(d);
    });
  }
  window.__removeMedia = function(i) {
    if (selectedFiles[i]?.preview) URL.revokeObjectURL(selectedFiles[i].preview);
    selectedFiles.splice(i, 1);
    updateMediaPreview();
  };
  function handleEditMediaSelect(e, type) {
    Array.from(e.target.files).forEach(file => {
      editFiles.push({ type, file, preview: URL.createObjectURL(file), isNew: true });
    });
    updateEditMediaPreview();
    e.target.value = '';
  }
  function updateEditMediaPreview() {
    const p = document.getElementById('editMediaPreview');
    if (!p) return;
    p.innerHTML = '';
    if (!editFiles.length) return;
    editFiles.forEach((m, i) => {
      const d = document.createElement('div');
      d.className = 'media-item';
      d.innerHTML = m.type === 'image'
        ? `<img src="${m.preview || m.url}" alt=""><button type="button" class="xapyx-remove-media" onclick="window.__removeEditMedia(${i})"><i class="bi bi-x"></i></button>`
        : `<video><source src="${m.preview || m.url}" type="${m.file?.type || 'video/mp4'}"></video><button type="button" class="xapyx-remove-media" onclick="window.__removeEditMedia(${i})"><i class="bi bi-x"></i></button>`;
      p.appendChild(d);
    });
  }
  window.__removeEditMedia = function(i) {
    if (editFiles[i]?.preview) URL.revokeObjectURL(editFiles[i].preview);
    editFiles.splice(i, 1);
    updateEditMediaPreview();
  };

  window.togglePostMenu = function(btn, postId) {
    event.stopPropagation();
    document.querySelectorAll('.post-menu-dropdown.show').forEach(m => m.classList.remove('show'));
    const menu = btn.nextElementSibling;
    menu.classList.toggle('show');
  };

  window.showPollModal = function() { new bootstrap.Modal(document.getElementById('pollModal')).show(); };
  window.addPollOption = function() {
    const c = document.getElementById('pollOptionsContainer');
    const n = c.querySelectorAll('.input-group').length;
    if (n >= 6) return;
    const d = document.createElement('div');
    d.className = 'input-group mb-2';
    d.innerHTML = `<input type="text" class="form-control poll-option" placeholder="Option ${n+1}"><button class="btn btn-outline-danger btn-sm" type="button" onclick="window.__removePollOption(this)"><i class="bi bi-trash"></i></button>`;
    c.appendChild(d);
  };
  window.__removePollOption = function(btn) {
    const c = document.getElementById('pollOptionsContainer');
    const opts = c.querySelectorAll('.input-group');
    if (opts.length > 2) {
      btn.closest('.input-group').remove();
      c.querySelectorAll('.input-group').forEach((o, i) => o.querySelector('.poll-option').placeholder = `Option ${i+1}`);
    }
  };
  window.addPollToPost = function() {
    const q = document.getElementById('pollQuestion').value.trim();
    const opts = Array.from(document.querySelectorAll('.poll-option')).map(i => i.value.trim()).filter(o => o);
    if (!q || opts.length < 2) { showAlert('Enter question and at least 2 options', 'warning'); return; }
    pollData = { question: q, options: opts, duration: document.getElementById('pollDuration').value };
    document.getElementById('pollPreview').innerHTML = `
      <div class="poll-question"><strong>${q}</strong></div>
      <div class="poll-options mt-2">${opts.map(o => `<div class="poll-option-item">${o}</div>`).join('')}</div>
      <button class="btn btn-sm btn-outline-danger mt-2" onclick="window.__removePoll()"><i class="bi bi-trash"></i> Remove Poll</button>`;
    document.getElementById('pollPreview').classList.remove('d-none');
    bootstrap.Modal.getInstance(document.getElementById('pollModal')).hide();
  };
  window.__removePoll = function() {
    pollData = null;
    document.getElementById('pollPreview').classList.add('d-none');
  };

  /* ============================================================
     POSTS
     ============================================================ */
  async function createPost() {
    const content = document.getElementById('postContent').value.trim();
    if (!content && !selectedFiles.length && !pollData) {
      showAlert('Add content, media, or a poll', 'warning'); return;
    }
    const mentions = extractMentions(content);
    const btn = document.getElementById('postSubmit');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    const fd = new FormData();
    fd.append('content', content);
    if (mentions.length) fd.append('mentions', JSON.stringify(mentions));
    if (pollData) {
      fd.append('poll_question', pollData.question);
      fd.append('poll_options', JSON.stringify(pollData.options));
      fd.append('poll_duration', pollData.duration);
    }
    selectedFiles.forEach(m => m.file && fd.append('media[]', m.file));
    try {
      const r = await csrfFetch('/api/posts/create/', { method: 'POST', body: fd });
      const data = await r.json();
      if (data.success) {
        document.getElementById('postContent').value = '';
        document.getElementById('postContent').style.height = 'auto';
        selectedFiles.forEach(f => f.preview && URL.revokeObjectURL(f.preview));
        selectedFiles = [];
        updateMediaPreview();
        updateCharCount();
        pollData = null;
        document.getElementById('pollPreview').classList.add('d-none');
        if (data.post) prependPost(data.post);
        showAlert('Post created!', 'success');
      } else showAlert(data.error || 'Failed to create post', 'error');
    } catch (e) { showAlert('Network error', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = 'Post'; }
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
    if (isLoading || !hasMorePosts) return;
    isLoading = true;
    const feed = document.getElementById('feedContainer');
    const lm = document.getElementById('loadMoreContainer');
    if (reset) {
      feed.innerHTML = '';
      appendPostSkeletons(feed, 3);
      lm?.classList.add('d-none');
      currentPage = 1;
      hasMorePosts = true;
    } else {
      appendPostSkeletons(feed, 2);
      lm?.classList.add('d-none');
    }
    try {
      const r = await fetch(`/api/user-posts/?profile_user_id=${profileUserId}&page=${currentPage}`);
      const data = await r.json();
      removePostSkeletons(feed);
      if (data.success) {
        if (reset || currentPage === 1) feed.innerHTML = '';
        if (data.posts.length > 0) {
          data.posts.forEach(p => feed.appendChild(createPostElement(p)));
          setTimeout(() => setupViewTracking(), 100);
          currentPage++;
          if (data.has_more) lm?.classList.remove('d-none');
          else { hasMorePosts = false; lm?.classList.add('d-none'); }
        } else {
          hasMorePosts = false;
          lm?.classList.add('d-none');
          if (currentPage === 1) {
            const emptyMsg = isOwnProfile
              ? "You haven't shared anything yet."
              : "This user hasn't shared anything yet.";
            feed.innerHTML = `
              <div class="xapyx-empty-state">
                <i class="bi bi-newspaper"></i>
                <h5>No posts yet</h5>
                <p>${emptyMsg}</p>
              </div>`;
          }
        }
      } else throw new Error(data.error || 'Failed to load posts');
    } catch (e) {
      removePostSkeletons(feed);
      if (currentPage === 1) {
        feed.innerHTML = `
          <div class="xapyx-empty-state">
            <i class="bi bi-exclamation-triangle"></i>
            <h5>Error loading posts</h5>
            <p>Please try again.</p>
            <button class="btn btn-outline-primary mt-2" onclick="location.reload()">Try Again</button>
          </div>`;
      }
    } finally { isLoading = false; }
  }

  function truncateContent(content, maxLines = 4) {
    if (!content) return { text: '', needsSeeMore: false };
    const lines = content.split('\n');
    if (lines.length <= maxLines) return { text: content, needsSeeMore: false };
    return { text: lines.slice(0, maxLines).join('\n'), needsSeeMore: true };
  }

  function createPostElement(post) {
    var el = document.createElement('div');
    el.className = 'post-card-vertical post-card feed-post-item';
    el.dataset.postId = post.id;
    el.dataset.source = post.source || 'user';

    var pollEnded = post.poll && !post.poll.ends_in;
    var pollHtml = '';
    if (post.poll) {
      pollHtml = '<div class="poll-container mt-3 ' + (pollEnded ? 'poll-ended' : '') + '"><div class="poll-question">' + escapeHtml(post.poll.question) + '</div><div class="poll-options">' +
        post.poll.options.map(function(opt, idx) {
          return '<div class="poll-option-item ' + (post.poll.user_vote === idx ? 'user-vote' : '') + '" ' + (pollEnded ? '' : 'onclick="window.__votePoll(' + post.id + ', ' + idx + ')"') + '><div class="poll-option-text">' + escapeHtml(opt.text) + '</div><div class="poll-bar-container"><div class="poll-bar" style="width: ' + opt.percentage + '%"></div></div><div class="poll-stats"><span class="poll-percentage">' + opt.percentage + '%</span><span class="poll-count">(' + opt.votes + ')</span></div></div>';
        }).join('') +
        '</div><div class="poll-meta"><small class="text-muted">' + post.poll.total_votes + ' votes • ' + (pollEnded ? 'Poll ended' : 'Ends in ' + post.poll.ends_in) + '</small></div></div>';
    }

    var mediaHtml = '';
    if (post.media && post.media.length > 0) {
      mediaHtml = '<div class="post-media-slider" id="slider-' + post.id + '" data-media=\'' + JSON.stringify(post.media).replace(/'/g, "&#39;") + '\'><div class="slider-container">' +
        post.media.map(function(m, idx) {
          return '<div class="slider-item ' + (idx === 0 ? 'active' : '') + '" data-index="' + idx + '">' +
            (m.type === 'image'
              ? '<img class="post-media-blur-bg" src="' + m.url + '" alt="" aria-hidden="true">' +
                '<img src="' + m.url + '" class="post-image slider-image" width="800" height="600" loading="lazy" onclick="openMediaViewerFromPost(' + post.id + ', ' + idx + ')">'
              : '<video controls preload="metadata" muted playsinline loop onclick="toggleVideoSound(this, event)"><source src="' + m.url + '" type="' + (m.mime_type || 'video/mp4') + '"></video>') +
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
    var truncatedData = truncateContent(fullContent.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''), 4);
    var truncated = truncatedData.text;
    var needsSeeMore = truncatedData.needsSeeMore;
    var formatted = formatMentions(truncated);

    var userId = loggedUserId;
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

    var postHeader = '<div class="post-header feed-post-header">'
      + (function() {
          var u = (post.author && post.author.username) ? post.author.username : '';
          return u
              ? '<div class="post-author post-user-info" onclick="window.location=\'/user/' 
                + encodeURIComponent(u) + '/\'">'
              : '<div class="post-author post-user-info">';
      })()
      +   '<img src="' + avThumb + '" data-full-src="' + av + '" width="44" height="44" onerror="this.onerror=null;this.src=\'' + av + '\'" class="post-author-avatar">'
      +   '<div class="post-author-info post-header-meta post-user-details">'
      +     '<h6 class="post-author-name">' + escapeHtml(authorName) + '</h6>'
      +     '<span class="post-meta">' + metaLine + '</span>'
      +   '</div>'
      + '</div>'
      + '<div class="post-actions-dropdown">'
      +   '<button class="post-action-btn" onclick="togglePostActionsMenu(this, ' + post.id + ')"><i class="bi bi-three-dots"></i></button>'
      +   '<ul class="dropdown-menu">'
      +     '<li><a class="dropdown-item" href="#" onclick="copyToClipboard(\'' + (window.location.origin + '/post/' + post.id + '/') + '\'); return false;"><i class="bi bi-link-45deg"></i> Copy Link</a></li>'
      +     (post.author && post.author.id === userId ? '<li><a class="dropdown-item" href="#" onclick="window.__editPostModal(' + post.id + '); return false;"><i class="bi bi-pencil"></i> Edit Post</a></li><li><a class="dropdown-item text-danger" href="#" onclick="window.__confirmDeletePost(' + post.id + '); return false;"><i class="bi bi-trash"></i> Delete Post</a></li>' : '')
      +   '</ul>'
      + '</div>'
      + '</div>';

    var postFooter = '<div class="post-footer"><div class="post-actions-horizontal">' +
      '<button class="post-action-btn-horizontal like-btn ' + (post.user_reaction === 'like' ? 'active' : '') + '" onclick="window.__reactPost(' + post.id + ', \'like\')">' +
        '<i class="bi ' + (post.user_reaction === 'like' ? 'bi-hand-thumbs-up-fill' : 'bi-hand-thumbs-up') + '"></i>' +
        '<span class="action-count">' + (post.likes || 0) + '</span>' +
      '</button>' +
      '<button class="post-action-btn-horizontal dislike-btn ' + (post.user_reaction === 'dislike' ? 'active' : '') + '" onclick="window.__reactPost(' + post.id + ', \'dislike\')">' +
        '<i class="bi ' + (post.user_reaction === 'dislike' ? 'bi-hand-thumbs-down-fill' : 'bi-hand-thumbs-down') + '"></i>' +
        '<span class="action-count">' + (post.dislikes || 0) + '</span>' +
      '</button>' +
      '<button class="post-action-btn-horizontal comment-btn" onclick="window.__toggleComments(' + post.id + ', event)">' +
        '<i class="bi bi-chat"></i><span class="action-count">' + (post.comments_count || 0) + '</span>' +
      '</button>' +
      '<button class="post-action-btn-horizontal share-btn" onclick="window.__sharePost(' + post.id + ')">' +
        '<i class="bi bi-share"></i><span class="action-count">' + (post.shares || 0) + '</span>' +
      '</button>' +
      '</div></div>';

    var commentsHtml = '<div class="comments-section-expandable" id="comments-' + post.id + '">' +
      '<div class="comments-container" id="comments-container-' + post.id + '"><div class="no-comments">No comments yet. Be the first!</div></div>' +
      '<div class="comment-form-expandable">' +
        '<input type="text" class="comment-input-expandable" placeholder="Write a comment..." id="comment-input-' + post.id + '">' +
        '<button type="button" class="comment-submit-btn" onclick="window.__submitComment(' + post.id + ')">Post</button>' +
      '</div></div>';

    el.innerHTML = postHeader
      + '<div class="post-body">'
      +   '<div class="post-content">' + formatted + '</div>'
      +   (needsSeeMore ? '<div class="see-more-container"><a href="javascript:void(0)" class="see-more-link" onclick="window.__viewPost(' + post.id + ')">See more <i class="bi bi-arrow-right"></i></a></div>' : '')
      +   mediaHtml
      +   pollHtml
      +   '<div class="post-stats-top" onclick="window.__viewPost(' + post.id + ')">'
      +     '<span class="post-view-link" style="color:var(--xpy-primary);font-weight:600;font-size:0.8rem;">View post <i class="bi bi-arrow-right-short"></i></span>'
      +     '<span class="post-views-count"><i class="bi bi-eye"></i> ' + (post.views || 0) + '</span>'
      +   '</div>'
      + '</div>'
      + postFooter
      + commentsHtml;

    setTimeout(function() {
      el.querySelectorAll('video').forEach(function(v) { if (typeof videoObserver !== 'undefined' && videoObserver) videoObserver.observe(v); });
    }, 100);
    if (typeof postObserver !== 'undefined' && postObserver) postObserver.observe(el);
    return el;
  }
  window.__confirmDeletePost = async function(postId) {
    const ok = await showDeleteConfirm();
    if (ok) window.__deletePost(postId);
  };
  window.__deletePost = async function(postId) {
    const el = document.querySelector(`.post-card-vertical[data-post-id="${postId}"]`);

    // Find profile post stat counter in horizontal strip
    let postStatEl = null;
    document.querySelectorAll('.xapyx-stat-card').forEach(function(card) {
      const label = card.querySelector('.xapyx-stat-label');
      if (label && label.textContent.trim().toLowerCase() === 'posts') {
        postStatEl = card.querySelector('.xapyx-stat-number');
      }
    });
    const prevStatCount = postStatEl ? (parseInt(postStatEl.textContent || '0', 10) || 0) : null;
    if (postStatEl && prevStatCount !== null) {
      postStatEl.textContent = Math.max(0, prevStatCount - 1);
    }

    // 0ms Optimistic collapse/hide
    let prevDisplay = '';
    if (el) {
      prevDisplay = el.style.display;
      el.style.transition = 'all 0.2s ease';
      el.style.opacity = '0';
      el.style.transform = 'scale(0.96)';
      setTimeout(() => {
        if (el && el.style.opacity === '0') {
          el.style.display = 'none';
        }
      }, 200);
    }

    try {
      const r = await csrfFetch('/api/posts/delete/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId, type: 'user' })
      });
      const d = await r.json();
      if (d.success) {
        if (el) {
          clearViewTimer(postId);
          if (postObserver) postObserver.unobserve(el);
          el.remove();
        }
        showAlert('Post deleted', 'success');
      } else {
        // Rollback on API failure
        if (el) {
          el.style.display = prevDisplay;
          setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = '';
          }, 10);
        }
        if (postStatEl && prevStatCount !== null) {
          postStatEl.textContent = prevStatCount;
        }
        showAlert(d.error || 'Failed to delete', 'error');
      }
    } catch (e) {
      // Rollback on network failure
      if (el) {
        el.style.display = prevDisplay;
        setTimeout(() => {
          el.style.opacity = '1';
          el.style.transform = '';
        }, 10);
      }
      if (postStatEl && prevStatCount !== null) {
        postStatEl.textContent = prevStatCount;
      }
      showAlert('Failed to delete', 'error');
    }
  };

  window.__reactPost = async function(postId, reaction) {
    try {
      const r = await csrfFetch('/api/posts/react/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId, reaction })
      });
      const d = await r.json();
      if (d.success) {
        const el = document.querySelector(`.post-card-vertical[data-post-id="${postId}"]`);
        if (el) {
          const lb = el.querySelector('.like-btn'), db = el.querySelector('.dislike-btn');
          lb.querySelector('.action-count').textContent = d.likes;
          db.querySelector('.action-count').textContent = d.dislikes;
          if (reaction === 'like') {
            if (d.user_reaction === 'like') {
              lb.classList.add('active'); lb.querySelector('i').className = 'bi bi-hand-thumbs-up-fill';
              db.classList.remove('active'); db.querySelector('i').className = 'bi bi-hand-thumbs-down';
            } else {
              lb.classList.remove('active'); lb.querySelector('i').className = 'bi bi-hand-thumbs-up';
            }
          } else {
            if (d.user_reaction === 'dislike') {
              db.classList.add('active'); db.querySelector('i').className = 'bi bi-hand-thumbs-down-fill';
              lb.classList.remove('active'); lb.querySelector('i').className = 'bi bi-hand-thumbs-up';
            } else {
              db.classList.remove('active'); db.querySelector('i').className = 'bi bi-hand-thumbs-down';
            }
          }
        }
      }
    } catch (e) { showAlert('Failed to react', 'error'); }
  };

  window.__toggleComments = async function(postId, event) {
    if (event) event.stopPropagation();
    const sec = document.getElementById(`comments-${postId}`);
    const isOpen = sec.classList.contains('expanded');
    document.querySelectorAll('.comments-section-expandable.expanded').forEach(s => {
      if (s.id !== `comments-${postId}`) s.classList.remove('expanded');
    });
    sec.classList.toggle('expanded');
    if (!isOpen) {
      await loadComments(postId);
      setTimeout(() => document.getElementById(`comment-input-${postId}`)?.focus(), 300);
    }
  };

  async function loadComments(postId, page = 1) {
    const c = document.getElementById(`comments-container-${postId}`);
    try {
      const r = await fetch(`/api/posts/comments/?post_id=${postId}&page=${page}&limit=10&type=user`);
      const d = await r.json();
      if (d.success) {
        c.innerHTML = '';
        if (!d.comments.length) {
          c.innerHTML = '<div class="no-comments">No comments yet. Be the first!</div>';
          return;
        }
        [...d.comments].reverse().forEach(cm => c.appendChild(createCommentElement(cm, postId)));
        if (d.total_comments > d.comments.length) {
          const b = document.createElement('a');
          b.href = 'javascript:void(0)';
          b.className = 'btn btn-sm btn-outline-primary w-100 mt-2';
          b.innerHTML = '<i class="bi bi-arrow-down"></i> Load more';
          b.onclick = () => loadComments(postId, page + 1);
          c.appendChild(b);
        }
      }
    } catch (e) { c.innerHTML = '<div class="no-comments">Error loading</div>'; }
  }

  function createCommentElement(comment) {
    var el = document.createElement('div');
    el.className = 'comment-item';
    el.dataset.commentId = comment.id;
    var userId = loggedUserId;
    var isOwner = comment.author.id === userId;
    var av = (comment.author && comment.author.picture) ? comment.author.picture : '/static/images/avatars/default.png';
    var avThumb = av;
    if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
      avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
    }
    el.innerHTML = '<img src="' + avThumb + '" data-full-src="' + av + '" width="44" height="44" onerror="this.onerror=null;this.src=\'' + av + '\'" class="comment-avatar">'
      + '<div class="comment-content">'
      +   '<div class="comment-header">'
      +     '<strong>' + escapeHtml(comment.author.name.split(' ')[0]) + '</strong>'
      +     '<span class="comment-meta">' + comment.time_ago + '</span>'
      +     (isOwner ? '<button class="comment-delete-btn" onclick="window.__deleteComment(' + comment.id + ', null)"><i class="bi bi-trash"></i></button>' : '')
      +   '</div>'
      +   '<div class="comment-text">' + formatMentions(comment.content) + '</div>'
      + '</div>';
    return el;
  }

  window.__submitComment = async function(postId) {
    const inp = document.getElementById(`comment-input-${postId}`);
    if (!inp) return;
    const btn = inp.nextElementSibling;
    const content = inp.value.trim();
    if (!content) { showAlert('Enter a comment', 'warning'); inp.focus(); return; }
    const mentions = extractMentions(content);
    const savedContent = content;
    inp.value = '';

    // Snapshot comment count
    const postEl = document.querySelector(`.post-card-vertical[data-post-id="${postId}"]`);
    const cc = postEl ? postEl.querySelector('.comment-btn .action-count') : null;
    const prevCount = cc ? parseInt(cc.textContent || '0', 10) : 0;
    if (cc) cc.textContent = prevCount + 1;

    // Optimistic comment DOM insertion
    const c = document.getElementById(`comments-container-${postId}`);
    const noC = c ? c.querySelector('.no-comments') : null;
    const wasNoC = Boolean(noC);
    if (noC) noC.style.display = 'none';

    const currentUserId = (typeof loggedUserId !== 'undefined' && loggedUserId) || (window.XPY_CONFIG && window.XPY_CONFIG.userId) || null;
    const currentUserPic = document.querySelector('.avatar-mini-img, .avatar-img, .profile-avatar-img')?.getAttribute('src') || '/static/images/avatars/default.png';
    const currentUserName = document.querySelector('.user-info h4, .profile-name')?.textContent.trim() || 'You';

    const tempId = 'temp-' + Date.now();
    const optimisticComment = {
      id: tempId,
      author: {
        id: currentUserId,
        name: currentUserName,
        username: (window.XPY_CONFIG && window.XPY_CONFIG.username) || currentUserName,
        picture: currentUserPic
      },
      content: savedContent,
      time_ago: 'Just now'
    };

    const tempEl = createCommentElement(optimisticComment);
    tempEl.style.opacity = '0.65';
    tempEl.style.transition = 'opacity 0.2s ease';
    tempEl.dataset.isOptimistic = 'true';
    if (c) c.appendChild(tempEl);

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    }

    try {
      const r = await csrfFetch('/api/posts/comments/add/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId, content: savedContent, mentions, type: 'user' })
      });
      const d = await r.json();
      if (d.success) {
        if (tempEl && tempEl.parentNode) {
          tempEl.style.opacity = '1';
          tempEl.dataset.commentId = d.comment.id;
          delete tempEl.dataset.isOptimistic;
          const delBtn = tempEl.querySelector('.comment-delete-btn');
          if (delBtn) {
            delBtn.setAttribute('onclick', 'window.__deleteComment(' + d.comment.id + ', null)');
          }
        }
        if (wasNoC && noC) noC.remove();
        showAlert('Comment posted!', 'success');
      } else {
        if (tempEl && tempEl.parentNode) tempEl.remove();
        if (wasNoC && noC) noC.style.display = '';
        if (cc) cc.textContent = prevCount;
        inp.value = savedContent;
        showAlert(d.error || 'Failed', 'error');
      }
    } catch (e) {
      if (tempEl && tempEl.parentNode) tempEl.remove();
      if (wasNoC && noC) noC.style.display = '';
      if (cc) cc.textContent = prevCount;
      inp.value = savedContent;
      showAlert('Failed', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'Post';
      }
      inp.focus();
    }
  };

  window.__deleteComment = async function(commentId, postId) {
    const ok = await showConfirm('Delete Comment', 'Are you sure you want to delete this comment?');
    if (!ok) return;
    try {
      const r = await csrfFetch('/api/posts/comments/delete/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment_id: commentId, post_id: postId, type: 'user' })
      });
      const d = await r.json();
      if (d.success) {
        document.querySelector(`.comments-item[data-comment-id="${commentId}"]`)?.remove();
        if (postId) {
          const postEl = document.querySelector(`.post-card-vertical[data-post-id="${postId}"] .comment-btn .action-count`);
          if (postEl) postEl.textContent = Math.max(0, parseInt(postEl.textContent) - 1);
        }
        showAlert('Comment deleted', 'success');
      } else showAlert(d.error || 'Failed', 'error');
    } catch (e) { showAlert('Failed', 'error'); }
  };

  window.__editPostModal = async function(postId) {
    editingPostId = postId;
    editFiles = [];
    try {
      const r = await fetch(`/api/posts/get/?post_id=${postId}`);
      const d = await r.json();
      if (d.success && d.post) {
        let c = (d.post.content || '').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'');
        document.getElementById('editPostContent').value = c;
        updateEditCharCount();
        if (d.post.media) d.post.media.forEach(m => editFiles.push({ type: m.type, url: m.url, preview: m.url, existing: true }));
        updateEditMediaPreview();
        new bootstrap.Modal(document.getElementById('editPostModal')).show();
      }
    } catch (e) { showAlert('Failed to load post', 'error'); }
  };

  async function savePostEdit() {
    if (!editingPostId) return;
    const content = document.getElementById('editPostContent').value.trim();
    if (!content && !editFiles.length) { showAlert('Content cannot be empty', 'warning'); return; }
    const mentions = extractMentions(content);
    const btn = document.getElementById('saveEditBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...';
    const fd = new FormData();
    fd.append('post_id', editingPostId);
    fd.append('content', content);
    fd.append('type', 'user');
    if (mentions.length) fd.append('mentions', JSON.stringify(mentions));
    const ex = editFiles.filter(m => m.existing).map(m => m.url);
    if (ex.length) fd.append('existing_media', ex.join(','));
    editFiles.filter(m => m.isNew && m.file).forEach(m => fd.append('new_media[]', m.file));
    try {
      const r = await csrfFetch('/api/posts/edit/', { method: 'POST', body: fd });
      const d = await r.json();
      if (d.success) {
        const old = document.querySelector(`.post-card-vertical[data-post-id="${editingPostId}"]`);
        if (old) old.replaceWith(createPostElement(d.post));
        showAlert('Post updated!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('editPostModal')).hide();
        editFiles = []; editingPostId = null;
      } else showAlert(d.error || 'Failed', 'error');
    } catch (e) { showAlert('Network error', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = 'Save Changes'; }
  }

  window.__votePoll = async function(postId, idx) {
    try {
      const r = await csrfFetch('/api/posts/vote/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId, option_index: idx })
      });
      const d = await r.json();
      if (d.success) location.reload();
      else showAlert(d.error || 'Failed to vote', 'error');
    } catch (e) { showAlert('Failed to vote', 'error'); }
  };

  window.__sharePost = function(postId) {
    const url = `${window.location.origin}/post/${postId}/`;
    if (navigator.share) navigator.share({ title: 'XAPYX Post', url }).catch(() => copyToClipboard(url));
    else copyToClipboard(url);
  };
  function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
      .then(() => showAlert('Link copied!', 'success'))
      .catch(() => showAlert('Failed to copy', 'error'));
  }

  /* ============================================================
     MEDIA VIEWER
     ============================================================ */
  window.__openMediaViewer = function(postId, index) {
    const el = document.querySelector(`.post-card-vertical[data-post-id="${postId}"]`);
    if (!el) return;
    const slider = el.querySelector(`#slider-${postId}`);
    if (!slider) return;
    let media;
    try { media = JSON.parse(slider.dataset.media); } catch (e) { return; }
    showMediaViewer(media, index);
  };

  function showMediaViewer(mediaArray, startIndex = 0) {
    let modalEl = document.getElementById('xpyMediaViewerModal');
    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.id = 'xpyMediaViewerModal';
      modalEl.className = 'modal fade';
      modalEl.tabIndex = -1;
      modalEl.innerHTML = `
        <div class="modal-dialog modal-xl modal-dialog-centered">
          <div class="modal-content" style="background:transparent;border:none;">
            <div class="modal-body p-0 position-relative">
              <button type="button" class="btn-close btn-close-white position-absolute"
                      style="top:16px;right:16px;z-index:10;background:rgba(0,0,0,0.6);padding:14px;border-radius:50%;"
                      data-bs-dismiss="modal" aria-label="Close"></button>
              <div id="xpyMediaCarousel" class="carousel slide" data-bs-ride="false">
                <div class="carousel-inner" id="xpyMediaCarouselInner"></div>
                <button class="carousel-control-prev" type="button" data-bs-target="#xpyMediaCarousel" data-bs-slide="prev"><span class="carousel-control-prev-icon"></span></button>
                <button class="carousel-control-next" type="button" data-bs-target="#xpyMediaCarousel" data-bs-slide="next"><span class="carousel-control-next-icon"></span></button>
                <div class="carousel-indicators" id="xpyMediaIndicators"></div>
              </div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(modalEl);
    }
    const inner = document.getElementById('xpyMediaCarouselInner');
    const inds = document.getElementById('xpyMediaIndicators');
    inner.innerHTML = '';
    inds.innerHTML = '';
    mediaArray.forEach((m, i) => {
      const item = document.createElement('div');
      item.className = 'carousel-item' + (i === startIndex ? ' active' : '');
      item.innerHTML = m.type === 'image'
        ? `<div class="d-flex align-items-center justify-content-center" style="height:75vh;background:#000;"><img src="${m.url}" style="max-height:75vh;max-width:100%;object-fit:contain;"></div>`
        : `<div class="d-flex align-items-center justify-content-center" style="height:75vh;background:#000;"><video controls autoplay style="max-height:75vh;max-width:100%;"><source src="${m.url}" type="${m.mime_type || 'video/mp4'}"></video></div>`;
      inner.appendChild(item);
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.bsTarget = '#xpyMediaCarousel';
      b.dataset.bsSlideTo = i;
      if (i === startIndex) b.className = 'active';
      inds.appendChild(b);
    });
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
    modalEl.addEventListener('hidden.bs.modal', function() {
      modalEl.querySelectorAll('video').forEach(v => v.pause());
    }, { once: true });
  }

  window.__slideMedia = function(postId, dir) {
    const s = document.querySelector(`#slider-${postId}`);
    if (!s) return;
    const items = s.querySelectorAll('.slider-item');
    const inds = s.querySelectorAll('.indicator');
    let a = Array.from(items).findIndex(i => i.classList.contains('active'));
    items[a].classList.remove('active');
    inds[a].classList.remove('active');
    let n = a + dir;
    if (n < 0) n = items.length - 1;
    if (n >= items.length) n = 0;
    items[n].classList.add('active');
    inds[n].classList.add('active');
  };
  window.__goToSlide = function(postId, i) {
    const s = document.querySelector(`#slider-${postId}`);
    if (!s) return;
    s.querySelectorAll('.slider-item, .indicator').forEach(el => el.classList.remove('active'));
    s.querySelectorAll('.slider-item')[i].classList.add('active');
    s.querySelectorAll('.indicator')[i].classList.add('active');
  };

  function prependPost(post) {
    const feed = document.getElementById('feedContainer');
    const el = createPostElement(post);
    feed.querySelector('.xapyx-empty-state')?.remove();
    feed.querySelector('.xapyx-empty-state')?.remove();
    feed.firstChild ? feed.insertBefore(el, feed.firstChild) : feed.appendChild(el);
    setTimeout(() => postObserver?.observe(el), 100);
  }

  function handleScroll() {
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500 && !isLoading && hasMorePosts) {
      loadPosts(false);
    }
  }

  /* ============================================================
     FRIEND / BLOCK
     ============================================================ */
  async function handleFriendAction() {
    const btn = document.getElementById('friendButton');
    if (friendStatus === 'accepted') {
      const ok = await showConfirm('Remove Friend', 'Remove this friend?');
      if (!ok) return;
      try {
        const r = await csrfFetch('/api/profile/action/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'remove_friend', friend_id: profileUserId })
        });
        const d = await r.json();
        if (d.success) {
          friendStatus = 'none';
          btn.innerHTML = '<i class="bi bi-person-plus"></i> Add Friend';
          btn.className = 'xapyx-friend-btn';
          showAlert('Friend removed', 'success');
        } else showAlert(d.error || 'Failed', 'error');
      } catch (e) { showAlert('Failed', 'error'); }
    } else if (friendStatus === 'pending') {
      const ok = await showConfirm('Cancel Request', 'Cancel this friend request?');
      if (!ok) return;
      try {
        const r = await csrfFetch('/api/profile/action/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel_friend_request', friend_id: profileUserId })
        });
        const d = await r.json();
        if (d.success) {
          friendStatus = 'none';
          btn.innerHTML = '<i class="bi bi-person-plus"></i> Add Friend';
          btn.className = 'xapyx-friend-btn';
          showAlert('Request cancelled', 'success');
        } else showAlert(d.error || 'Failed', 'error');
      } catch (e) { showAlert('Failed', 'error'); }
    } else {
      try {
        const r = await csrfFetch('/api/profile/action/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'send_friend_request', receiver_id: profileUserId })
        });
        const d = await r.json();
        if (d.success) {
          friendStatus = 'pending';
          btn.innerHTML = '<i class="bi bi-clock"></i> Request Sent';
          btn.className = 'xapyx-friend-btn pending';
          showAlert('Friend request sent', 'success');
        } else showAlert(d.error || 'Failed', 'error');
      } catch (e) { showAlert('Failed', 'error'); }
    }
  }

  window.toggleBlock = async function() {
    if (loggedUserHasBlocked) {
      const ok = await showConfirm('Unblock User', 'Unblock this user?');
      if (!ok) return;
      try {
        const r = await csrfFetch('/api/profile/action/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'unblock_user', user_id: profileUserId })
        });
        const d = await r.json();
        if (d.success) { showAlert('Unblocked', 'success'); setTimeout(() => location.reload(), 800); }
        else showAlert(d.error || 'Failed', 'error');
      } catch (e) { showAlert('Failed', 'error'); }
    } else {
      const ok = await showConfirm('Block User', "Block this user? You won't see their content.");
      if (!ok) return;
      try {
        const r = await csrfFetch('/api/profile/action/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'block_user', user_id: profileUserId })
        });
        const d = await r.json();
        if (d.success) { showAlert('Blocked', 'success'); setTimeout(() => location.reload(), 800); }
        else showAlert(d.error || 'Failed', 'error');
      } catch (e) { showAlert('Failed', 'error'); }
    }
  };

  window.sendMessage = function() {
    window.location.href = `/chat/?user_id=${profileUserId}`;
  };

  /* ============================================================
     PROFILE EDIT
     ============================================================ */
  async function saveProfile() {
    const btn = document.getElementById('saveProfileBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...';
    const fd = new FormData();
    fd.append('action', 'update_profile');
    fd.append('name', document.getElementById('editName').value);
    fd.append('location', document.getElementById('editLocation').value);
    fd.append('gender', document.getElementById('editGender').value);
    fd.append('website', document.getElementById('editWebsite').value);
    fd.append('about_me', document.getElementById('editAbout').value);
    fd.append('facebook', document.getElementById('editFacebook').value);
    fd.append('twitter', document.getElementById('editTwitter').value);
    fd.append('instagram', document.getElementById('editInstagram').value);
    fd.append('linkedin', document.getElementById('editLinkedin').value);
    fd.append('youtube', document.getElementById('editYoutube').value);
    try {
      const r = await csrfFetch('/api/profile/action/', { method: 'POST', body: fd });
      const d = await r.json();
      if (d.success) {
        showAlert('Profile updated!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('editProfileModal')).hide();
        setTimeout(() => location.reload(), 1000);
      } else showAlert(d.error || 'Failed', 'error');
    } catch (e) { showAlert('Network error', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = 'Save Changes'; }
  }

  /* ============================================================
     PROFILE PICTURE & CROPPER (Task 20)
     ============================================================ */
  let currentCropper = null;
  let currentCropUrl = null;

  function destroyCropper() {
    if (currentCropper) {
      try { currentCropper.destroy(); } catch (e) {}
      currentCropper = null;
    }
    if (currentCropUrl) {
      try { URL.revokeObjectURL(currentCropUrl); } catch (e) {}
      currentCropUrl = null;
    }
    const img = document.getElementById('cropImage');
    if (img) img.src = '';
  }

  window.openProfilePictureModal = function() {
    new bootstrap.Modal(document.getElementById('profilePictureModal')).show();
  };

  window.previewProfilePicture = function(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!f.type.match('image.*')) { showAlert('Please select an image', 'error'); return; }
    if (f.size > 5 * 1024 * 1024) { showAlert('Max 5MB', 'error'); return; }

    const cropModalEl = document.getElementById('cropModal');
    // Fallback if Cropper is unavailable or modal missing
    if (typeof Cropper === 'undefined' || !cropModalEl) {
      const rd = new FileReader();
      rd.onload = ev => {
        document.getElementById('profilePicturePreview').src = ev.target.result;
        document.getElementById('savePictureSection').classList.remove('d-none');
        newProfilePicture = f;
      };
      rd.readAsDataURL(f);
      return;
    }

    destroyCropper();
    currentCropUrl = URL.createObjectURL(f);
    const cropImg = document.getElementById('cropImage');
    if (cropImg) {
      cropImg.src = currentCropUrl;
    }

    let cropModalInstance = bootstrap.Modal.getInstance(cropModalEl);
    if (!cropModalInstance) {
      cropModalInstance = new bootstrap.Modal(cropModalEl, {
        backdrop: 'static',
        keyboard: false
      });
    }
    cropModalInstance.show();
  };

  function setupCropModalListeners() {
    const cropModalEl = document.getElementById('cropModal');
    if (!cropModalEl) return;

    cropModalEl.addEventListener('shown.bs.modal', function() {
      const cropImg = document.getElementById('cropImage');
      if (!cropImg || !cropImg.src) return;
      if (currentCropper) {
        try { currentCropper.destroy(); } catch (e) {}
        currentCropper = null;
      }
      currentCropper = new Cropper(cropImg, {
        aspectRatio: 1,
        viewMode: 1,
        autoCropArea: 0.9,
        guides: true,
        rotatable: true,
        zoomable: true,
        scalable: false,
        cropBoxResizable: true,
        responsive: true
      });
    });

    cropModalEl.addEventListener('hidden.bs.modal', function() {
      destroyCropper();
      const fileInput = document.getElementById('uploadProfilePicture');
      if (fileInput) fileInput.value = '';
      const profileModalEl = document.getElementById('profilePictureModal');
      if (profileModalEl && profileModalEl.classList.contains('show')) {
        document.body.classList.add('modal-open');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupCropModalListeners);
  } else {
    setupCropModalListeners();
  }

  window.cancelCrop = function() {
    const cropModalEl = document.getElementById('cropModal');
    if (cropModalEl) {
      const cropModalInstance = bootstrap.Modal.getInstance(cropModalEl);
      if (cropModalInstance) cropModalInstance.hide();
    }
    destroyCropper();
    const fileInput = document.getElementById('uploadProfilePicture');
    if (fileInput) fileInput.value = '';
    const profileModalEl = document.getElementById('profilePictureModal');
    if (profileModalEl && profileModalEl.classList.contains('show')) {
      document.body.classList.add('modal-open');
    }
  };

  window.cropAndSave = async function() {
    if (!currentCropper) {
      showAlert('Crop tool is not ready', 'error');
      return;
    }
    const btn = document.getElementById('cropAndSaveBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Uploading...';

    const canvas = currentCropper.getCroppedCanvas({
      width: 512,
      height: 512,
      imageSmoothingQuality: 'high'
    });

    if (!canvas) {
      showAlert('Could not create cropped canvas', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i> Crop & Save';
      return;
    }

    canvas.toBlob(async function(blob) {
      if (!blob) {
        showAlert('Could not process cropped image', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i> Crop & Save';
        return;
      }

      const croppedFile = new File([blob], 'profile.jpg', { type: 'image/jpeg' });

      try {
        let r, d;
        if (typeof uploadFileDirect === 'function') {
          // Direct S3 Upload flow (skip crop hook as already cropped)
          const upRes = await uploadFileDirect(croppedFile, 'profile', { skipCrop: true });
          if (!upRes || !upRes.key) throw new Error('Upload to S3 failed');
          r = await csrfFetch('/api/profile/action/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update_profile_picture',
              s3_key: upRes.key
            })
          });
        } else {
          // Fallback: multipart
          const fd = new FormData();
          fd.append('action', 'update_profile_picture');
          fd.append('profile_picture', croppedFile);
          r = await csrfFetch('/api/profile/action/', { method: 'POST', body: fd });
        }

        d = await r.json();
        if (d.success) {
          showAlert('Profile picture updated!', 'success');

          // Close crop modal
          const cropModalEl = document.getElementById('cropModal');
          if (cropModalEl) {
            const cropModalInstance = bootstrap.Modal.getInstance(cropModalEl);
            if (cropModalInstance) cropModalInstance.hide();
          }
          destroyCropper();

          // Reset file input
          const fileInput = document.getElementById('uploadProfilePicture');
          if (fileInput) fileInput.value = '';

          // Update avatars across the page (preview, main pic, header, sidebar)
          const newUrl = d.picture_url;
          if (newUrl) {
            const mainPic = document.getElementById('profilePicture');
            if (mainPic) mainPic.src = newUrl;

            const previewPic = document.getElementById('profilePicturePreview');
            if (previewPic) previewPic.src = newUrl;

            document.querySelectorAll('.avatar-mini-img').forEach(el => el.src = newUrl);
            document.querySelectorAll('.avatar-img').forEach(el => el.src = newUrl);
            document.querySelectorAll('.xapyx-create-post-avatar').forEach(el => el.src = newUrl);
          }

          const removeBtn = document.getElementById('removeProfilePictureBtn');
          if (removeBtn) removeBtn.disabled = false;

          const saveSec = document.getElementById('savePictureSection');
          if (saveSec) saveSec.classList.add('d-none');

          // Close profile picture modal as flow completed
          const profileModalEl = document.getElementById('profilePictureModal');
          if (profileModalEl) {
            const profileModalInstance = bootstrap.Modal.getInstance(profileModalEl);
            if (profileModalInstance) profileModalInstance.hide();
          }
          newProfilePicture = null;
        } else {
          showAlert(d.error || 'Failed to update profile picture', 'error');
        }
      } catch (err) {
        showAlert(err.message || 'Network error during upload', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i> Crop & Save';
      }
    }, 'image/jpeg', 0.9);
  };

  window.saveProfilePicture = async function() {
    if (!newProfilePicture) return;
    const btn = document.querySelector('#savePictureSection .btn-success');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

    try {
      let r, d;
      if (typeof uploadFileDirect === 'function') {
        const upRes = await uploadFileDirect(newProfilePicture, 'profile', { skipCrop: true });
        r = await csrfFetch('/api/profile/action/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update_profile_picture',
            s3_key: upRes.key
          })
        });
      } else {
        const fd = new FormData();
        fd.append('action', 'update_profile_picture');
        fd.append('profile_picture', newProfilePicture);
        r = await csrfFetch('/api/profile/action/', { method: 'POST', body: fd });
      }
      d = await r.json();
      if (d.success) {
        showAlert('Profile picture updated!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('profilePictureModal')).hide();
        document.getElementById('profilePicture').src = d.picture_url;
        document.getElementById('profilePicturePreview').src = d.picture_url;
        document.querySelectorAll('.avatar-mini-img').forEach(el => el.src = d.picture_url);
        document.querySelectorAll('.avatar-img').forEach(el => el.src = d.picture_url);
        document.querySelectorAll('.xapyx-create-post-avatar').forEach(el => el.src = d.picture_url);
        document.getElementById('removeProfilePictureBtn').disabled = false;
        newProfilePicture = null;
      } else showAlert(d.error || 'Failed', 'error');
    } catch (e) { showAlert('Network error', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-circle"></i> Save Changes'; }
  };

  window.removeProfilePicture = async function() {
    const ok = await showConfirm('Remove Profile Picture', 'Remove your profile picture?');
    if (!ok) return;
    const btn = document.getElementById('removeProfilePictureBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    try {
      const r = await csrfFetch('/api/profile/action/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove_profile_picture' })
      });
      const d = await r.json();
      if (d.success) {
        showAlert('Picture removed', 'success');
        const def = DEFAULT_AVATAR;
        document.getElementById('profilePicture').src = def;
        document.getElementById('profilePicturePreview').src = def;
        document.querySelectorAll('.avatar-mini-img').forEach(el => el.src = def);
        document.querySelectorAll('.avatar-img').forEach(el => el.src = def);
        document.querySelectorAll('.xapyx-create-post-avatar').forEach(el => el.src = def);
        btn.disabled = true;
        newProfilePicture = null;
      } else showAlert(d.error || 'Failed', 'error');
    } catch (e) { showAlert('Failed', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="bi bi-trash"></i> Remove'; }
  };

  window.cancelProfilePictureUpload = function() {
    document.getElementById('profilePicturePreview').src = document.getElementById('profilePicture').src;
    document.getElementById('savePictureSection').classList.add('d-none');
    document.getElementById('uploadProfilePicture').value = '';
    newProfilePicture = null;
  };

  /* ============================================================
     CLEANUP
     ============================================================ */
  window.addEventListener('beforeunload', function() {
    postViewTimeouts.forEach(t => clearTimeout(t));
    if (postObserver) postObserver.disconnect();
  });

    /* ============================================================
     GLOBAL EXPOSURES
     (Functions called from inline onclick/onchange in templates
     OR from base_dashboard.html must be attached to window.)
     ============================================================ */
  window.handleEditMediaSelect = handleEditMediaSelect;
  window.handleMediaSelect     = handleMediaSelect;
  window.removeEditMedia       = window.__removeEditMedia;   // if not already exposed
  window.removeMedia           = window.__removeMedia;       // if not already exposed
  window.createPostElement     = createPostElement;
  window.loadComments          = loadComments;
  window.saveProfile           = saveProfile;
  window.savePostEdit          = savePostEdit;
  window.prependPost           = prependPost;
  window.setupViewTracking     = setupViewTracking;
  window.recordView            = recordView;
  window.updatePostViewCount   = updatePostViewCount;
  window.extractMentions       = extractMentions;
  window.formatMentions        = formatMentions;
  window.toggleComments        = window.__toggleComments;
  window.submitComment         = window.__submitComment;
  window.deleteComment         = window.__deleteComment;
  window.editPostModal         = window.__editPostModal;
  window.confirmDeletePost     = window.__confirmDeletePost;
  window.deletePost            = window.__deletePost;
  window.reactPost             = window.__reactPost;
  window.votePoll              = window.__votePoll;
  window.sharePost             = window.__sharePost;
  window.openMediaViewer       = window.__openMediaViewer;
  window.slideMedia            = window.__slideMedia;
  window.goToSlide             = window.__goToSlide;
  window.cancelCrop            = cancelCrop;
  window.cropAndSave           = cropAndSave;
  window.previewProfilePicture = previewProfilePicture;
  window.openProfilePictureModal = openProfilePictureModal;

  window.__viewPost = window.__viewPost || function(postId) {
  window.location.href = '/post/' + postId + '/';
  };

  window.toggleVideoSound = window.toggleVideoSound || function(video, event) {
    if (event && event.target !== video) return;
    video.muted = !video.muted;
    if (!video.muted) {
      video.style.transition = 'transform 0.15s ease';
      video.style.transform = 'scale(1.02)';
      setTimeout(function() { video.style.transform = ''; }, 150);
    }
  };
  window.__viewPost = window.__viewPost || function(postId) {
  window.location.href = '/post/' + postId + '/';
  };
})();


let profileVideoObserver = null;
function setupProfileVideoScrollTracking() {
    if (profileVideoObserver) profileVideoObserver.disconnect();
    profileVideoObserver = new IntersectionObserver(function(entries) {
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
    document.querySelectorAll('.post-card-vertical video').forEach(function(v) {
        profileVideoObserver.observe(v);
    });
}
