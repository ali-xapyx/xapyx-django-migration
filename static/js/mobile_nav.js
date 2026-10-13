/* Mobile nav: hamburger + create sheet + sidebar close (delegated) */
(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var burger = document.getElementById('headerHamburger');
    var plus   = document.getElementById('mobileNavPlus');
    var sheet  = document.getElementById('mobileSheet');
    var backdrop = document.getElementById('mobileSheetBackdrop');

    function openSidebar() {
      var sidebar = document.getElementById('sidebar');
      var overlay = document.getElementById('overlay');
      if (sidebar) sidebar.classList.add('show', 'active');
      if (overlay) overlay.classList.add('show');
      document.body.classList.add('sidebar-open');
    }
    function closeSidebar() {
      var sidebar = document.getElementById('sidebar');
      var overlay = document.getElementById('overlay');
      if (sidebar) sidebar.classList.remove('show', 'active');
      if (overlay) overlay.classList.remove('show');
      document.body.classList.remove('sidebar-open');
    }

    // Hamburger — direct binding (works, per your report)
    if (burger) {
      burger.addEventListener('click', function (e) {
        e.preventDefault();
        openSidebar();
      });
    }
        var navMenu = document.getElementById('mobileNavMenu');
    if (navMenu) {
      navMenu.addEventListener('click', function (e) {
        e.preventDefault();
        openSidebar();
      });
    }

    // ---- Sidebar close — EVENT DELEGATION (robust) ----
    document.addEventListener('click', function (e) {
      // X button (any of these selectors matches)
      if (e.target.closest('#sidebarCloseBtn') ||
          e.target.closest('.sidebar-close-btn')) {
        e.preventDefault();
        e.stopPropagation();
        closeSidebar();
        return;
      }

      // Overlay
      if (e.target.closest('#overlay')) {
        closeSidebar();
        return;
      }
    }, true); // true = capture phase, fires before other handlers

    // ---- + sheet ----
    if (plus && sheet && backdrop) {
      function openSheet() {
        sheet.classList.add('show');
        backdrop.classList.add('show');
        document.body.style.overflow = 'hidden';
      }
      function closeSheet() {
        sheet.classList.remove('show');
        backdrop.classList.remove('show');
        document.body.style.overflow = '';
      }

      plus.addEventListener('click', openSheet);
      backdrop.addEventListener('click', closeSheet);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeSheet();
      });

      sheet.querySelectorAll('.mobile-sheet-item').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var action = this.dataset.action;
          closeSheet();

          if (action === 'post') {
            if (document.getElementById('postContent')) {
              window.scrollTo({ top: 0, behavior: 'smooth' });
              setTimeout(function () {
                var ta = document.getElementById('postContent');
                if (ta) ta.focus();
              }, 300);
            } else {
              window.location.href = '/feed/';
            }
          } else if (action === 'poll') {
            var modal = document.getElementById('pollModal');
            if (modal && typeof bootstrap !== 'undefined') {
              new bootstrap.Modal(modal).show();
            } else {
              window.location.href = '/feed/';
            }
          } else if (action === 'shout') {
            window.location.href = '/shoutbox/';
          } else if (action === 'camera') {
            if (window.responsiveCamera) {
              window.responsiveCamera.open();
              window.responsiveCamera.startPhotoMode();
            }
          } else if (action === 'video') {
            if (window.responsiveCamera) {
              window.responsiveCamera.open();
              window.responsiveCamera.startVideoMode();
            }
          } else if (action === 'gallery') {
            if (window.responsiveCamera) {
              window.responsiveCamera.open();
              window.responsiveCamera.openGallery();
            }
          }
        });
      });
    }
  });
})();