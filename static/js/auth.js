/* ============================================================
   XAPYX — Shared Auth JavaScript
   Used by: login.html, signup.html, (future auth pages)

   Exposes globally:
     window.xpy.createStars()
     window.xpy.setTheme(isLight)
     window.xpy.showAlert(message, type, duration)
     window.xpy.updateValidationUI(input, messageEl, result)
   ============================================================ */

(function () {
  'use strict';

  /* ------------------------------------------------------------
     STARS GENERATOR (night mode only)
     ------------------------------------------------------------ */
  function createStars() {
    var container = document.getElementById('xpyStars');
    if (!container) return;

    container.innerHTML = '';
    var count = window.innerWidth < 768 ? 50 : 100;

    for (var i = 0; i < count; i++) {
      var star = document.createElement('div');
      star.className = 'xpy-star';
      var size = Math.random() * 2 + 0.6;
      star.style.cssText =
        'width:' + size + 'px;height:' + size + 'px;' +
        'left:' + (Math.random() * 100) + '%;' +
        'top:' + (Math.random() * 100) + '%;' +
        '--xpy-d:' + ((Math.random() * 3 + 1.5).toFixed(1)) + 's;' +
        'animation-delay:' + ((Math.random() * 4).toFixed(1)) + 's;';
      container.appendChild(star);
    }
  }

  /* ------------------------------------------------------------
     THEME MANAGEMENT
     Reads/writes localStorage. Toggles body.xpy-light class.
     Updates the moon/sun emoji on the toggle button if present.
     ------------------------------------------------------------ */
  function setTheme(isLight) {
    var body = document.body;
    var themeToggle = document.getElementById('xpyThemeToggle');

    if (isLight) {
      body.classList.add('xpy-light');
      if (themeToggle) themeToggle.textContent = '☀️';
    } else {
      body.classList.remove('xpy-light');
      if (themeToggle) themeToggle.textContent = '🌙';
    }
    try {
      localStorage.setItem('xpy-theme', isLight ? 'light' : 'dark');
    } catch (e) {
      /* localStorage may be disabled — ignore */
    }
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('xpy-theme'); } catch (e) {}

    // Default: dark mode
    setTheme(saved === 'light');

    var themeToggle = document.getElementById('xpyThemeToggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', function () {
        var isLight = document.body.classList.contains('xpy-light');
        setTheme(!isLight);
      });
    }
  }

  /* ------------------------------------------------------------
     ALERT / TOAST SYSTEM
     Creates a toast in #xpyAlertContainer.
     Types: success | error | warning | info
     ------------------------------------------------------------ */
  function showAlert(message, type, duration) {
    type = type || 'info';
    duration = (typeof duration === 'number') ? duration : 3000;

    var container = document.getElementById('xpyAlertContainer');
    if (!container) return null;

    var alert = document.createElement('div');
    alert.className = 'xpy-alert xpy-alert-' + type;

    var icons = {
      success: 'fas fa-check-circle',
      error: 'fas fa-exclamation-circle',
      warning: 'fas fa-exclamation-triangle',
      info: 'fas fa-info-circle'
    };

    alert.innerHTML =
      '<i class="xpy-alert-icon ' + (icons[type] || icons.info) + '"></i>' +
      '<span>' + message + '</span>';

    container.appendChild(alert);

    if (duration > 0) {
      setTimeout(function () {
        alert.style.opacity = '0';
        alert.style.transform = 'translateX(100%)';
        alert.style.transition = 'all 0.3s ease';
        setTimeout(function () {
          if (alert.parentNode) alert.parentNode.removeChild(alert);
        }, 300);
      }, duration);
    }

    return alert;
  }

  /* ------------------------------------------------------------
     VALIDATION UI HELPER
     Shows a message under an input and colour-codes the border.
     result = { valid: bool, message: string }
     ------------------------------------------------------------ */
  function updateValidationUI(input, messageEl, result) {
    if (!input || !messageEl) return;

    input.classList.remove('error', 'success');
    messageEl.textContent = result.message || '';
    messageEl.className = 'xpy-validation-message';

    if (result.valid && result.message) {
      input.style.borderColor = '#10b981';
      messageEl.classList.add('success');
    } else if (result.message) {
      input.style.borderColor = '#ef4444';
      messageEl.classList.add('error');
    } else {
      input.style.borderColor = '';
    }
  }

  /* ------------------------------------------------------------
     PASSWORD TOGGLE (generic)
     Wire up any .xpy-password-toggle button to its input.
     ------------------------------------------------------------ */
  function initPasswordToggles() {
    var toggles = document.querySelectorAll('.xpy-password-toggle');
    toggles.forEach(function (btn) {
      btn.addEventListener('click', function () {
        // Find the input inside the same .xpy-input-wrap
        var wrap = btn.closest('.xpy-input-wrap');
        if (!wrap) return;
        var input = wrap.querySelector('input');
        if (!input) return;

        var isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';

        var icon = btn.querySelector('i');
        if (icon) {
          icon.className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
        }
      });
    });
  }

  /* ------------------------------------------------------------
     INIT — run when DOM is ready
     ------------------------------------------------------------ */
  function init() {
    createStars();
    initTheme();
    initPasswordToggles();

    window.addEventListener('resize', createStars);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ------------------------------------------------------------
     EXPOSE GLOBALLY
     ------------------------------------------------------------ */
  window.xpy = {
    createStars: createStars,
    setTheme: setTheme,
    showAlert: showAlert,
    updateValidationUI: updateValidationUI
  };

})();
