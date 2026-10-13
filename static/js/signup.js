/* ============================================================
   XAPYX — Signup-Specific JavaScript
   Shared JS (stars, theme, alerts, password toggle) lives in auth.js.
   ============================================================ */

(function () {
  "use strict";

  /* ------------------------------------------------------------
     SERVER-SIDE ERRORS — show as toasts on load
     Errors are injected via data attributes on <body>
     ------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', function () {
    var errorBox = document.getElementById('xpyServerErrors');
    if (errorBox) {
      var errors = errorBox.querySelectorAll('li');
      errors.forEach(function (li, i) {
        setTimeout(function () {
          window.xpy.showAlert(li.textContent.trim(), 'error', 5000);
        }, 400 + i * 150);
      });
    }
  });

  /* ------------------------------------------------------------
     CONTACT TOGGLE (email <-> phone)
     ------------------------------------------------------------ */
  var contactBtns = document.querySelectorAll('.xpy-contact-btn');
  var contactTypeField = document.getElementById('xpyContactType');
  var emailField = document.getElementById('xpyEmailField');
  var phoneField = document.getElementById('xpyPhoneField');
  var emailInput = document.getElementById('xpySignupEmail');
  var phoneInput = document.getElementById('xpySignupPhone');
  var contactMessage = document.getElementById('xpySignupContactMessage');

  contactBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      contactBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      var type = btn.dataset.type;
      contactTypeField.value = type;
      contactMessage.textContent = '';

      if (type === 'email') {
        emailField.classList.add('active');
        phoneField.classList.remove('active');
        emailInput.required = true;
        phoneInput.required = false;
        phoneInput.value = '';
      } else {
        emailField.classList.remove('active');
        phoneField.classList.add('active');
        emailInput.required = false;
        phoneInput.required = true;
        emailInput.value = '';
      }
    });
  });

  /* ------------------------------------------------------------
     AJAX AVAILABILITY CHECKS
     ------------------------------------------------------------ */
  function checkUsername(username) {
    return fetch('/ajax/check-username/?username=' + encodeURIComponent(username))
      .then(function (r) { return r.json(); })
      .catch(function () { return { available: false, message: 'Network error' }; });
  }
  function checkEmail(email) {
    return fetch('/ajax/check-email/?email=' + encodeURIComponent(email))
      .then(function (r) { return r.json(); })
      .catch(function () { return { available: false, message: 'Network error' }; });
  }
  function checkPhone(phone) {
    return fetch('/ajax/check-phone/?phone=' + encodeURIComponent(phone))
      .then(function (r) { return r.json(); })
      .catch(function () { return { available: false, message: 'Network error' }; });
  }

  /* ------------------------------------------------------------
     USERNAME FIELD — validate + debounced availability check
     ------------------------------------------------------------ */
  var usernameInput = document.getElementById('xpySignupUsername');
  var usernameMsg = document.getElementById('xpySignupUsernameMessage');
  var suggestionsContainer = document.getElementById('xpyUsernameSuggestions');
  var usernameTimer = null;
  var lastCheckedUsername = '';

  if (usernameInput) {
    usernameInput.addEventListener('input', function () {
      var username = usernameInput.value.trim().toLowerCase();
      if (usernameInput.value !== username) usernameInput.value = username;

      if (!username) {
        window.xpy.updateValidationUI(usernameInput, usernameMsg, { valid: false, message: '' });
        return;
      }
      if (username.length < 4) {
        window.xpy.updateValidationUI(usernameInput, usernameMsg, { valid: false, message: 'Min 4 chars' });
        return;
      }
      if (!/^[a-z0-9_]+$/.test(username)) {
        window.xpy.updateValidationUI(usernameInput, usernameMsg, { valid: false, message: 'Only a-z, 0-9, _' });
        return;
      }

      clearTimeout(usernameTimer);
      usernameMsg.textContent = 'Checking...';
      usernameMsg.className = 'xpy-validation-message xpy-warning';

      usernameTimer = setTimeout(function () {
        if (username === lastCheckedUsername) return;
        checkUsername(username).then(function (res) {
          lastCheckedUsername = username;
          window.xpy.updateValidationUI(usernameInput, usernameMsg, {
            valid: !!res.available,
            message: res.message || (res.available ? '✓ Available!' : '✗ Taken'),
          });
        });
      }, 400);
    });
  }

  /* ------------------------------------------------------------
     NAME → USERNAME SUGGESTIONS
     ------------------------------------------------------------ */
  var nameInput = document.getElementById('xpySignupName');
  var nameMsg = document.getElementById('xpySignupNameMessage');
  var nameTimer = null;

  if (nameInput) {
    nameInput.addEventListener('input', function () {
      var name = nameInput.value.trim();

      if (!name) {
        window.xpy.updateValidationUI(nameInput, nameMsg, { valid: false, message: '' });
      } else if (name.length < 2) {
        window.xpy.updateValidationUI(nameInput, nameMsg, { valid: false, message: 'Too short' });
      } else if (!/^[a-zA-Z\s]+$/.test(name)) {
        window.xpy.updateValidationUI(nameInput, nameMsg, { valid: false, message: 'Letters only' });
      } else {
        window.xpy.updateValidationUI(nameInput, nameMsg, { valid: true, message: '✓' });
      }

      clearTimeout(nameTimer);
      if (name.length >= 2 && /^[a-zA-Z\s]+$/.test(name)) {
        nameTimer = setTimeout(function () {
          fetch('/ajax/suggest-username/?name=' + encodeURIComponent(name))
            .then(function (r) { return r.json(); })
            .then(function (suggestions) {
              renderSuggestions(suggestions);
            })
            .catch(function () { /* silent */ });
        }, 500);
      } else {
        suggestionsContainer.innerHTML = '';
      }
    });
  }

  function renderSuggestions(suggestions) {
    if (!suggestions || suggestions.length === 0) {
      suggestionsContainer.innerHTML = '';
      return;
    }
    var html = '';
    suggestions.forEach(function (s) {
      html += '<button type="button" class="xpy-suggestion-chip" data-username="' +
              s + '"><i class="fas fa-user"></i> ' + s + '</button>';
    });
    suggestionsContainer.innerHTML = html;

    suggestionsContainer.querySelectorAll('.xpy-suggestion-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        usernameInput.value = chip.dataset.username;
        suggestionsContainer.innerHTML = '';
        usernameInput.dispatchEvent(new Event('input'));
        usernameInput.focus();
      });
    });
  }
    /* ------------------------------------------------------------
     EMAIL FIELD — validate + debounced availability check
     ------------------------------------------------------------ */
  var emailMsg = document.getElementById('xpySignupContactMessage');
  var emailTimer = null;
  if (emailInput) {
    emailInput.addEventListener('input', function () {
      if (!emailField.classList.contains('active')) return;
      var email = emailInput.value.trim();

      if (!email) {
        window.xpy.updateValidationUI(emailInput, emailMsg, { valid: false, message: '' });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        window.xpy.updateValidationUI(emailInput, emailMsg, { valid: false, message: 'Invalid email' });
        return;
      }
      clearTimeout(emailTimer);
      emailTimer = setTimeout(function () {
        checkEmail(email).then(function (res) {
          window.xpy.updateValidationUI(emailInput, emailMsg, {
            valid: !!res.available,
            message: res.message || (res.available ? '✓ Available!' : '✗ Already used'),
          });
        });
      }, 400);
    });
  }

  /* ------------------------------------------------------------
     PHONE FIELD — validate + debounced availability check
     ------------------------------------------------------------ */
  var phoneTimer = null;
  if (phoneInput) {
    phoneInput.addEventListener('input', function () {
      if (!phoneField.classList.contains('active')) return;
      var digits = phoneInput.value.replace(/\D/g, '');

      if (!digits) {
        window.xpy.updateValidationUI(phoneInput, emailMsg, { valid: false, message: '' });
        return;
      }
      if (digits.length < 10 || digits.length > 15) {
        window.xpy.updateValidationUI(phoneInput, emailMsg, { valid: false, message: '10-15 digits' });
        return;
      }
      clearTimeout(phoneTimer);
      phoneTimer = setTimeout(function () {
        checkPhone(digits).then(function (res) {
          window.xpy.updateValidationUI(phoneInput, emailMsg, {
            valid: !!res.available,
            message: res.message || (res.available ? '✓ Available!' : '✗ Already used'),
          });
        });
      }, 400);
    });
  }

  /* ------------------------------------------------------------
     PASSWORD STRENGTH BAR + REQUIREMENTS CHECKLIST
     ------------------------------------------------------------ */
  var passwordInput = document.getElementById('xpySignupPassword');
  var passwordMsg = document.getElementById('xpySignupPasswordMessage');
  var strengthFill = document.getElementById('xpyStrengthFill');
  var reqs = {
    length:    document.getElementById('xpyReqLength'),
    uppercase: document.getElementById('xpyReqUppercase'),
    lowercase: document.getElementById('xpyReqLowercase'),
    number:    document.getElementById('xpyReqNumber'),
    special:   document.getElementById('xpyReqSpecial'),
  };

  function evaluatePassword(pw) {
    return {
      length:    pw.length >= 8,
      uppercase: /[A-Z]/.test(pw),
      lowercase: /[a-z]/.test(pw),
      number:    /\d/.test(pw),
      special:   /[^A-Za-z0-9]/.test(pw),
    };
  }

  if (passwordInput) {
    passwordInput.addEventListener('input', function () {
      var pw = passwordInput.value;
      var checks = evaluatePassword(pw);
      var metCount = 0;

      Object.keys(checks).forEach(function (key) {
        var el = reqs[key];
        if (!el) return;
        var ok = checks[key];
        if (ok) metCount++;
        el.className = 'xpy-requirement ' + (ok ? 'xpy-met' : 'xpy-unmet');
        el.querySelector('i').className = ok ? 'fas fa-check-circle' : 'fas fa-circle';
      });

      // Strength bar: 0-5 → 0-100%
      var pct = Math.round((metCount / 5) * 100);
      strengthFill.style.width = pct + '%';
      if (metCount <= 2) {
        strengthFill.style.background = '#ef4444';
      } else if (metCount <= 4) {
        strengthFill.style.background = '#f59e0b';
      } else {
        strengthFill.style.background = '#10b981';
      }

      // Message
      if (!pw) {
        window.xpy.updateValidationUI(passwordInput, passwordMsg, { valid: false, message: '' });
      } else if (metCount === 5) {
        window.xpy.updateValidationUI(passwordInput, passwordMsg, { valid: true, message: '✓ Strong' });
      } else if (metCount >= 3) {
        window.xpy.updateValidationUI(passwordInput, passwordMsg, { valid: true, message: '✓ OK' });
      } else {
        window.xpy.updateValidationUI(passwordInput, passwordMsg, { valid: false, message: 'Weak password' });
      }
    });
  }

  /* ------------------------------------------------------------
     FORM SUBMIT — client-side pre-validation + loading state
     ------------------------------------------------------------ */
  var signupForm = document.getElementById('xpySignupForm');
  var signupBtn = document.getElementById('xpySignupSubmitBtn');
  var isSubmitting = false;

  if (signupForm) {
    signupForm.addEventListener('submit', function (e) {
      if (isSubmitting) { e.preventDefault(); return; }

      var name = nameInput.value.trim();
      var username = usernameInput.value.trim();
      var password = passwordInput.value;
      var contactType = contactTypeField.value;
      var termsChecked = document.getElementById('xpyTermsCheckbox').checked;

      if (!/^[a-zA-Z\s]{2,100}$/.test(name)) {
        e.preventDefault();
        window.xpy.showAlert('Please enter a valid name', 'error');
        return;
      }
      if (!/^[a-z0-9_]{4,20}$/.test(username)) {
        e.preventDefault();
        window.xpy.showAlert('Please enter a valid username', 'error');
        return;
      }

      if (contactType === 'email') {
        var email = emailInput.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          e.preventDefault();
          window.xpy.showAlert('Please enter a valid email', 'error');
          return;
        }
      } else {
        var digits = phoneInput.value.replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 15) {
          e.preventDefault();
          window.xpy.showAlert('Please enter a valid phone (10-15 digits)', 'error');
          return;
        }
      }

      var checks = evaluatePassword(password);
      if (!Object.values(checks).every(Boolean)) {
        e.preventDefault();
        window.xpy.showAlert('Password must meet all requirements', 'error');
        return;
      }
      if (!termsChecked) {
        e.preventDefault();
        window.xpy.showAlert('Please accept the Terms and Privacy Policy', 'error');
        return;
      }

      // Show loading state — Django handles the actual submission
      isSubmitting = true;
      signupBtn.innerHTML = '<span class="xpy-loader-spinner" style="display:inline-block;width:20px;height:20px;border:2px solid rgba(255,255,255,0.3);border-top:2px solid white;border-radius:50%;animation:xpy-spin 1s linear infinite;"></span> Creating account...';
      signupBtn.disabled = true;
    });
  }

  /* ------------------------------------------------------------
     GOOGLE BUTTON
     ------------------------------------------------------------ */
  var googleBtn = document.getElementById('xpyGoogleSignUpBtn');
  if (googleBtn) {
    googleBtn.addEventListener('click', function () {
      googleBtn.innerHTML = '<span class="xpy-loader-spinner" style="display:inline-block;width:18px;height:18px;border:2px solid rgba(66,133,244,0.2);border-top:2px solid #4285f4;border-radius:50%;animation:xpy-spin 1s linear infinite;"></span> Connecting...';
      googleBtn.disabled = true;
      window.location.href = '/google-auth/';
    });
  }

})();