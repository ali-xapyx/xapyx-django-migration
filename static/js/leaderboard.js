/* ============================================================
   LEADERBOARD — real-time polling
   ============================================================ */
(function () {
  'use strict';

  const CFG = window.LB_CONFIG || {};
  const isAdmin = !!CFG.isAdmin;
  const userId = CFG.userId;

  let refreshInterval = null;
  let currentStatus = CFG.status;

  function getCsrfToken() {
    const m = document.cookie.match(/csrftoken=([^;]+)/);
    return m ? m[1] : '';
  }

  async function postForm(url, data) {
    const body = new URLSearchParams(data).toString();
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRFToken': getCsrfToken(),
      },
      body,
    });
    return r.json();
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

  // ---- Confirm dialog ----
  function showConfirm(title, message) {
    return new Promise(resolve => {
      const overlay = document.getElementById('lbConfirmOverlay');
      const box = document.getElementById('lbConfirmBox');
      const t = document.getElementById('lbConfirmTitle');
      const m = document.getElementById('lbConfirmMessage');
      const cancel = document.getElementById('lbConfirmCancel');
      const ok = document.getElementById('lbConfirmOk');
      if (!overlay || !box) { resolve(window.confirm(message)); return; }

      t.textContent = title;
      m.textContent = message;
      overlay.classList.add('show');
      box.classList.add('show');

      const cleanup = () => {
        overlay.classList.remove('show');
        box.classList.remove('show');
        cancel.onclick = null;
        ok.onclick = null;
        overlay.onclick = null;
      };
      cancel.onclick = () => { cleanup(); resolve(false); };
      overlay.onclick = () => { cleanup(); resolve(false); };
      ok.onclick = () => { cleanup(); resolve(true); };
    });
  }

  // ---- Modal helpers ----
  window.lbOpenModal = function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('show');
    document.body.style.overflow = 'hidden';
  };
  window.lbCloseModal = function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
    document.body.style.overflow = '';
  };
  document.querySelectorAll('.lb-modal-overlay').forEach(el => {
    el.addEventListener('click', function (e) {
      if (e.target === this) window.lbCloseModal(this.id);
    });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.lb-modal-overlay.show').forEach(el => el.classList.remove('show'));
      document.body.style.overflow = '';
    }
  });

  // ---- Create promotion ----
  window.lbSubmitCreate = async function (e) {
    e.preventDefault();
    const name = document.getElementById('lbPromotionName').value.trim();
    const startDate = document.getElementById('lbStartDate').value;
    const endDate = document.getElementById('lbEndDate').value;
    const activateNow = document.getElementById('lbActivateNow').checked;

    if (!name || !startDate || !endDate) { toast('Please fill in all fields', 'error'); return; }
    if (new Date(startDate) >= new Date(endDate)) { toast('End date must be after start date', 'error'); return; }

    const btn = document.getElementById('lbCreateSubmit');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass"></i> Creating...';

    try {
      const d = await postForm('/api/leaderboard/create/', {
        name, start_date: startDate, end_date: endDate,
        activate_now: activateNow ? 'true' : 'false',
      });
      if (d.success) {
        toast(d.message, 'success');
        window.lbCloseModal('lbCreateModal');
        document.getElementById('lbCreateForm').reset();
        refreshAll();
      } else {
        toast(d.error || 'Failed to create', 'error');
      }
    } catch (err) {
      toast('Network error', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  };

  // ---- Activate / Deactivate / Reset / Delete ----
  window.lbActivate = async function (id) {
    if (!isAdmin) return;
    const ok = await showConfirm('Activate Promotion', 'Activate this promotion?');
    if (!ok) return;
    const d = await postForm('/api/leaderboard/activate/', { settings_id: id });
    if (d.success) { toast(d.message, 'success'); refreshAll(); }
    else toast(d.error || 'Failed', 'error');
  };

  window.lbDeactivate = async function (id) {
    if (!isAdmin) return;
    const ok = await showConfirm('Deactivate Promotion', 'Deactivate this promotion?');
    if (!ok) return;
    const d = await postForm('/api/leaderboard/deactivate/', { settings_id: id });
    if (d.success) { toast(d.message, 'success'); refreshAll(); }
    else toast(d.error || 'Failed', 'error');
  };

  window.lbReset = async function (id) {
    if (!isAdmin) return;
    const ok = await showConfirm('Reset Promotion', 'This will remove all winners for this promotion. Continue?');
    if (!ok) return;
    const d = await postForm('/api/leaderboard/reset/', { settings_id: id });
    if (d.success) { toast(d.message, 'success'); refreshAll(); }
    else toast(d.error || 'Failed', 'error');
  };

  window.lbDelete = async function (id) {
    if (!isAdmin) return;
    const ok = await showConfirm('Delete Promotion', 'This permanently deletes the promotion and all its winners. Continue?');
    if (!ok) return;
    const d = await postForm('/api/leaderboard/delete/', { settings_id: id });
    if (d.success) { toast(d.message, 'success'); refreshAll(); }
    else toast(d.error || 'Failed', 'error');
  };

  // ---- Refresh ----
  async function refreshAll() {
    try {
      const r = await fetch('/api/leaderboard/status/');
      const d = await r.json();
      if (!d.success) return;
      updateStatus(d);
      if (isAdmin) refreshPromos();
    } catch (e) {
      console.warn('Leaderboard refresh failed', e);
    }
  }

  async function refreshPromos() {
    try {
      const r = await fetch('/api/leaderboard/promotions/');
      const d = await r.json();
      if (!d.success) return;
      const container = document.getElementById('lbPromotionListContainer');
      if (!container) return;
      // Simple: reload the whole page to keep markup in sync (cheap, safe)
      // For minimal flicker, only reload if the count changed
      const currentCards = container.querySelectorAll('.promotion-card').length;
      if (currentCards !== d.promotions.length) {
        window.location.reload();
      }
    } catch (e) { /* silent */ }
  }

  function updateStatus(data) {
    const active = data.active;
    const winners = data.winners || [];
    const has = data.has_promotions;

    const stat = document.getElementById('lbStatWinners');
    if (stat) stat.textContent = winners.length;
    const status = document.getElementById('lbStatStatus');
    if (status) status.textContent = active ? 'Live' : (has ? 'Ended' : 'Soon');

    // Rebuild content area (simplified — same shape as server render)
    const area = document.getElementById('lbContentArea');
    if (!area) return;

    if (!has) {
      area.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="bi bi-hourglass-split"></i></div>'
        + '<h2>Coming Soon!</h2><p>A promotion is coming! Be one of the first 10 users to sign up during the promotion period and get featured on the leaderboard.</p>'
        + (isAdmin ? '<button class="btn" onclick="lbOpenModal(\'lbCreateModal\')"><i class="bi bi-plus-circle"></i> Create First Promotion</button>' : '')
        + '</div>';
      return;
    }

    if (winners.length === 0) {
      if (active) {
        area.innerHTML = '<div class="empty-state"><div class="empty-icon" style="color:var(--success-color);"><i class="bi bi-people"></i></div>'
          + '<h2 style="color:var(--success-color);">Promotion Active!</h2><p>The promotion is currently running. Be the first to sign up and win!</p></div>';
      }
      return;
    }

    let html = '<div class="winners-container"><div class="winners-header"><h4>'
      + '<i class="bi bi-crown" style="color:var(--xpy-primary);"></i> '
      + '<span>' + (active ? (active.promotion_name || 'Promotion') : 'Promotion') + '</span> Winners'
      + (active ? '<span class="live-indicator show"><span class="dot"></span> Live</span>' : '')
      + '</h4><span class="winners-count"><i class="bi bi-people"></i> ' + winners.length + ' users</span></div>'
      + '<ul class="winners-list">';

    winners.forEach(w => {
      const rankClass = w.rank === 1 ? 'rank-1' : (w.rank === 2 ? 'rank-2' : (w.rank === 3 ? 'rank-3' : ''));
      const medal = w.rank === 1 ? '🥇' : (w.rank === 2 ? '🥈' : (w.rank === 3 ? '🥉' : '#' + w.rank));
      const isYou = w.id == userId;
      var av = w.picture || '/static/images/avatars/default.png';
      var avThumb = av;
      if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
        avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
      }
      html += '<li class="winner-item' + (isYou ? ' flash' : '') + '">'
        + '<div class="winner-rank ' + rankClass + '">' + medal + '</div>'
        + '<img src="' + avThumb + '" width="40" height="40" onerror="this.onerror=null;this.src=\'' + av + '\'" class="winner-avatar">'
        + '<div class="winner-info"><div class="winner-name">' + escapeHtml(w.name)
        + (isYou ? '<span class="badge-you">You</span>' : '') + '</div>'
        + '<div class="winner-username">@' + escapeHtml(w.username) + '</div></div>'
        + '<div class="winner-signup-date"><i class="bi bi-calendar"></i> ' + w.signup_date + '</div>'
        + '</li>';
    });
    html += '</ul></div>';
    if (!active) {
      html += '<div class="ended-state"><i class="bi bi-flag"></i><h3>Promotion Ended</h3>'
        + '<p>This promotion has concluded. Congratulations to all winners!</p></div>';
    }
    area.innerHTML = html;
  }

  function escapeHtml(t) {
    if (t == null) return '';
    const d = document.createElement('div');
    d.textContent = String(t);
    return d.innerHTML;
  }

  // ---- Init ----
  document.addEventListener('DOMContentLoaded', () => {
    refreshAll();
    refreshInterval = setInterval(() => {
      if (!document.hidden) refreshAll();
    }, 15000);
  });

  window.addEventListener('beforeunload', () => {
    if (refreshInterval) clearInterval(refreshInterval);
  });
})();