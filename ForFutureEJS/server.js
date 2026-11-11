const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = Number(process.env.PORT) || 3000;
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const gymTimeZone = process.env.GYM_TIME_ZONE || 'America/Denver';
const gymDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: gymTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

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

const plannedVisitSelect = [
  'planned_visit_id',
  'profile_id',
  'intended_arrival',
  'exit_time',
  'racks',
  'dumbbells',
  'cable_stacks',
  'weight_machines',
  'cardio_machines',
].join(',');

async function requestPlannedVisits({ profileId, method = 'GET', date, visitId, beforeArrival, body } = {}) {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Planned visit database access is not configured.');
  }

  const url = new URL(`${supabaseUrl}/rest/v1/planned_visits`);
  url.searchParams.set('select', plannedVisitSelect);
  if (profileId !== undefined) url.searchParams.set('profile_id', `eq.${profileId}`);
  if (visitId !== undefined) url.searchParams.set('planned_visit_id', `eq.${visitId}`);
  if (beforeArrival !== undefined) {
    url.searchParams.set('intended_arrival', `lt.${beforeArrival}`);
  }
  if (date) {
    const nextDate = new Date(`${date}T00:00:00Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const nextDateString = nextDate.toISOString().slice(0, 10);
    url.searchParams.set(
      'and',
      `(intended_arrival.gte.${date}T00:00:00,intended_arrival.lt.${nextDateString}T00:00:00)`
    );
  }

  const headers = {
    apikey: supabaseServiceRoleKey,
    Authorization: `Bearer ${supabaseServiceRoleKey}`,
  };
  const options = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = 'return=representation';
    options.body = JSON.stringify(body);
  }
  if (method === 'DELETE') headers.Prefer = 'return=representation';

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

async function requestAtomicPlannedVisit(body) {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Planned visit database access is not configured.');
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/reserve_planned_visit_atomic`, {
    method: 'POST',
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_visit: body }),
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
  return result;
}

function getGymClockParts() {
  const timeZone = process.env.GYM_TIME_ZONE || 'America/Denver';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

async function deleteOldPlannedVisits() {
  const gymNow = getGymClockParts();
  const cutoffDate = new Date(`${gymNow.date}T00:00:00Z`);
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 7);
  const cutoffDay = cutoffDate.toISOString().slice(0, 10);
  const cutoffTime = [gymNow.hour, gymNow.minute, gymNow.second]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
  const cutoff = `${cutoffDay}T${cutoffTime}`;

  return requestPlannedVisits({
    method: 'DELETE',
    beforeArrival: cutoff,
  });
}

