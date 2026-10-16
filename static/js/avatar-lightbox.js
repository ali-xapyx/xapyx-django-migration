(function() {
  'use strict';

  var DEFAULT_AVATAR = '/static/images/avatars/default.png';

  function ensureModal() {
    if (document.getElementById('avatarLightbox')) return;
    var html = '<div id="avatarLightbox" class="avatar-lightbox" role="dialog" aria-modal="true" hidden>'
      + '<div class="avatar-lightbox-backdrop"></div>'
      + '<div class="avatar-lightbox-content">'
      + '<button type="button" class="avatar-lightbox-close" aria-label="Close">'
      + '<i class="fas fa-times"></i></button>'
      + '<img id="avatarLightboxImg" src="" alt="">'
      + '<div class="avatar-lightbox-caption" id="avatarLightboxCaption"></div>'
      + '</div></div>';
    document.body.insertAdjacentHTML('beforeend', html);

    var lb = document.getElementById('avatarLightbox');
    lb.querySelector('.avatar-lightbox-backdrop').addEventListener('click', close);
    lb.querySelector('.avatar-lightbox-close').addEventListener('click', close);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && !lb.hidden) close();
    });
  }

  function open(imgEl) {
    ensureModal();
    var lb = document.getElementById('avatarLightbox');
    var lbImg = document.getElementById('avatarLightboxImg');
    var cap = document.getElementById('avatarLightboxCaption');

    // Prefer full-size URL over thumbnail
    var full = imgEl.dataset.fullSrc || imgEl.src;
    // If src is _avatar.webp, strip suffix to get original
    if (full && full.indexOf('_avatar.webp') !== -1) {
      full = full.replace('_avatar.webp', '').replace(/_avatar\.webp$/, '');
    }
    lbImg.src = full;
    lbImg.alt = imgEl.alt || '';
    lbImg.onerror = function() {
      this.onerror = null;
      this.src = imgEl.dataset.fullSrc || imgEl.src || DEFAULT_AVATAR;
    };

    var capText = imgEl.dataset.username || imgEl.alt || '';
    if (!capText) {
      var wrap = imgEl.closest('.post-author, .post-header, .comment-item, .comment-avatar-wrap, .page-inbox-conv-item, .page-inbox-msg-row, .chatroom-msg, .follower-list-item, .gv-modal-member, .user-card, .notification-item, .notif-page-item, .suggested-user-card, .suggested-item');
      if (wrap) {
        var nameEl = wrap.querySelector('.post-author-name, h6, strong, .follower-name, .gv-modal-member-name, h4, .mention-name, .page-inbox-conv-name, .chatroom-msg-sender');
        if (nameEl) capText = nameEl.textContent.trim();
      }
    }
    cap.textContent = capText;

    lb.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function close() {
    var lb = document.getElementById('avatarLightbox');
    if (!lb) return;
    lb.hidden = true;
    document.body.style.overflow = '';
  }

  // Event delegation: catch clicks on any avatar-like img
  document.addEventListener('click', function(e) {
    var t = e.target;
    if (!t || t.tagName !== 'IMG') return;
    if (t.closest('#avatarLightbox')) return;

    // Do NOT trigger avatar lightbox preview on header/navbar profile avatar or elements marked no-lightbox
    if (t.id === 'headerUserAvatar'
        || t.classList.contains('no-lightbox')
        || t.classList.contains('header-avatar-img')
        || t.closest('#profileMini')
        || t.closest('.profile-mini')
        || t.closest('.user-profile-toggle')
        || t.closest('.header-avatar-container')
        || t.closest('#profileMenuWrapper')
        || t.closest('.profile-menu-wrapper')) {
      return;
    }

    var isAvatar = t.classList.contains('post-author-avatar')
      || t.classList.contains('comment-avatar')
      || t.classList.contains('avatar-img')
      || t.classList.contains('avatar-mini-img')
      || t.classList.contains('page-inbox-msg-avatar')
      || t.classList.contains('page-inbox-header-avatar')
      || t.classList.contains('page-inbox-conv-avatar')
      || t.classList.contains('chatroom-msg-avatar')
      || t.classList.contains('chatroom-member-avatar')
      || t.classList.contains('follower-avatar')
      || t.classList.contains('winner-avatar')
      || t.classList.contains('mention-avatar')
      || t.classList.contains('suggested-avatar')
      || t.closest('.page-inbox-msg-avatar-wrap')
      || t.closest('.page-inbox-conv-avatar-wrap')
      || t.closest('.chatroom-member-avatar-wrap')
      || t.closest('.chat-bubble-wrap.received')
      || t.closest('.comment-avatar-wrap')
      || t.closest('.notification-avatar-wrap')
      || t.closest('.notif-page-avatar-wrap');

    if (isAvatar) {
      e.preventDefault();
      e.stopPropagation();
      open(t);
    }
  }, true);

  window.xpyAvatarLightbox = { open: open, close: close };
})();