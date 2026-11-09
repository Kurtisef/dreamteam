"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const appDirectory = path.join(__dirname, "ForFutureEJS");
const appRequire = createRequire(path.join(appDirectory, "package.json"));
const cron = appRequire("node-cron");
const { createClient } = appRequire("@supabase/supabase-js");
const { GoogleGenAI, Type } = appRequire("@google/genai");

function loadEnvFile() {
  const candidates = [
    path.join(__dirname, ".env"),
    path.join(appDirectory, ".env"),
  ];
  const envPaths = candidates.filter((candidate) => fs.existsSync(candidate));

  if (!envPaths.length) {
    throw new Error("Could not find .env at the project root or in ForFutureEJS.");
  }

  if (typeof process.loadEnvFile === "function") {
    for (const envPath of envPaths) process.loadEnvFile(envPath);
    return;
  }

  for (const envPath of envPaths) {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || process.env[match[1]] !== undefined) continue;

      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
        if (line.includes('"')) value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
      } else {
        value = value.replace(/\s+#.*$/, "").trim();
      }
      process.env[match[1]] = value;
    }
  }
}

loadEnvFile();

const { SUPABASE_URL, GEMINI_API_KEY } = process.env;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const supabaseKeyName = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? "SUPABASE_SERVICE_ROLE_KEY"
  : "SUPABASE_KEY";
if (!SUPABASE_URL || !supabaseKey || !GEMINI_API_KEY) {
  throw new Error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and GEMINI_API_KEY in .env.");
}

const maxCapacityValue = process.env.GYM_MAX_CAPACITY === undefined
  ? 135
  : Number(process.env.GYM_MAX_CAPACITY);
if (!Number.isSafeInteger(maxCapacityValue) || maxCapacityValue <= 0) {
  throw new Error("GYM_MAX_CAPACITY must be a positive whole number.");
}
const GYM_MAX_CAPACITY = maxCapacityValue;
const GYM_TIME_ZONE = process.env.GYM_TIME_ZONE || "America/Denver";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const gymDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: GYM_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const supabase = createClient(SUPABASE_URL, supabaseKey);
const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const geminiResponseSchema = {
  type: Type.OBJECT,
  properties: {
    capacity_percentage: { type: Type.INTEGER },
    outside_wait_mins: { type: Type.INTEGER },
    equipment_wait_mins: { type: Type.INTEGER },
    current_headcount: { type: Type.INTEGER },
  },
  required: [
    "capacity_percentage",
    "outside_wait_mins",
    "equipment_wait_mins",
    "current_headcount",
  ],
};

const expectedMetricKeys = [
  "capacity_percentage",
  "outside_wait_mins",
  "equipment_wait_mins",
  "current_headcount",
];
const equipmentIntentColumns = [
  "racks",
  "dumbbells",
  "cable_stacks",
  "weight_machines",
  "cardio_machines",
];
let runInProgress = false;

function formatGymTimestamp(date) {
  const parts = Object.fromEntries(
    gymDateTimeFormatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatUtcDatabaseTimestamp(date) {
  return date.toISOString().replace("Z", "");
}

function parseCapacityTimestamp(value) {
  if (typeof value !== "string") return NaN;
  const timestamp = (/(\.\d{3})\d+(?=Z|[+-]\d{2}:\d{2}$)/i.test(value)
    ? value.replace(/(\.\d{3})\d+(?=Z|[+-]\d{2}:\d{2}$)/i, "$1")
    : value);
  const timestampWithZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp)
    ? timestamp
    : `${timestamp}Z`;
  return new Date(timestampWithZone).getTime();
}

function validateMetrics(metrics) {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    throw new Error("Gemini returned a response that was not a JSON object.");
  }

  const keys = Object.keys(metrics).sort();
  const expectedKeys = expectedMetricKeys.slice().sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error("Gemini returned JSON with unexpected or missing metric keys.");
  }

  for (const key of expectedMetricKeys) {
    if (!Number.isInteger(metrics[key]) || metrics[key] < 0) {
      throw new Error(`Gemini returned an invalid non-negative integer for ${key}.`);
    }
  }
  if (metrics.capacity_percentage > 100) {
    throw new Error("Gemini returned a capacity percentage greater than 100.");
  }

  return metrics;
}

