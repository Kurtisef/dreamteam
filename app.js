(() => {
  const SUPABASE_URL = 'https://buvvmpodmcfcjgzglmsw.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_xMx7SkOGDda30kzYxwrtpA_K6wmmmN6';
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const $ = (id) => document.getElementById(id);
  const dialog = $('auth-dialog');
  const form = $('auth-form');
  const msg = $('auth-msg');
  let mode = 'login';

  function setMode(m) {
    mode = m;
    const signup = m === 'signup';
    $('auth-title').textContent = signup ? 'Create account' : 'Log in';
    $('auth-submit').textContent = signup ? 'Create account' : 'Log in';
    $('auth-toggle').textContent = signup
      ? 'Already have an account? Log in'
      : 'New here? Create an account';
    $('auth-pass').autocomplete = signup ? 'new-password' : 'current-password';
    msg.textContent = '';
    msg.className = '';
  }

  function showMsg(text, isError = true) {
    msg.textContent = text;
    msg.className = isError ? 'err' : 'ok';
  }

  function updateButton(session) {
    $('auth-btn').textContent = session ? 'Log out' : 'Log in';
  }

  $('auth-toggle').addEventListener('click', () =>
    setMode(mode === 'login' ? 'signup' : 'login'));
  $('auth-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { form.reset(); msg.textContent = ''; });

  $('auth-btn').addEventListener('click', async () => {
    const { data } = await sb.auth.getSession();
    if (data.session) {
      await sb.auth.signOut();
    } else {
      setMode('login');
      dialog.showModal();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('auth-email').value.trim();
    const password = $('auth-pass').value;
    const btn = $('auth-submit');

    if (!email || password.length < 8) {
      return showMsg('Enter an email and a password of at least 8 characters.');
    }

    btn.disabled = true;
    try {
      if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          dialog.close();
        } else {
          showMsg('Check your email to confirm your account, then log in.', false);
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        dialog.close();
      }
    } catch (err) {
      showMsg(err.message || 'Something went wrong. Try again.');
    } finally {
      btn.disabled = false;
    }
  });

  sb.auth.onAuthStateChange((_event, session) => updateButton(session));
  sb.auth.getSession().then(({ data }) => updateButton(data.session));
})();

// Add these values from Supabase Project Settings > API.
const SUPABASE_URL = "https://buvvmpodmcfcjgzglmsw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_xMx7SkOGDda30kzYxwrtpA_K6wmmmN6";

let supabaseClient = null;

if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );
  console.log("Supabase client connected.");
} else {
  console.info(
    "Supabase is ready to connect. Add your project URL and publishable key in app.js."
  );
}
