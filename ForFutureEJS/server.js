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

const GYM_TIME_ZONE = 'America/Denver';
const MAX_GYM_CAPACITY = 135;

function mountainDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: GYM_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function dateKeyFromParts(parts) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDateKey(key, days) {
  const [year, month, day] = key.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function weekStartKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return shiftDateKey(key, weekday === 0 ? -6 : 1 - weekday);
}

function mountainWallTime(dateKey, hour) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const wallTime = Date.UTC(year, month - 1, day, hour);
  let timestamp = wallTime;
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = mountainDateParts(new Date(timestamp));
    const observedWallTime = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour));
    timestamp += wallTime - observedWallTime;
  }
  return timestamp;
}

async function readTrafficEventsSince(since) {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Capacity history is not configured.');
  }

  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${supabaseUrl}/rest/v1/traffic_events`);
    url.searchParams.set('select', 'event_type,created_at');
    url.searchParams.set('created_at', `gte.${since.toISOString()}`);
    url.searchParams.set('order', 'created_at.asc');
    url.searchParams.set('limit', String(pageSize));
    const response = await fetch(url, {
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message || `Could not read capacity history (${response.status}).`);
    if (!Array.isArray(result)) throw new Error('Capacity history returned an unexpected response.');
    rows.push(...result);
    if (result.length < pageSize) break;
  }
  return rows;
}

async function readCapacityReadingsSince(since) {
  if (!supabaseUrl || !supabaseServiceRoleKey) throw new Error('Capacity snapshots are not configured.');
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${supabaseUrl}/rest/v1/capacity_logs`);
    url.searchParams.set('select', 'recorded_at,current_headcount');
    url.searchParams.set('recorded_at', `gte.${since.toISOString()}`);
    url.searchParams.set('order', 'recorded_at.asc');
    url.searchParams.set('limit', String(pageSize));
    const response = await fetch(url, {
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message || `Could not read capacity snapshots (${response.status}).`);
    if (!Array.isArray(result)) throw new Error('Capacity snapshots returned an unexpected response.');
    rows.push(...result);
    if (result.length < pageSize) break;
  }
  return rows;
}

async function getCurrentOccupancy(dateKey = dateKeyFromParts(mountainDateParts(new Date()))) {
  const opening = mountainWallTime(dateKey, 6);
  const events = await readTrafficEventsSince(new Date(opening));
  let count = 0;
  for (const event of events) {
    if (!event.created_at || !['in', 'out'].includes(event.event_type)) continue;
    const parts = mountainDateParts(new Date(event.created_at));
    if (dateKeyFromParts(parts) !== dateKey || Number(parts.hour) < 6 || Number(parts.hour) >= 22) continue;
    count = Math.max(0, Math.min(MAX_GYM_CAPACITY, count + (event.event_type === 'in' ? 1 : -1)));
  }
  return count;
}

async function insertCapacitySnapshot(sampledAt) {
  const occupancy = await getCurrentOccupancy(dateKeyFromParts(mountainDateParts(sampledAt)));
  const latestUrl = new URL(`${supabaseUrl}/rest/v1/capacity_logs`);
  latestUrl.searchParams.set('select', 'outside_wait_mins,equipment_wait_mins');
  latestUrl.searchParams.set('order', 'recorded_at.desc');
  latestUrl.searchParams.set('limit', '1');
  const latestResponse = await fetch(latestUrl, {
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
    },
  });
  const latestRows = await latestResponse.json().catch(() => null);
  if (!latestResponse.ok) throw new Error(latestRows?.message || 'Could not read the latest capacity log.');
  const latest = Array.isArray(latestRows) ? latestRows[0] : null;
  const response = await fetch(`${supabaseUrl}/rest/v1/capacity_logs`, {
    method: 'POST',
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      recorded_at: sampledAt.toISOString().slice(0, 19),
      current_headcount: occupancy,
      capacity_percentage: Math.round((occupancy / MAX_GYM_CAPACITY) * 100),
      outside_wait_mins: latest?.outside_wait_mins ?? 0,
      equipment_wait_mins: latest?.equipment_wait_mins ?? null,
    }),
  });
  if (!response.ok) {
    const responseText = await response.text();
    let result;
    try { result = responseText ? JSON.parse(responseText) : null; } catch { result = null; }
    throw new Error(result?.message || result?.hint || `Capacity snapshot insert failed (${response.status}).`);
  }
}