async function requestRecentTrafficEvents(startAt, endAt) {
  const pageSize = 1000;
  const events = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("traffic_events")
      .select("event_type,wait_time_min,created_at")
      .gte("created_at", startAt)
      .lte("created_at", endAt)
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Supabase returned an invalid traffic event list.");
    events.push(...data);
    if (data.length < pageSize) return events;
  }
}

async function requestCapacityLog({ ascending = false, belowMaximum = false } = {}) {
  let query = supabase
    .from("capacity_logs")
    .select("current_headcount,capacity_percentage,recorded_at");
  if (belowMaximum) query = query.lt("current_headcount", GYM_MAX_CAPACITY);

  const { data, error } = await query
    .order("recorded_at", { ascending })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function requestActivePlannedVisits(now) {
  const pageSize = 1000;
  const visits = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("planned_visits")
      .select("intended_arrival,exit_time,racks,dumbbells,cable_stacks,weight_machines,cardio_machines")
      .lte("intended_arrival", now)
      .gte("exit_time", now)
      .order("intended_arrival", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Supabase returned an invalid active visit list.");
    visits.push(...data);
    if (data.length < pageSize) return visits;
  }
}

async function extractGymData(now) {
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();
  const gymLocalNow = formatGymTimestamp(now);

  const [capacitySnapshot, latestBelowCapacitySnapshot, earliestCapacitySnapshot, trafficEvents, activePlannedVisits] = await Promise.all([
    requestCapacityLog(),
    requestCapacityLog({ belowMaximum: true }),
    requestCapacityLog({ ascending: true }),
    requestRecentTrafficEvents(oneHourAgo, nowIso),
    requestActivePlannedVisits(gymLocalNow),
  ]);

  const waitPeriodBaseline = latestBelowCapacitySnapshot
    || (earliestCapacitySnapshot?.current_headcount >= GYM_MAX_CAPACITY
      ? earliestCapacitySnapshot
      : null);
  const waitPeriodStart = waitPeriodBaseline?.recorded_at
    ? parseCapacityTimestamp(waitPeriodBaseline.recorded_at)
    : NaN;
  const waitPeriodEvents = Number.isFinite(waitPeriodStart)
    ? await requestRecentTrafficEvents(new Date(waitPeriodStart).toISOString(), nowIso)
    : [];

  return {
    now: nowIso,
    capacitySnapshot,
    trafficEvents,
    waitPeriodBaseline,
    waitPeriodEvents,
    activePlannedVisits,
  };
}

function summarizeOutsideWaitPeriod(data) {
  const baseline = data.waitPeriodBaseline;
  const baselineTime = baseline?.recorded_at
    ? parseCapacityTimestamp(baseline.recorded_at)
    : NaN;
  if (!baseline || !Number.isFinite(baselineTime) || !Number.isInteger(baseline.current_headcount)) {
    return {
      baselineRecordedAt: baseline?.recorded_at || null,
      baselineHeadcount: baseline?.current_headcount ?? null,
      eventReconstructedHeadcount: null,
      isAtMaxCapacity: false,
      waitTimesMins: [],
    };
  }

  let headcount = Math.max(0, baseline.current_headcount);
  let isAtMaxCapacity = headcount >= GYM_MAX_CAPACITY;
  let waitTimesMins = [];

  for (const event of data.waitPeriodEvents) {
    const eventTime = new Date(event.created_at).getTime();
    if (!Number.isFinite(eventTime) || eventTime <= baselineTime) continue;

    const previousHeadcount = headcount;
    if (event.event_type === "in") headcount += 1;
    if (event.event_type === "out") headcount = Math.max(0, headcount - 1);

    if (previousHeadcount < GYM_MAX_CAPACITY && headcount >= GYM_MAX_CAPACITY) {
      isAtMaxCapacity = true;
      waitTimesMins = [];
    } else if (previousHeadcount >= GYM_MAX_CAPACITY && headcount < GYM_MAX_CAPACITY) {
      isAtMaxCapacity = false;
      waitTimesMins = [];
    }

    if (
      headcount >= GYM_MAX_CAPACITY
      && Number.isInteger(event.wait_time_min)
      && event.wait_time_min >= 0
    ) {
      waitTimesMins.push(event.wait_time_min);
    }
  }

  return {
    baselineRecordedAt: baseline.recorded_at,
    baselineHeadcount: baseline.current_headcount,
    eventReconstructedHeadcount: headcount,
    isAtMaxCapacity,
    waitTimesMins,
  };
}

function summarizeGymData(data) {
  const baselineTime = data.capacitySnapshot?.recorded_at
    ? parseCapacityTimestamp(data.capacitySnapshot.recorded_at)
    : null;
  const eventsAfterSnapshot = data.trafficEvents.filter((event) => (
    !Number.isFinite(baselineTime) || new Date(event.created_at).getTime() > baselineTime
  ));
  const countEvents = (events) => ({
    check_ins: events.filter((event) => event.event_type === "in").length,
    check_outs: events.filter((event) => event.event_type === "out").length,
  });
  const equipmentIntentCounts = Object.fromEntries(equipmentIntentColumns.map((column) => [
    column,
    data.activePlannedVisits.filter((visit) => visit[column] === true).length,
  ]));

  return {
    now: data.now,
    capacitySnapshot: data.capacitySnapshot
      ? {
          current_headcount: data.capacitySnapshot.current_headcount,
          capacity_percentage: data.capacitySnapshot.capacity_percentage,
        }
      : null,
    trafficLast60Minutes: {
      ...countEvents(data.trafficEvents),
      eventsAfterCapacitySnapshot: countEvents(eventsAfterSnapshot),
    },
    outsideWaitPeriod: summarizeOutsideWaitPeriod(data),
    activePlannedVisits: {
      count: data.activePlannedVisits.length,
      equipmentIntentCounts,
    },
  };
}

function createPrompt(data) {
  const summary = summarizeGymData(data);
  summary.maximumCapacity = GYM_MAX_CAPACITY;
  return [
    "Estimate the gym's current status using only the supplied data.",
    "Return a single JSON object with exactly these four keys: capacity_percentage, outside_wait_mins, equipment_wait_mins, current_headcount.",
    "Every value must be a non-negative integer; capacity_percentage must be between 0 and 100.",
    "Use the most recent capacity snapshot as the headcount baseline. Adjust it by eventsAfterCapacitySnapshot.check_ins minus eventsAfterCapacitySnapshot.check_outs. If there is no snapshot, use the available check-ins and check-outs as the best estimate.",
    "If the snapshot exists but current_headcount is null, use the available post-snapshot events to estimate from zero and never return a negative count.",
    "Estimate outside_wait_mins only from outsideWaitPeriod.waitTimesMins. These samples have already been filtered to the latest uninterrupted period at maximum capacity; never use older or other traffic-event waits. If outsideWaitPeriod.isAtMaxCapacity is false or the sample list is empty, return 0.",
    "Set equipment_wait_mins to 0; the application calculates this metric deterministically from the current headcount and active planned equipment intent.",
    "Planned visits indicate intent, not confirmed arrivals; do not add them to current_headcount.",
    "Calculate capacity_percentage as current_headcount divided by maximumCapacity times 100, rounded to the nearest whole number and capped at 100.",
    "The input contains aggregate counts only. Do not infer individual identities or claim unsupported precision.",
    "Data:",
    JSON.stringify(summary),
  ].join("\n");
}

function calculateEquipmentWaitMinutes(currentHeadcount, activePlannedVisits) {
  const capacityPercentage = Math.min(
    100,
    Math.max(0, (currentHeadcount / GYM_MAX_CAPACITY) * 100)
  );
  if (capacityPercentage < 50) return 0;

  const crowdWaitMinutes = capacityPercentage <= 65
    ? ((capacityPercentage - 50) / 15) * 2.5
    : 2.5 + ((capacityPercentage - 65) / 35) * 6;
  const totalEquipmentIntents = activePlannedVisits.reduce((total, visit) => (
    total + equipmentIntentColumns.filter((column) => visit[column] === true).length
  ), 0);
  const plannedDemandRatio = Math.min(
    1,
    totalEquipmentIntents / (GYM_MAX_CAPACITY * equipmentIntentColumns.length)
  );
  const plannedDemandAdjustmentMinutes = plannedDemandRatio * 1.5;

  return Math.round(crowdWaitMinutes + plannedDemandAdjustmentMinutes);
}

async function transformGymData(data) {
  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: createPrompt(data),
    config: {
      responseMimeType: "application/json",
      responseSchema: geminiResponseSchema,
    },
  });

  if (typeof response.text !== "string" || response.text.trim() === "") {
    throw new Error("Gemini returned an empty response.");
  }

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (error) {
    throw new Error("Gemini returned invalid JSON.", { cause: error });
  }
  const metrics = validateMetrics(parsed);
  metrics.capacity_percentage = Math.min(
    100,
    Math.round((metrics.current_headcount / GYM_MAX_CAPACITY) * 100)
  );
  const outsideWaitPeriod = summarizeOutsideWaitPeriod(data);
  if (
    metrics.current_headcount < GYM_MAX_CAPACITY
    || !outsideWaitPeriod.isAtMaxCapacity
    || outsideWaitPeriod.waitTimesMins.length === 0
  ) {
    metrics.outside_wait_mins = 0;
  }
  metrics.equipment_wait_mins = calculateEquipmentWaitMinutes(
    metrics.current_headcount,
    data.activePlannedVisits
  );
  return metrics;
}