function parsePlannedVisitInput(body) {
  const date = typeof body.date === 'string' ? body.date : '';
  const time = typeof body.time === 'string' ? body.time : '';
  const duration = Number(body.duration);
  const equipment = body.equipment;

  const dateMs = Date.parse(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || Number.isNaN(dateMs)
    || new Date(dateMs).toISOString().slice(0, 10) !== date
  ) {
    throw new Error('Please select a valid date.');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('Please select a valid start time.');
  }
  if (![30, 60, 90, 120].includes(duration)) {
    throw new Error('Choose a reservation duration of up to 2 hours.');
  }
  if (!Array.isArray(equipment) || equipment.some((value) => ![
    'Racks', 'Dumbbells', 'Cable stacks', 'Weight machines', 'Cardio machines',
  ].includes(value))) {
    throw new Error('Choose at least one intended equipment type.');
  }
  const uniqueEquipment = [...new Set(equipment)];
  if (!uniqueEquipment.length) {
    throw new Error('Select at least one type of equipment you plan to use.');
  }

  const gymNow = getGymClockParts();
  const todayMs = Date.parse(`${gymNow.date}T00:00:00Z`);
  const daysAhead = (dateMs - todayMs) / 86400000;
  if (daysAhead < 0 || daysAhead > 7) {
    throw new Error('Reservations can only be made today or up to 7 days in advance.');
  }

  const [startHour, startMinute] = time.split(':').map(Number);
  if (startMinute % 30 !== 0) throw new Error('Choose a start time in 30-minute increments.');
  const startMs = Date.parse(`${date}T${time}:00Z`);
  const nowMs = Date.UTC(
    gymNow.year,
    gymNow.month - 1,
    gymNow.day,
    gymNow.hour,
    gymNow.minute,
    gymNow.second
  );
  if (startMs < nowMs) throw new Error('You cannot book a reservation in the past.');

  const startMinuteOfDay = startHour * 60 + startMinute;
  const endMinuteOfDay = startMinuteOfDay + duration;
  if (endMinuteOfDay > 1440) throw new Error('Reservations cannot continue past midnight.');

  const endMs = startMs + duration * 60000;
  const toDatabaseTimestamp = (milliseconds) => new Date(milliseconds).toISOString().slice(0, 19);
  const selected = new Set(uniqueEquipment);
  return {
    date,
    duration,
    startMinuteOfDay,
    endMinuteOfDay,
    intended_arrival: toDatabaseTimestamp(startMs),
    exit_time: toDatabaseTimestamp(endMs),
    equipment: {
      racks: selected.has('Racks'),
      dumbbells: selected.has('Dumbbells'),
      cable_stacks: selected.has('Cable stacks'),
      weight_machines: selected.has('Weight machines'),
      cardio_machines: selected.has('Cardio machines'),
    },
  };
}

