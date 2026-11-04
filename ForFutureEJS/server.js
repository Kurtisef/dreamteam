const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = Number(process.env.PORT) || 3000;
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

async function requestDeskStaffByEmail(email) {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Admin database access is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.');
  }

  const url = new URL(`${supabaseUrl}/rest/v1/desk_staff`);
  url.searchParams.set('select', 'desk_id,email,desk_password');
  url.searchParams.set('email', `eq.${email}`);
  url.searchParams.set('limit', '1');

  const response = await fetch(url, {
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
    },
  });
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
  return Array.isArray(result) ? result[0] : null;
}

async function insertTrafficEvent({ deskId, eventType, waitTimeMin }) {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Admin database access is not configured.');
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/traffic_events`, {
    method: 'POST',
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      desk_id: deskId,
      event_type: eventType,
      wait_time_min: waitTimeMin,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    let result;
    try {
      result = responseText ? JSON.parse(responseText) : null;
    } catch {
      result = null;
    }
    throw new Error(result?.message || result?.hint || `Supabase insert failed (${response.status}).`);
  }
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

app.use((req, res, next) => {
  const adminRestrictedPaths = ['/live', '/week', '/plan'];
  if (req.profile?.role === 'admin' && adminRestrictedPaths.includes(req.path)) {
    return res.redirect('/home');
  }
  next();
});

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

app.post('/admin-login', async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!email || !password) {
    return res.redirect(`/home?adminAuthError=${encodeURIComponent('Enter your admin email and password.')}`);
  }

  try {
    const staff = await requestDeskStaffByEmail(email);
    if (!staff || staff.email !== email || staff.desk_password !== password) {
      return res.redirect(`/home?adminAuthError=${encodeURIComponent('The admin email or password is incorrect.')}`);
    }
    if (!staff.desk_id) throw new Error('The desk_staff record is missing desk_id.');

    const sessionId = crypto.randomBytes(32).toString('hex');
    const user = {
      profile_id: null,
      display_name: 'Admin',
      email: staff.email,
      desk_id: staff.desk_id,
      role: 'admin',
    };
    profileSessions.set(sessionId, { profile: user, expiresAt: Date.now() + SESSION_LIFETIME_MS });
    setSessionCookie(res, sessionId);
    return res.redirect('/admin');
  } catch (error) {
    console.error('Admin login failed:', error);
    return res.redirect(`/home?adminAuthError=${encodeURIComponent('Could not check admin credentials. Please try again.')}`);
  }
});

app.post('/admin/events', async (req, res) => {
  if (!req.profile) return res.status(401).json({ error: 'Admin login required.' });
  if (req.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });

  const eventType = req.body.event_type;
  const waitTimeMin = req.body.wait_time_min;
  if (!['in', 'out'].includes(eventType)) {
    return res.status(400).json({ error: 'Event type must be in or out.' });
  }
  if (eventType === 'in' && waitTimeMin !== null && (!Number.isInteger(waitTimeMin) || waitTimeMin < 1)) {
    return res.status(400).json({ error: 'Wait time must be a whole number of at least 1 minute, or null.' });
  }

  try {
    await insertTrafficEvent({
      deskId: req.profile.desk_id,
      eventType,
      waitTimeMin: eventType === 'in' ? waitTimeMin : null,
    });
    return res.status(201).json({ ok: true });
  } catch (error) {
    console.error('Traffic event insert failed:', error);
    return res.status(500).json({ error: 'Could not save the traffic event.' });
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

app.get('/admin.css', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin.css'));
});

function renderPage(view) {
  return (req, res) => res.render(view, { user: req.profile, currentPath: req.path });
}

app.get('/', renderPage('home'));
app.get('/home', renderPage('home'));
app.get('/live', renderPage('live'));
app.get('/week', renderPage('week'));
app.get('/plan', renderPage('plan'));
app.get('/admin', (req, res) => {
  if (!req.profile) return res.redirect('/home?adminLogin=required');
  if (req.profile.role !== 'admin') return res.status(403).send('Admin access is required.');
  return res.render('admin', { user: req.profile, currentPath: req.path });
});

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