function isGymOpenAt(date) {
  const parts = mountainDateParts(date);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute || 0);
  if (parts.weekday === 'Sun' || hour < 6 || hour >= 22) return false;
  if (parts.weekday === 'Tue' && hour === 11) return false;
  return minute % 15 === 0;
}

function scheduleCapacitySnapshot() {
  if (!supabaseUrl || !supabaseServiceRoleKey) return;
  const now = Date.now();
  let next = Math.floor(now / 900000) * 900000 + 900000;
  while (!isGymOpenAt(new Date(next))) next += 900000;
  setTimeout(async () => {
    try {
      await insertCapacitySnapshot(new Date(next));
    } catch (error) {
      console.error('Capacity snapshot failed:', error.message);
    } finally {
      scheduleCapacitySnapshot();
    }
  }, Math.max(0, next - Date.now()));
}

async function buildWeekCapacity() {
  const now = new Date();
  const nowParts = mountainDateParts(now);
  const todayKey = dateKeyFromParts(nowParts);
  const startKey = weekStartKey(todayKey);
  const since = new Date(`${shiftDateKey(startKey, -35)}T00:00:00-07:00`);
  const snapshots = await readCapacityReadingsSince(since);
  const quarterHours = new Map();
  for (const snapshot of snapshots) {
    const timestamp = snapshot.recorded_at.endsWith('Z') || /[+-]\d\d:\d\d$/.test(snapshot.recorded_at)
      ? snapshot.recorded_at
      : `${snapshot.recorded_at}Z`;
    const parts = mountainDateParts(new Date(timestamp));
    const date = dateKeyFromParts(parts);
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);
    if (hour < 6 || hour > 21 || minute % 15 !== 0) continue;
    const key = `${date}:${hour}`;
    if (!quarterHours.has(key)) quarterHours.set(key, new Map());
    quarterHours.get(key).set(minute, Number(snapshot.current_headcount));
  }

  const getHourlyAverage = (date, hour) => {
    const readings = quarterHours.get(`${date}:${hour}`);
    if (!readings || [0, 15, 30, 45].some(minute => !readings.has(minute))) return null;
    return { value: [0, 15, 30, 45].reduce((sum, minute) => sum + readings.get(minute), 0) / 4 };
  };
  const todayIndex = new Date(Date.UTC(
    Number(todayKey.slice(0, 4)), Number(todayKey.slice(5, 7)) - 1, Number(todayKey.slice(8, 10))
  )).getUTCDay();

  const days = {};
  for (let day = 0; day < 6; day++) {
    const date = shiftDateKey(startKey, day);
    const forecastDate = date >= todayKey && !(date === todayKey && Number(nowParts.hour) >= 22);
    days[date] = {};
    for (let hour = 6; hour <= 21; hour++) {
      if (day === 1 && hour === 11) {
        days[date][hour] = { closed: true, source: 'closed' };
        continue;
      }
      const hourIsPast = date < todayKey || (date === todayKey && hour < Number(nowParts.hour));
      if (!forecastDate || hourIsPast) {
        const actual = getHourlyAverage(date, hour);
        days[date][hour] = actual ? { ...actual, source: 'actual' } : null;
        continue;
      }

      const priorValues = [];
      for (let weeksAgo = 1; weeksAgo <= 4; weeksAgo++) {
        const prior = getHourlyAverage(shiftDateKey(date, -7 * weeksAgo), hour);
        if (prior) priorValues.push(prior.value);
      }
      days[date][hour] = priorValues.length
        ? { value: priorValues.reduce((sum, value) => sum + value, 0) / priorValues.length, samples: priorValues.length, source: 'forecast' }
        : null;
    }
  }

  return { weekStart: startKey, today: todayKey, todayIndex: todayIndex === 0 ? 6 : todayIndex - 1, currentHour: Number(nowParts.hour), days };
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

app.get('/api/week-capacity', async (req, res) => {
  try {
    return res.json(await buildWeekCapacity());
  } catch (error) {
    console.error('Week capacity load failed:', error);
    return res.status(503).json({ error: 'Capacity history is temporarily unavailable.' });
  }
});

app.get('/admin/current-count', async (req, res) => {
  if (!req.profile) return res.status(401).json({ error: 'Admin login required.' });
  if (req.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  try {
    return res.json({ count: await getCurrentOccupancy() });
  } catch (error) {
    console.error('Current capacity load failed:', error);
    return res.status(503).json({ error: 'Could not load the current count.' });
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
    scheduleCapacitySnapshot();
    if (!supabaseUrl || !supabasePublishableKey) {
      console.log('Supabase profile login is not configured; set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env.');
    }
  });
}

module.exports = { app };