function parseScheduleTime(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function reservationFitsSchedule(startMinute, endMinute, scheduleRows) {
  if (!Array.isArray(scheduleRows)) return false;

  const intervals = scheduleRows.flatMap((row) => {
    if (row.is_closed_all_day === true) return [];
    const start = parseScheduleTime(row.open_time);
    let end = parseScheduleTime(row.close_time);
    if (start === null || end === null) return [];
    if (end === 0 && start > 0) end = 1440;
    else if (end <= start) end += 1440;
    return [{ start, end }];
  }).sort((a, b) => a.start - b.start);

  const mergedIntervals = [];
  for (const interval of intervals) {
    const previous = mergedIntervals[mergedIntervals.length - 1];
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      mergedIntervals.push({ ...interval });
    }
  }

  return mergedIntervals.some((interval) => (
    startMinute >= interval.start && endMinute <= interval.end
  ));
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

async function requestTrafficEvents() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Admin database access is not configured.');
  }

  const pageSize = 1000;
  const events = [];
  for (let start = 0; ; start += pageSize) {
    const url = new URL(`${supabaseUrl}/rest/v1/traffic_events`);
    url.searchParams.set('select', 'event_type,wait_time_min,created_at');
    url.searchParams.set('order', 'created_at.desc');

    const response = await fetch(url, {
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `******`,
        Prefer: 'count=exact',
        'Range-Unit': 'items',
        Range: `${start}-${start + pageSize - 1}`,
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
    if (!Array.isArray(result)) {
      throw new Error('Supabase returned an invalid traffic event list.');
    }

    events.push(...result);
    const contentRange = response.headers.get('content-range');
    const total = contentRange && Number(contentRange.split('/')[1]);
    if (result.length < pageSize || (Number.isFinite(total) && events.length >= total)) break;
  }

  const insideCount = events.reduce((count, event) => {
    if (event.event_type === 'in') return count + 1;
    if (event.event_type === 'out') return count - 1;
    return count;
  }, 0);

  return { events, insideCount };
}

async function requestOperatingHours(dayOfWeek, date) {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Admin database access is not configured.');
  }

  const url = new URL(`${supabaseUrl}/rest/v1/operating_hours`);
  url.searchParams.set('select', 'schedule_id,day_of_week,open_time,close_time,is_closed_all_day');
  url.searchParams.set('day_of_week', `eq.${dayOfWeek}`);
  url.searchParams.set('order', 'open_time.asc');

  const response = await fetch(url, {
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `******`,
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
  if (!Array.isArray(result)) {
    throw new Error('Supabase returned an invalid operating-hours list.');
  }

  const exceptionsUrl = new URL(`${supabaseUrl}/rest/v1/schedule_exceptions`);
  exceptionsUrl.searchParams.set(
    'select',
    'schedule_id,start_time,end_time,reason,is_closed_all_day'
  );
  exceptionsUrl.searchParams.set('exception_date', `eq.${date}`);
  const exceptionsResponse = await fetch(exceptionsUrl, {
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `******`,
    },
  });
  const exceptionsText = await exceptionsResponse.text();
  let exceptions;
  try {
    exceptions = exceptionsText ? JSON.parse(exceptionsText) : null;
  } catch {
    exceptions = null;
  }

  if (!exceptionsResponse.ok) {
    const message = exceptions?.message || exceptions?.hint || `Supabase request failed (${exceptionsResponse.status}).`;
    throw new Error(message);
  }
  if (!Array.isArray(exceptions)) {
    throw new Error('Supabase returned an invalid schedule exception list.');
  }
  if (!exceptions.length) return result;

  const exceptionsBySchedule = new Map();
  for (const exception of exceptions) {
    const entries = exceptionsBySchedule.get(exception.schedule_id) || [];
    entries.push(exception);
    exceptionsBySchedule.set(exception.schedule_id, entries);
  }

  return result.flatMap((schedule) => {
    const overrides = exceptionsBySchedule.get(schedule.schedule_id);
    if (!overrides) return [schedule];
    return overrides.map((exception) => ({
      ...schedule,
      open_time: exception.start_time,
      close_time: exception.end_time,
      reason: exception.reason,
      is_closed_all_day: exception.is_closed_all_day,
    }));
  });
}

async function requestLatestCapacityLog() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Capacity data access is not configured.');
  }

  const url = new URL(`${supabaseUrl}/rest/v1/capacity_logs`);
  url.searchParams.set(
    'select',
    'current_headcount,capacity_percentage,outside_wait_mins,equipment_wait_mins,recorded_at'
  );
  url.searchParams.set('order', 'recorded_at.desc');
  url.searchParams.set('limit', '1');

  const response = await fetch(url, {
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `******`,
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
  if (!Array.isArray(result)) {
    throw new Error('Supabase returned an invalid capacity log list.');
  }
  return result[0] || null;
}

function getZonedDateTimeParts(date) {
  return Object.fromEntries(
    gymDateTimeFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
}

function getUtcTimeForGymMidnight(date) {
  const [year, month, day] = date.split('-').map(Number);
  const targetUtc = Date.UTC(year, month - 1, day);
  let timestamp = targetUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = getZonedDateTimeParts(new Date(timestamp));
    const representedUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    const correction = targetUtc - representedUtc;
    timestamp += correction;
    if (correction === 0) break;
  }

  return new Date(timestamp);
}

function formatUtcDatabaseTimestamp(date) {
  return date.toISOString().replace('Z', '');
}

async function requestHourlyCapacityAverages(date) {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Capacity data access is not configured.');
  }

  const historicalStartDate = new Date(`${date}T00:00:00Z`);
  historicalStartDate.setUTCFullYear(historicalStartDate.getUTCFullYear() - 1);
  const historicalStart = getUtcTimeForGymMidnight(historicalStartDate.toISOString().slice(0, 10));
  const nextDate = new Date(`${date}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const end = getUtcTimeForGymMidnight(nextDate.toISOString().slice(0, 10));
  const startAt = formatUtcDatabaseTimestamp(historicalStart);
  const endAt = formatUtcDatabaseTimestamp(end);
  const pageSize = 1000;
  const todaySumsByHour = Array(24).fill(0);
  const todayCountsByHour = Array(24).fill(0);
  const weekdaySumsByHour = Array(24).fill(0);
  const weekdayCountsByHour = Array(24).fill(0);
  const targetWeekday = new Date(`${date}T00:00:00Z`).getUTCDay();

  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${supabaseUrl}/rest/v1/capacity_logs`);
    url.searchParams.set('select', 'recorded_at,capacity_percentage');
    url.searchParams.set('recorded_at', `gte.${startAt}`);
    url.searchParams.set('and', `(recorded_at.lt.${endAt})`);
    url.searchParams.set('order', 'recorded_at.asc');

    const response = await fetch(url, {
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `******`,
        'Range-Unit': 'items',
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });
    const responseText = await response.text();
    let rows;
    try {
      rows = responseText ? JSON.parse(responseText) : null;
    } catch {
      rows = null;
    }

    if (!response.ok) {
      const message = rows?.message || rows?.hint || `Supabase request failed (${response.status}).`;
      throw new Error(message);
    }
    if (!Array.isArray(rows)) {
      throw new Error('Supabase returned an invalid hourly capacity log list.');
    }

    for (const row of rows) {
      if (!Number.isInteger(row.capacity_percentage)
        || row.capacity_percentage < 0
        || row.capacity_percentage > 100
        || typeof row.recorded_at !== 'string') {
        throw new Error('Supabase returned an invalid capacity log row.');
      }

      const recordedAt = /(?:Z|[+-]\d{2}:\d{2})$/i.test(row.recorded_at)
        ? new Date(row.recorded_at)
        : new Date(`${row.recorded_at}Z`);
      if (Number.isNaN(recordedAt.getTime())) {
        throw new Error('Supabase returned an invalid capacity log timestamp.');
      }
      const parts = getZonedDateTimeParts(recordedAt);
      const localDate = `${parts.year}-${parts.month}-${parts.day}`;
      const hour = Number(parts.hour);
      if (localDate === date) {
        todaySumsByHour[hour] += row.capacity_percentage;
        todayCountsByHour[hour] += 1;
      } else if (
        localDate < date
        && localDate >= historicalStartDate.toISOString().slice(0, 10)
        && new Date(`${localDate}T00:00:00Z`).getUTCDay() === targetWeekday
      ) {
        weekdaySumsByHour[hour] += row.capacity_percentage;
        weekdayCountsByHour[hour] += 1;
      }
    }

    if (rows.length < pageSize) break;
  }

  const averagesFor = (sums, counts) => Array.from({ length: 24 }, (_, hour) => ({
    hour,
    average_capacity: counts[hour] ? sums[hour] / counts[hour] : null,
    sample_count: counts[hour],
  }));
  return {
    today: averagesFor(todaySumsByHour, todayCountsByHour),
    weekday: averagesFor(weekdaySumsByHour, weekdayCountsByHour),
    historical_start_date: historicalStartDate.toISOString().slice(0, 10),
  };
}

