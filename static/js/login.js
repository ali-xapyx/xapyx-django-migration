/* ============================================================
   XAPYX — Login-Specific JavaScript
   Shared JS (stars, theme, alerts, password toggle) lives in auth.js.
   ============================================================ */

(function () {
  "use strict";

  /* ------------------------------------------------------------
     SHOW SERVER-SIDE ERROR AS A TOAST (if any)
     The template renders an error div with id="xpyServerError"
     ------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', function () {
    var errorEl = document.getElementById('xpyServerError');
    if (errorEl) {
      var msg = errorEl.dataset.message || errorEl.textContent.trim();
      if (msg) {
        setTimeout(function () {
          window.xpy.showAlert(msg, 'error', 5000);
        }, 400);
      }
    }
  });

  /* ------------------------------------------------------------
     FORM SUBMIT — show loading spinner
     ------------------------------------------------------------ */
  var loginForm = document.getElementById('xpyLoginForm');
  var loginBtn = document.getElementById('xpyLoginSubmit');

  if (loginForm && loginBtn) {
    loginForm.addEventListener('submit', function () {
      loginBtn.innerHTML = '<span class="xpy-loader-spinner" style="display:inline-block;width:20px;height:20px;border:2px solid rgba(255,255,255,0.3);border-top:2px solid white;border-radius:50%;animation:xpy-spin 1s linear infinite;"></span> Signing in...';
      loginBtn.disabled = true;
    });
  }

  /* ------------------------------------------------------------
     FORGOT PASSWORD (placeholder — real flow comes later)
     ------------------------------------------------------------ */
  var forgotLink = document.getElementById('xpyForgotLink');
  if (forgotLink) {
    forgotLink.addEventListener('click', function (e) {
      e.preventDefault();
      window.xpy.showAlert('Password reset coming soon!', 'info');
    });
  }

  /* ------------------------------------------------------------
     GOOGLE BUTTON
     ------------------------------------------------------------ */
  var googleBtn = document.getElementById('xpyGoogleBtn');
  if (googleBtn) {
    googleBtn.addEventListener('click', function () {
      googleBtn.innerHTML = '<span class="xpy-loader-spinner" style="display:inline-block;width:18px;height:18px;border:2px solid rgba(255,255,255,0.3);border-top:2px solid white;border-radius:50%;animation:xpy-spin 1s linear infinite;"></span> Signing in...';
      googleBtn.disabled = true;
      window.location.href = '/google-auth/';
    });
  }

})();