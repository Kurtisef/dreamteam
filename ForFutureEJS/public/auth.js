(() => {
  const dialog = document.getElementById('auth-dialog');
  const form = document.getElementById('auth-form');
  const message = document.getElementById('auth-msg');
  const modeInput = document.getElementById('auth-mode');
  const emailInput = document.getElementById('auth-email');
  const passwordInput = document.getElementById('auth-password');
  const title = document.getElementById('auth-title');
  const submit = document.getElementById('auth-submit');
  const toggle = document.getElementById('auth-toggle');
  const loginButton = document.getElementById('auth-btn');
  const adminDialog = document.getElementById('admin-auth-dialog');
  const adminMessage = document.getElementById('admin-auth-msg');
  if (!dialog || !form) return;

  function setMode(mode) {
    const creating = mode === 'create';
    modeInput.value = creating ? 'create' : 'login';
    title.textContent = creating ? 'Create profile' : 'Log in';
    submit.textContent = creating ? 'Save profile' : 'Log in';
    passwordInput.autocomplete = creating ? 'new-password' : 'current-password';
    if (creating) passwordInput.minLength = 8;
    else passwordInput.removeAttribute('minlength');
    toggle.textContent = creating
      ? 'Already have a profile? Log in'
      : 'New here? Create a profile';
    message.textContent = '';
    message.className = '';
  }

  function openDialog() {
    setMode('login');
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
  }

  loginButton?.addEventListener('click', async () => {
    if (loginButton.dataset.loggedIn !== 'true') {
      openDialog();
      return;
    }

    const formData = new URLSearchParams();
    formData.set('return_to', window.location.pathname);
    await fetch('/logout', { method: 'POST', body: formData, credentials: 'same-origin' });
    window.location.reload();
  });

  document.querySelectorAll('.auth-trigger').forEach((button) => {
    button.addEventListener('click', openDialog);
  });

  toggle?.addEventListener('click', () => {
    setMode(modeInput.value === 'login' ? 'create' : 'login');
  });

  form.addEventListener('submit', (event) => {
    emailInput.value = emailInput.value.trim().toLowerCase();
    if (!emailInput.validity.valid) {
      event.preventDefault();
      message.textContent = 'Enter a valid email address.';
      message.className = 'err';
      emailInput.focus();
      return;
    }

    if (modeInput.value === 'create' && passwordInput.value.length < 8) {
      event.preventDefault();
      message.textContent = 'Choose a password with at least 8 characters.';
      message.className = 'err';
      passwordInput.focus();
    }
  });

  document.getElementById('auth-close')?.addEventListener('click', () => dialog.close());
  const profileDialog = document.getElementById('profile-dialog');
  const profileMessage = document.getElementById('profile-msg');
  const deleteAccountButton = document.getElementById('account-delete');
  document.getElementById('profile-open')?.addEventListener('click', () => profileDialog?.showModal());
  document.getElementById('profile-close')?.addEventListener('click', () => profileDialog?.close());
  deleteAccountButton?.addEventListener('click', async () => {
    if (!window.confirm('Are you sure you want to permanently delete your account? This cannot be undone.')) return;

    deleteAccountButton.disabled = true;
    profileMessage.textContent = 'Deleting your account…';
    profileMessage.className = '';
    try {
      const response = await fetch('/account', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'Could not delete your account. Please try again.');
      window.location.replace('/home');
    } catch (error) {
      profileMessage.textContent = error instanceof Error
        ? error.message
        : 'Could not delete your account. Please try again.';
      profileMessage.className = 'err';
      deleteAccountButton.disabled = false;
    }
  });

  document.getElementById('admin-login-open')?.addEventListener('click', () => {
    dialog.close();
    if (adminMessage) {
      adminMessage.textContent = '';
      adminMessage.className = '';
    }
    adminDialog?.showModal();
  });
  document.getElementById('admin-auth-close')?.addEventListener('click', () => adminDialog?.close());
  dialog.addEventListener('close', () => {
    form.reset();
    setMode('login');
  });

  const error = new URLSearchParams(window.location.search).get('authError');
  if (error) {
    openDialog();
    message.textContent = error;
    message.className = 'err';
    window.history.replaceState({}, '', window.location.pathname);
  }

  const params = new URLSearchParams(window.location.search);
  const adminError = params.get('adminAuthError');
  const adminLoginRequired = params.get('adminLogin');
  if (adminError || adminLoginRequired) {
    adminDialog?.showModal();
    if (adminMessage) {
      adminMessage.textContent = adminError || 'Please log in with an administrator account.';
      adminMessage.className = 'err';
    }
    window.history.replaceState({}, '', window.location.pathname);
  }

})();