function getMaximumCapacity() {
  const maximumCapacity = process.env.GYM_MAX_CAPACITY === undefined
    ? 135
    : Number(process.env.GYM_MAX_CAPACITY);
  if (!Number.isSafeInteger(maximumCapacity) || maximumCapacity <= 0) {
    throw new Error('GYM_MAX_CAPACITY must be a positive whole number.');
  }
  return maximumCapacity;
}

async function deleteTrafficEvents() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Admin database access is not configured.');
  }

  const url = new URL(`${supabaseUrl}/rest/v1/traffic_events`);
  url.searchParams.set('event_type', 'not.is.null');
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `******`,
      Prefer: 'return=minimal',
    },
  });

  if (!response.ok) {
    const responseText = await response.text();
    let result;
    try {
      result = responseText ? JSON.parse(responseText) : null;
    } catch {
      result = null;
    }
    throw new Error(result?.message || result?.hint || `Supabase delete failed (${response.status}).`);
  }
}

async function insertCapacityResetLog() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Capacity data access is not configured.');
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/capacity_logs`, {
    method: 'POST',
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `******`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      recorded_at: new Date().toISOString().replace('Z', ''),
      capacity_percentage: 0,
      outside_wait_mins: 0,
      equipment_wait_mins: 0,
      current_headcount: 0,
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

function requireVisitProfile(req, res) {
  if (!req.profile) {
    res.status(401).json({ error: 'Log in to manage planned visits.' });
    return null;
  }
  if (req.profile.role === 'admin') {
    res.status(403).json({ error: 'Admins cannot plan visits.' });
    return null;
  }
  if (req.profile.profile_id === null || req.profile.profile_id === undefined) {
    res.status(403).json({ error: 'Your profile is missing its database ID. Please log in again.' });
    return null;
  }
  return req.profile;
}

app.get('/plan/visits', async (req, res) => {
  const profile = requireVisitProfile(req, res);
  if (!profile) return;
  try {
    const visits = await requestPlannedVisits({ profileId: profile.profile_id });
    res.set('Cache-Control', 'no-store');
    return res.json({ visits: Array.isArray(visits) ? visits : [] });
  } catch (error) {
    console.error('Planned visits fetch failed:', error);
    return res.status(500).json({ error: 'Could not load your planned visits.' });
  }
});

app.post('/plan/visits', async (req, res) => {
  const profile = requireVisitProfile(req, res);
  if (!profile) return;

  let reservation;
  try {
    reservation = parsePlannedVisitInput(req.body || {});
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const dayOfWeek = new Date(`${reservation.date}T00:00:00Z`).getUTCDay();
  let schedule;
  try {
    schedule = await requestOperatingHours(dayOfWeek, reservation.date);
  } catch (error) {
    console.error('Reservation schedule lookup failed:', error);
    return res.status(503).json({ error: 'Could not verify the gym schedule. Please try again.' });
  }
  if (!reservationFitsSchedule(
    reservation.startMinuteOfDay,
    reservation.endMinuteOfDay,
    schedule
  )) {
    return res.status(400).json({
      error: 'The selected time is outside the gym hours or overlaps a scheduled closure for that date.',
    });
  }

  try {
    const result = await requestAtomicPlannedVisit({
      profile_id: profile.profile_id,
      intended_arrival: reservation.intended_arrival,
      exit_time: reservation.exit_time,
      ...reservation.equipment,
    });
    if (result?.status === 'overlap') {
      return res.status(409).json({
        error: 'This time overlaps one of your existing reservations. Choose a different time.',
      });
    }
    if (result?.status === 'daily_limit') {
      const remaining = Number.isInteger(result.remaining_minutes)
        ? result.remaining_minutes
        : 0;
      return res.status(400).json({
        error: `Daily limit is 2 hours (120 min). You have ${remaining} min remaining for ${reservation.date}.`,
      });
    }
    if (result?.status !== 'saved' || !result.visit) {
      throw new Error('Supabase did not confirm the planned visit.');
    }
    return res.status(201).json({ visit: result.visit });
  } catch (error) {
    console.error('Atomic planned visit reservation failed:', error);
    return res.status(500).json({ error: 'Could not save your reservation. Please try again.' });
  }
});

app.delete('/plan/visits/:visitId', async (req, res) => {
  const profile = requireVisitProfile(req, res);
  if (!profile) return;
  const visitId = req.params.visitId;
  if (!/^[A-Za-z0-9-]+$/.test(visitId)) {
    return res.status(400).json({ error: 'Invalid planned visit ID.' });
  }

  try {
    const deleted = await requestPlannedVisits({
      profileId: profile.profile_id,
      visitId,
      method: 'DELETE',
    });
    if (!Array.isArray(deleted) || deleted.length === 0) {
      return res.status(404).json({ error: 'That reservation was not found.' });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('Planned visit cancellation failed:', error);
    return res.status(500).json({ error: 'Could not cancel the reservation. Please try again.' });
  }
});

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
  if (
    eventType === 'in'
    && waitTimeMin !== null
    && (!Number.isInteger(waitTimeMin) || waitTimeMin < 0 || waitTimeMin > 59)
  ) {
    return res.status(400).json({ error: 'Wait time must be null or a whole number from 0 to 59 minutes.' });
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

app.get('/admin/events', async (req, res) => {
  if (!req.profile) return res.status(401).json({ error: 'Admin login required.' });
  if (req.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });

  try {
    return res.json(await requestTrafficEvents());
  } catch (error) {
    console.error('Traffic events fetch failed:', error);
    return res.status(500).json({ error: 'Could not load gym activity.' });
  }
});

app.post('/admin/close', async (req, res) => {
  if (!req.profile) return res.status(401).json({ error: 'Admin login required.' });
  if (req.profile.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });

  try {
    await deleteTrafficEvents();
    await insertCapacityResetLog();
    return res.json({ ok: true });
  } catch (error) {
    console.error('Traffic events clear failed:', error);
    return res.status(500).json({ error: 'Could not close the gym and clear activity.' });
  }
});

app.get('/operating-hours', async (req, res) => {
  const dayOfWeek = Number(req.query.day_of_week);
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return res.status(400).json({ error: 'Day of week must be a number from 0 to 6.' });
  }
  if (!validDate) {
    return res.status(400).json({ error: 'Date must be a valid YYYY-MM-DD date.' });
  }
  if (new Date(`${date}T00:00:00Z`).getUTCDay() !== dayOfWeek) {
    return res.status(400).json({ error: 'Day of week does not match the requested date.' });
  }

  try {
    return res.json(await requestOperatingHours(dayOfWeek, date));
  } catch (error) {
    console.error('Operating hours fetch failed:', error);
    return res.status(500).json({ error: 'Could not load today’s operating hours.' });
  }
});

app.get('/capacity/latest', async (req, res) => {
  try {
    const latestCapacity = await requestLatestCapacityLog();
    res.set('Cache-Control', 'no-store');
    return res.json({
      capacity: latestCapacity
        ? {
            ...latestCapacity,
            at_max_capacity: Number.isInteger(latestCapacity.current_headcount)
              && latestCapacity.current_headcount >= getMaximumCapacity(),
          }
        : null,
    });
  } catch (error) {
    console.error('Latest capacity fetch failed:', error);
    return res.status(500).json({ error: 'Could not load live gym capacity.' });
  }
});

app.get('/capacity/hourly', async (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!validDate) {
    return res.status(400).json({ error: 'Date must be a valid YYYY-MM-DD date.' });
  }

  try {
    const hourlyAverages = await requestHourlyCapacityAverages(date);
    res.set('Cache-Control', 'no-store');
    return res.json({ date, ...hourlyAverages });
  } catch (error) {
    console.error('Hourly capacity fetch failed:', error);
    return res.status(500).json({ error: 'Could not load hourly gym capacity.' });
  }
});

app.post('/logout', (req, res) => {
  const sessionId = getCookie(req, SESSION_COOKIE);
  if (sessionId) profileSessions.delete(sessionId);
  clearSessionCookie(res);
  res.redirect(safeReturnPath(req.body.return_to));
});

// The stylesheet remains at the project root, one level above this server file.
function renderPage(view) {
  return (req, res) => res.render(view, {
    user: req.profile,
    currentPath: req.path,
    gymTimeZone: process.env.GYM_TIME_ZONE || 'America/Denver',
  });
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
  require('./capacityAgent');
  app.listen(port, () => {
    console.log(`BYU Gym Planner server listening on http://localhost:${port}`);
    if (!supabaseUrl || !supabasePublishableKey) {
      console.log('Supabase profile login is not configured; set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env.');
    }
  });
}

module.exports = { app, deleteOldPlannedVisits };
