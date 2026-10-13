/* ============================================================
   GROUPS — list page
   ============================================================ */
(function () {
  'use strict';

  function setButtonLoading(btn, loading, loadingText) {
    if (!btn) return;
    if (loading) {
      if (!btn.dataset.origHtml) {
        btn.dataset.origHtml = btn.innerHTML;
        btn.dataset.origWidth = btn.offsetWidth + 'px';
      }
      btn.style.minWidth = btn.dataset.origWidth;
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-spinner"></span> ' + (loadingText || 'Saving...');
    } else {
      btn.disabled = false;
      if (btn.dataset.origHtml) {
        btn.innerHTML = btn.dataset.origHtml;
        delete btn.dataset.origHtml;
      }
      btn.style.minWidth = '';
    }
  }


  const CFG = window.GRP_CONFIG || {};
  const USER_ID = CFG.userId;
  let groups = CFG.groups || [];
  let currentFilter = 'all';
  let deleteTargetId = null;
  let joinRequestGroupId = null;

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

  async function postForm(url, formData) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'X-CSRFToken': getCsrfToken() },
      body: formData,
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

  // ---- Render ----
  function renderGrid() {
    const container = document.getElementById('grpContainer');
    const filtered = applyFilter(groups, currentFilter);
    const searchTerm = (document.getElementById('grpSearchInput').value || '').toLowerCase().trim();
    const visible = searchTerm
      ? filtered.filter(g => g.title.toLowerCase().includes(searchTerm))
      : filtered;

    if (!visible.length) {
      container.innerHTML =
        '<div class="grp-empty">'
        + '<div class="grp-empty-icon"><i class="bi bi-people"></i></div>'
        + '<h3>' + (groups.length ? 'No groups match' : 'No groups yet') + '</h3>'
        + '<p>' + (groups.length ? 'Try a different filter or search term.' : 'Be the first to create one!') + '</p>'
        + (groups.length ? '' : '<button class="grp-btn" onclick="grpOpenCreateModal()"><i class="bi bi-plus-circle"></i> Create First Group</button>')
        + '</div>';
      return;
    }

    container.innerHTML = visible.map(renderCard).join('');
  }

  function applyFilter(list, filter) {
    if (filter === 'my') {
      return list.filter(g => g.join_status === 'creator' || g.join_status === 'member');
    }
    if (filter === 'pending') {
      return list.filter(g => g.join_status === 'pending' || g.join_status === 'requested');
    }
    return list;
  }

  function renderCard(g) {
    const isCreator = g.join_status === 'creator';
    const isMember = g.join_status === 'member';
    const isPending = g.join_status === 'pending';
    const isRequested = g.join_status === 'requested';

    let badges = '';
    if (isCreator) badges += '<span class="grp-badge-member creator"><i class="bi bi-star-fill"></i> Creator</span>';
    else if (isMember) badges += '<span class="grp-badge-member member"><i class="bi bi-check"></i> Member</span>';
    else if (isPending) badges += '<span class="grp-badge-member pending"><i class="bi bi-clock"></i> Pending</span>';
    else if (isRequested) badges += '<span class="grp-badge-member pending"><i class="bi bi-send"></i> Requested</span>';

    let actions = '';
    if (isCreator) {
      actions =
        '<div class="grp-creator-actions">'
        + '<button class="grp-btn grp-btn-edit" onclick="grpOpenEditModal(' + g.id + '); event.stopPropagation();"><i class="bi bi-pencil"></i> Edit</button>'
        + '<button class="grp-btn grp-btn-delete" onclick="grpConfirmDelete(' + g.id + '); event.stopPropagation();"><i class="bi bi-trash"></i></button>'
        + (g.pending_post_count > 0
            ? '<button class="grp-btn grp-btn-pending" onclick="grpOpenPending(' + g.id + ', \'' + escapeHtml(g.title).replace(/'/g, '&#39;') + '\'); event.stopPropagation();"><i class="bi bi-clock-history"></i> ' + g.pending_post_count + '</button>'
            : '')
        + '</div>';
    } else if (isMember || isPending) {
      actions =
        '<button class="grp-btn grp-btn-leave" onclick="grpLeave(' + g.id + '); event.stopPropagation();">'
        + '<i class="bi bi-box-arrow-right"></i> ' + (isPending ? 'Cancel Request' : 'Leave')
        + '</button>';
    } else if (isRequested) {
      actions = '<button class="grp-btn grp-btn-secondary" disabled><i class="bi bi-clock"></i> Pending</button>';
    } else {
      actions =
        '<button class="grp-btn grp-btn-join" onclick="grpJoin(' + g.id + ', \'' + g.privacy + '\'); event.stopPropagation();">'
        + '<i class="bi bi-plus"></i> ' + (g.privacy === 'private' ? 'Request to Join' : 'Join')
        + '</button>';
    }

    const pendingBadge = (isCreator && g.pending_post_count > 0)
      ? '<div class="grp-badge-pending"><i class="bi bi-clock-history"></i> ' + g.pending_post_count + '</div>'
      : '';

    return '<div class="grp-card" onclick="window.location.href=\'/groups/' + g.id + '/\'">'
      + '<div class="grp-cover">'
      +   '<img src="' + g.cover_image_url + '" alt="" loading="lazy" onerror="this.src=\'/static/images/avatars/default.png\'">'
      +   '<div class="grp-badge-privacy ' + g.privacy + '">'
      +     '<i class="bi bi-' + (g.privacy === 'private' ? 'lock-fill' : 'globe2') + '"></i> ' + g.privacy
      +   '</div>'
      +   (g.post_approval ? '<div class="grp-badge-approval"><i class="bi bi-shield-check"></i> Approval</div>' : '')
      +   pendingBadge
      + '</div>'
      + '<div class="grp-card-header">'
      +   '<div class="grp-profile">'
      +     '<img src="' + g.profile_image_url + '" alt="" onerror="this.src=\'/static/images/avatars/default.png\'">'
      +   '</div>'
      +   '<div class="grp-info">'
      +     '<h3 class="grp-title">' + escapeHtml(g.title) + ' ' + badges + '</h3>'
      +     '<p class="grp-description">' + escapeHtml(g.description || 'No description') + '</p>'
      +     '<div class="grp-meta">'
      +       '<div class="grp-meta-creator">'
      +         (function() {
                  var cav = g.creator_picture_url || '/static/images/avatars/default.png';
                  var cavThumb = cav;
                  if (cav && /\.(jpg|jpeg|png|gif|webp)$/i.test(cav) && !cav.includes('_avatar.webp') && !cav.includes('default.png') && !cav.includes('avatar.png')) {
                    cavThumb = cav.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
                  }
                  return '<img src="' + cavThumb + '" width="40" height="40" onerror="this.onerror=null;this.src=\'' + cav + '\'" alt="">';
                })()
      +         '<span>By ' + escapeHtml(g.creator_name) + '</span>'
      +       '</div>'
      +       '<div class="grp-meta-activity"><i class="bi bi-clock"></i> ' + escapeHtml(g.last_activity_formatted) + '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>'
      + '<div class="grp-stats">'
      +   '<div class="grp-stat-item"><i class="bi bi-people"></i><span>' + g.member_count + ' members</span></div>'
      +   '<div class="grp-stat-item"><i class="bi bi-chat"></i><span>' + g.post_count + ' posts</span></div>'
      +   '<div class="grp-stat-item"><i class="bi bi-heart"></i><span>0 likes</span></div>'
      + '</div>'
      + '<div class="grp-actions" onclick="event.stopPropagation();">' + actions + '</div>'
      + '</div>';
  }

  // ---- Filter / search ----
  function setupFilters() {
    document.querySelectorAll('.grp-filter-tab').forEach(tab => {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.grp-filter-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        currentFilter = this.dataset.filter;
        renderGrid();
      });
    });
    let timer = null;
    document.getElementById('grpSearchInput').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(renderGrid, 200);
    });
  }

  // ---- Data refresh ----
  async function refreshGroups() {
    try {
      const r = await fetch('/api/groups/list/');
      const d = await r.json();
      if (d.success) {
        groups = d.groups;
        updateStats();
        renderGrid();
      }
    } catch (e) {
      console.warn('refresh failed', e);
    }
  }

  function updateStats() {
    let total = groups.length;
    let totalPosts = 0, totalMembers = 0, myGroups = 0;
    groups.forEach(g => {
      totalPosts += g.post_count;
      totalMembers += g.member_count;
      if (g.join_status === 'creator' || g.join_status === 'member') myGroups++;
    });
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('grpStatTotalGroups', total);
    set('grpStatTotalPosts', totalPosts);
    set('grpStatMyGroups', myGroups);
    set('grpStatTotalMembers', totalMembers);
    // Right-widget mini stats
    set('widgetTotalGroups', total);
    set('widgetMyGroups', myGroups);
    set('widgetTotalPosts', totalPosts);
    set('widgetMyGroupsOrbit', myGroups);
  }

  // ---- Create ----
  window.grpOpenCreateModal = function () {
    const form = document.getElementById('grpCreateForm');
    form.reset();
    document.getElementById('grpProfilePreview').innerHTML = '<i class="bi bi-camera"></i><span>Click to upload</span><small>400×400px recommended</small>';
    document.getElementById('grpCoverPreview').innerHTML = '<i class="bi bi-image"></i><span>Click to upload</span><small>1500×500px recommended</small>';
    new bootstrap.Modal(document.getElementById('grpCreateModal')).show();
  };

  window.grpSubmitCreate = async function (e) {
    e.preventDefault();
    const form = e.target;
    const btn = document.getElementById('grpCreateSubmit');
    setButtonLoading(btn, true, 'Creating...');
    try {
      const fd = new FormData(form);
      const d = await postForm('/api/groups/create/', fd);
      if (d.success) {
        toast('Group created successfully!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('grpCreateModal')).hide();
        await refreshGroups();
      } else {
        toast(d.error || 'Failed', 'error');
      }
    } catch (err) {
      toast('Network error', 'error');
    } finally {
      setButtonLoading(btn, false);
    }
  };

  // ---- Image previews ----
  function setupImagePreviews() {
    ['grpProfileInput', 'grpCoverInput', 'grpEditProfileInput', 'grpEditCoverInput'].forEach(id => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('change', function () {
        const file = this.files[0];
        if (!file) return;
        const previewId = id.replace('Input', 'Preview');
        const preview = document.getElementById(previewId);
        if (!preview) return;
        const reader = new FileReader();
        reader.onload = e => {
          preview.innerHTML = '<img src="' + e.target.result + '" alt="">';
        };
        reader.readAsDataURL(file);
      });
    });
  }

  // ---- Edit ----
  window.grpOpenEditModal = function (groupId) {
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    document.getElementById('grpEditId').value = g.id;
    document.getElementById('grpEditTitle').value = g.title;
    document.getElementById('grpEditDescription').value = g.description || '';
    document.getElementById('grpEditPrivacy').value = g.privacy;
    document.getElementById('grpEditPostApproval').value = String(g.post_approval);
    document.getElementById('grpEditProfilePreview').innerHTML = '<i class="bi bi-arrow-repeat"></i><span>Click to change</span>';
    document.getElementById('grpEditCoverPreview').innerHTML = '<i class="bi bi-arrow-repeat"></i><span>Click to change</span>';
    document.getElementById('grpEditProfileInput').value = '';
    document.getElementById('grpEditCoverInput').value = '';
    new bootstrap.Modal(document.getElementById('grpEditModal')).show();
  };

  window.grpSubmitEdit = async function (e) {
    e.preventDefault();
    const form = e.target;
    const gid = document.getElementById('grpEditId').value;
    const btn = document.getElementById('grpEditSubmit');
    setButtonLoading(btn, true, 'Saving...');
    try {
      const fd = new FormData(form);
      const d = await postForm('/api/groups/' + gid + '/edit/', fd);
      if (d.success) {
        toast('Group updated!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('grpEditModal')).hide();
        await refreshGroups();
      } else {
        toast(d.error || 'Failed', 'error');
      }
    } catch (err) {
      toast('Network error', 'error');
    } finally {
      setButtonLoading(btn, false);
    }
  };

  // ---- Delete ----
  window.grpConfirmDelete = function (groupId) {
    deleteTargetId = groupId;
    const overlay = document.getElementById('customConfirmOverlay');
    const box = document.getElementById('grpDeleteConfirmBox');
    overlay.classList.add('show');
    box.classList.add('show');

    const cleanup = () => {
      overlay.classList.remove('show');
      box.classList.remove('show');
    };
    const ok = document.getElementById('grpDeleteOk');
    const cancel = document.getElementById('grpDeleteCancel');
    ok.onclick = async () => {
      cleanup();
      const r = await postJSON('/api/groups/' + deleteTargetId + '/delete/', {});
      if (r.success) {
        toast('Group deleted', 'success');
        await refreshGroups();
      } else {
        toast(r.error || 'Failed', 'error');
      }
    };
    cancel.onclick = cleanup;
    overlay.onclick = cleanup;
  };

  // ---- Join / leave / request ----
  window.grpJoin = async function (groupId, privacy) {
    if (privacy === 'private') {
      joinRequestGroupId = groupId;
      document.getElementById('grpJoinRequestMsg').value = '';
      new bootstrap.Modal(document.getElementById('grpJoinRequestModal')).show();
      return;
    }
    const r = await postJSON('/api/groups/' + groupId + '/join/', {});
    if (r.success) {
      toast('Joined!', 'success');
      await refreshGroups();
    } else {
      toast(r.error || 'Failed', 'error');
    }
  };

  window.grpSubmitJoinRequest = async function () {
    if (!joinRequestGroupId) return;
    const message = document.getElementById('grpJoinRequestMsg').value.trim();
    const btn = document.getElementById('grpJoinRequestSubmit');
    setButtonLoading(btn, true, 'Sending...');
    try {
      const r = await postJSON('/api/groups/' + joinRequestGroupId + '/request-join/', { message });
      if (r.success) {
        toast('Request sent!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('grpJoinRequestModal')).hide();
        await refreshGroups();
      } else {
        toast(r.error || 'Failed', 'error');
      }
    } finally {
      setButtonLoading(btn, false);
    }
  };

  window.grpLeave = async function (groupId) {
    const g = groups.find(x => x.id === groupId);
    const isPending = g && (g.join_status === 'pending' || g.join_status === 'requested');
    const ok = await confirmDialog(
      isPending ? 'Cancel Request' : 'Leave Group',
      isPending ? 'Cancel your join request?' : 'Leave this group?'
    );
    if (!ok) return;
    const r = await postJSON('/api/groups/' + groupId + '/leave/', {});
    if (r.success) {
      toast(isPending ? 'Request cancelled' : 'Left group', 'success');
      await refreshGroups();
    } else {
      toast(r.error || 'Failed', 'error');
    }
  };

  // ---- Pending posts ----
  window.grpOpenPending = function (groupId, title) {
    document.getElementById('grpPendingGroupTitle').textContent = title;
    document.getElementById('grpPendingList').innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';
    const modal = new bootstrap.Modal(document.getElementById('grpPendingModal'));
    modal.show();
    loadPendingPosts(groupId);
  };

  async function loadPendingPosts(groupId) {
    const container = document.getElementById('grpPendingList');
    try {
      const r = await fetch('/api/groups/' + groupId + '/pending-posts/');
      const d = await r.json();
      if (!d.success) {
        container.innerHTML = '<div class="text-center py-4 text-danger">' + escapeHtml(d.error || 'Failed') + '</div>';
        return;
      }
      if (!d.posts.length) {
        container.innerHTML = '<div class="text-center py-5"><i class="bi bi-check-circle text-success" style="font-size:2.5rem;"></i><h5 class="mt-3" style="color:var(--xpy-text);">No pending posts</h5></div>';
        return;
      }
      container.innerHTML = d.posts.map(p => {
        var av = (p.author && p.author.picture) ? p.author.picture : '/static/images/avatars/default.png';
        var avThumb = av;
        if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
          avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
        }
        return `
        <div class="grp-pending-item" data-post-id="${p.id}">
          <div class="grp-pending-author">
            <img src="${avThumb}" width="40" height="40" onerror="this.onerror=null;this.src='${av}'">
            <div><strong>${escapeHtml(p.author.name)}</strong><span>${escapeHtml(p.time_ago)}</span></div>
          </div>
          <div class="grp-pending-content">${escapeHtml(p.content || '(no text)')}</div>
          ${p.has_media ? '<div style="margin-bottom:10px;color:var(--xpy-text-muted);font-size:0.8rem;"><i class="bi bi-image"></i> Contains media</div>' : ''}
          <div class="grp-pending-actions">
            <button class="approve" onclick="grpApprovePost(${p.id}, this)"><i class="bi bi-check-circle"></i> Approve</button>
            <button class="reject" onclick="grpRejectPost(${p.id}, this)"><i class="bi bi-x-circle"></i> Reject</button>
          </div>
        </div>`;
      }).join('');
    } catch (e) {
      container.innerHTML = '<div class="text-center py-4 text-danger">Network error</div>';
    }
  }

  window.grpApprovePost = async function (postId, btn) {
    btn.disabled = true;
    const r = await postJSON('/api/groups/posts/' + postId + '/approve/', {});
    if (r.success) {
      toast('Post approved', 'success');
      const item = btn.closest('.grp-pending-item');
      if (item) item.remove();
      refreshGroups();
    } else {
      toast(r.error || 'Failed', 'error');
      btn.disabled = false;
    }
  };

  window.grpRejectPost = async function (postId, btn) {
    btn.disabled = true;
    const r = await postJSON('/api/groups/posts/' + postId + '/reject/', {});
    if (r.success) {
      toast('Post rejected', 'info');
      const item = btn.closest('.grp-pending-item');
      if (item) item.remove();
      refreshGroups();
    } else {
      toast(r.error || 'Failed', 'error');
      btn.disabled = false;
    }
  };

  // ---- Init ----
  document.addEventListener('DOMContentLoaded', function () {
    setupFilters();
    setupImagePreviews();
    renderGrid();
  });
})();