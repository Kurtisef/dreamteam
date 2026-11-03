(() => {
  const dialog = document.getElementById('auth-dialog');
  const form = document.getElementById('auth-form');
  const message = document.getElementById('auth-msg');
  const modeInput = document.getElementById('auth-mode');
  const title = document.getElementById('auth-title');
  const submit = document.getElementById('auth-submit');
  const toggle = document.getElementById('auth-toggle');
  const loginButton = document.getElementById('auth-btn');
  if (!dialog || !form) return;

  function setMode(mode) {
    const creating = mode === 'create';
    modeInput.value = creating ? 'create' : 'login';
    title.textContent = creating ? 'Create profile' : 'Log in';
    submit.textContent = creating ? 'Save profile' : 'Log in';
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

  document.getElementById('auth-close')?.addEventListener('click', () => dialog.close());
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
})();

if (dialog && loginButton?.dataset.loggedIn !== 'true') {
  setMode('login');
  dialog.showModal();
}