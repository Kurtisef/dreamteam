const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = Number(process.env.PORT) || 3000;
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

const SESSION_COOKIE = 'gym_profile_session';
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const profileSessions = new Map();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Read a profile from the Supabase Data API using the public project key.
// This is the same profile lookup model as the HTML version, not Supabase Auth.
async function requestProfiles({ method = 'GET', filters = {}, body } = {}) {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env.');
  }

  const url = new URL(`${supabaseUrl}/rest/v1/profiles`);
  url.searchParams.set('select', '*');
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, value);
  }

  const headers = { apikey: supabasePublishableKey };
  const options = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = 'return=representation';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const responseText = await response.text();
  let result;
  try {
    result = responseText ? JSON.parse(responseText) : null;
  } catch {
    result = null;
  }

  if (!response.ok) {
    const message = result?.message || result?.hint || `Supabase request failed (${response.status}).`;
    throw new Error(message);
  }
  return result;
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  for (const item of cookieHeader.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    const key = item.slice(0, separator).trim();
    if (key === name) return decodeURIComponent(item.slice(separator + 1).trim());
  }
  return null;
}

function setSessionCookie(res, sessionId) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_LIFETIME_MS / 1000}${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
}

function attachProfile(req, res, next) {
  const now = Date.now();
  for (const [id, session] of profileSessions) {
    if (session.expiresAt <= now) profileSessions.delete(id);
  }

  const sessionId = getCookie(req, SESSION_COOKIE);
  const session = sessionId ? profileSessions.get(sessionId) : null;
  req.profile = session && session.expiresAt > now ? session.profile : null;
  next();
}

app.use(attachProfile);

function safeReturnPath(value) {
  return ['/', '/home', '/live', '/week', '/plan'].includes(value) ? value : '/home';
}

function redirectWithAuthError(res, returnPath, error) {
  const message = error instanceof Error ? error.message : 'The profile request failed.';
  res.redirect(`${returnPath}?authError=${encodeURIComponent(message)}`);
}

app.post('/login', async (req, res) => {
  const displayName = typeof req.body.display_name === 'string' ? req.body.display_name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
  const mode = req.body.mode === 'create' ? 'create' : 'login';
  const returnPath = safeReturnPath(req.body.return_to);

  if (!displayName || !email) {
    return redirectWithAuthError(res, returnPath, new Error('Enter a username and email address.'));
  }

  try {
    let profile;
    if (mode === 'create') {
      const created = await requestProfiles({
        method: 'POST',
        body: { display_name: displayName, email },
      });
      profile = Array.isArray(created) ? created[0] : created;
      if (!profile) throw new Error('Supabase did not return the new profile.');
    } else {
      const matches = await requestProfiles({
        filters: {
          display_name: `eq.${displayName}`,
          email: `eq.${email}`,
          limit: '1',
        },
      });
      profile = Array.isArray(matches) ? matches[0] : null;
      if (!profile) throw new Error('No profile matches that username and email.');
    }

    const sessionId = crypto.randomBytes(32).toString('hex');
    const user = {
      profile_id: profile.profile_id || profile.id || null,
      display_name: profile.display_name,
      email: profile.email,
      role: profile.role === 'admin' ? 'admin' : 'user',
    };
    profileSessions.set(sessionId, { profile: user, expiresAt: Date.now() + SESSION_LIFETIME_MS });
    setSessionCookie(res, sessionId);
    return res.redirect(returnPath);
  } catch (error) {
    return redirectWithAuthError(res, returnPath, error);
  }
});

app.post('/logout', (req, res) => {
  const sessionId = getCookie(req, SESSION_COOKIE);
  if (sessionId) profileSessions.delete(sessionId);
  clearSessionCookie(res);
  res.redirect(safeReturnPath(req.body.return_to));
});

// The stylesheet remains at the project root, one level above this server file.
app.get('/styles.css', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'styles.css'));
});

function renderPage(view) {
  return (req, res) => res.render(view, { user: req.profile, currentPath: req.path });
}

app.get('/', renderPage('home'));
app.get('/home', renderPage('home'));
app.get('/live', renderPage('live'));
app.get('/week', renderPage('week'));
app.get('/plan', renderPage('plan'));

app.use((req, res) => {
  res.status(404).send('Page not found.');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong while rendering the page.');
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`BYU Gym Planner server listening on http://localhost:${port}`);
    if (!supabaseUrl || !supabasePublishableKey) {
      console.log('Supabase profile login is not configured; set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env.');
    }
  });
}

module.exports = { app };