async function loadCapacityLog(metrics, recordedAt) {
  const { data, error } = await supabase
    .from("capacity_logs")
    .insert({
      recorded_at: recordedAt,
      current_headcount: metrics.current_headcount,
      capacity_percentage: metrics.capacity_percentage,
      outside_wait_mins: metrics.outside_wait_mins,
      equipment_wait_mins: metrics.equipment_wait_mins,
    })
    .select("capacity_logs_id,recorded_at")
    .single();

  if (error) throw error;
  return data;
}

async function runCapacityUpdate() {
  if (runInProgress) {
    console.warn("Capacity update skipped because the previous run is still in progress.");
    return;
  }

  runInProgress = true;
  const startedAt = new Date();
  console.log("Capacity update started:", startedAt.toISOString());

  try {
    const extractedData = await extractGymData(startedAt);
    const metrics = await transformGymData(extractedData);
    const insertedLog = await loadCapacityLog(metrics, formatUtcDatabaseTimestamp(new Date()));
    console.log("Capacity log saved:", insertedLog.recorded_at, metrics);
  } catch (error) {
    console.error("Capacity update failed:", error);
  } finally {
    runInProgress = false;
  }
}

console.log(`Capacity agent connected with ${supabaseKeyName}.`);
const runOnce = process.argv.includes("--once");
if (runOnce) {
  console.log("Running one capacity update without starting the scheduler.");
} else {
  console.log("Capacity agent will run immediately and then every 5 minutes.");
  cron.schedule("*/5 * * * *", () => {
    console.log("Scheduled capacity update triggered:", new Date().toISOString());
    return runCapacityUpdate();
  });
}
runCapacityUpdate();
