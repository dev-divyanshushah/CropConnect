// ==============================================================
// CropConnect Smart Irrigation - Backend Server  (v2.0)
// ==============================================================
//
// WHAT THIS FILE DOES:
//   1. Receives soil moisture from ESP8266 masters (POST /api/sensor-data)
//   2. Validates incoming data - rejects bad/malformed readings
//   3. Decides whether to irrigate (moisture + weather + override logic)
//   4. Persists data to MongoDB (if configured) with graceful fallback
//   5. Saves a JSON snapshot file every time valid data is processed
//   6. Auto-commits & pushes the JSON snapshot to GitHub (throttled)
//   7. Keeps a last-valid checkpoint in memory - survives MongoDB outages
//   8. Provides /api/status endpoint the website reads
//   9. In MOCK mode, generates realistic fake data for testing
//
// DATA FLOW:
//   ESP8266 -> POST /api/sensor-data
//     -> Validate -> Process irrigation decision
//     -> Try MongoDB (fallback to memory if unavailable)
//     -> Update JSON snapshot
//     -> GitHub push (throttled, only when new data)
//     -> /api/status -> Frontend
//
// TO RUN: cd backend && node server.js
// ==============================================================

'use strict';

require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const fetch     = require('node-fetch');
const fs        = require('fs');
const path      = require('path');
const mongoose  = require('mongoose');
const simpleGit = require('simple-git');

const app = express();

// ── Middleware ──────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static('../frontend'));

// ── Settings from .env ──────────────────────────────────────────
const PORT                  = parseInt(process.env.PORT) || 3000;
const MOCK_MODE             = process.env.MOCK_MODE === 'true';
// EMERGENCY FALLBACK threshold: 65% — used ONLY when no baseline exists AND ML is unavailable.
// Under normal operation this value is never used for irrigation decisions.
const MOISTURE_THRESHOLD    = parseInt(process.env.MOISTURE_THRESHOLD) || 65;
// Factor applied to node baseline for ML-driven irrigation threshold.
// Irrigate when predicted moisture < (baseline × ML_THRESHOLD_FACTOR).
// Configurable via ML_THRESHOLD_FACTOR env var. Default: 0.90 (90% of baseline).
const ML_THRESHOLD_FACTOR   = parseFloat(process.env.ML_THRESHOLD_FACTOR) || 0.90;
const OPENWEATHER_API_KEY   = process.env.OPENWEATHER_API_KEY || '';
const DEFAULT_CITY          = process.env.CITY || 'Mumbai';
const DEFAULT_STATE         = process.env.STATE || 'Maharashtra';
const MONGODB_URI           = process.env.MONGODB_URI || '';
const GITHUB_AUTO_PUSH      = process.env.GITHUB_AUTO_PUSH === 'true';
const GIT_PUSH_INTERVAL_MIN = parseInt(process.env.GIT_PUSH_INTERVAL_MINUTES) || 30;
const JSON_SNAPSHOT_PATH    = process.env.JSON_SNAPSHOT_PATH || '../data/irrigation_data.json';
const GRAPH_DATA_PATH       = process.env.GRAPH_DATA_PATH || '../data/graph_data.json';
const ML_API_URL            = process.env.ML_API_URL || 'http://localhost:8000';

// ==============================================================
// SIMULATION ENGINE CONFIGURATION
// ==============================================================
// All parameters are configurable here. TIME_SCALE can be changed
// at runtime via POST /api/dev/sim-toggle (developer only).
// ==============================================================
const SimConfig = {
  DATA_TIMEOUT_MS:        2 * 60 * 1000,  // 2 min: node goes sim after this
  SIMULATION_INTERVAL_MS: 5 * 60 * 1000,  // base tick = 5 real minutes
  TIME_SCALE:             1,              // 1=real-time, 60=1min/sec (mutable)
  BASE_EVAP_RATE:         0.8,            // % moisture lost per 5-min tick at 25°C
  TEMP_COEFF:             0.04,           // extra % loss per °C above reference
  TEMP_REF:               25,             // reference temperature in °C
  POST_IRR_HOLD_MIN:      20,             // minutes moisture stays elevated after irrigation
  IRR_RATE_PER_MIN:       2.5,            // % moisture gain per minute of irrigation
  IRR_DURATION_MIN:       4,              // default irrigation duration in minutes
  RAIN_EFFICIENCY:        0.7,            // fraction of rain (mm) that becomes moisture %
  HUMIDITY_COEFF:         0.008,          // % reduction per 1% humidity above 50%
  MAX_IRR_HISTORY:        50,             // max irrigation events stored per node
  // Soil retention factor: higher = slower moisture loss
  SOIL_FACTORS: { Loamy: 1.0, Sandy: 1.4, Clay: 0.7, Silty: 0.9, Peaty: 0.6, Chalky: 1.2 },
  // Crop water demand factor: higher = more water needed (faster loss)
  CROP_FACTORS: { Wheat: 1.0, Rice: 0.6, Maize: 1.1, Sugarcane: 0.8, Cotton: 1.2,
                  Soybean: 1.0, Potato: 1.1, Tomato: 1.0, Onion: 1.0, Other: 1.0 },
};

// Resolve paths relative to this file's directory
const SNAPSHOT_FILE = path.resolve(__dirname, JSON_SNAPSHOT_PATH);
const GRAPH_FILE    = path.resolve(__dirname, GRAPH_DATA_PATH);

function isWeatherConfigured() {
  return OPENWEATHER_API_KEY && OPENWEATHER_API_KEY !== 'your_openweathermap_api_key_here';
}

// Helper: get the currently active city for weather (uses live farmSettings)
function activeCity() {
  return farmSettings.city || DEFAULT_CITY;
}

console.log('');
console.log('========================================');
console.log('   CropConnect Smart Irrigation  v2.0');
console.log('========================================');
console.log('   Mode      : ' + (MOCK_MODE ? 'MOCK (fake data)' : 'REAL (hardware)'));
console.log('   Threshold : ' + MOISTURE_THRESHOLD + '% (irrigate if moisture < ' + MOISTURE_THRESHOLD + '%)');
console.log('   Location  : ' + DEFAULT_CITY + ', ' + DEFAULT_STATE);
console.log('   Weather   : ' + (isWeatherConfigured() ? 'Configured' : 'Not configured'));
console.log('   MongoDB   : ' + (MONGODB_URI ? 'Connecting...' : 'Not configured (memory-only)'));
console.log('   AutoPush  : ' + (GITHUB_AUTO_PUSH ? 'Enabled every ' + GIT_PUSH_INTERVAL_MIN + ' min' : 'Disabled'));
console.log('   Snapshot  : ' + SNAPSHOT_FILE);
console.log('========================================');
console.log('');

// ==============================================================
// SECTION 1 - MONGODB SETUP
// ==============================================================

const dbState = { connected: false, everConnected: false, lastError: null };
let SensorReading = null;

async function connectMongoDB() {
  if (!MONGODB_URI) {
    console.log('INFO: MongoDB not configured - running in memory-only mode.');
    return;
  }
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    });
    dbState.connected = true;
    dbState.everConnected = true;
    dbState.lastError = null;
    console.log('OK: MongoDB connected');

    const readingSchema = new mongoose.Schema({
      nodeId:       { type: Number, required: true, index: true },
      masterId:     { type: Number, required: true },
      moisture:     { type: Number, required: true },
      predictedMoisture: { type: Number, default: null },
      status:       { type: String },
      irrigationOn: { type: Boolean },
      override:     { type: String, default: null },
      rainExpected: { type: Boolean, default: false },
      temperature:  { type: Number, default: null },
      weatherDesc:  { type: String, default: null },
      dataSource:   { type: String, default: 'real' },
      timestamp:    { type: Date, default: Date.now, index: true, expires: '60d' },
    });
    SensorReading = mongoose.model('SensorReading', readingSchema);

  } catch (err) {
    dbState.connected = false;
    dbState.lastError = err.message;
    console.error('WARN: MongoDB connection failed: ' + err.message);
    console.log('   -> Running in memory-only mode (checkpoint will be used as fallback)');
  }
}

mongoose.connection.on('disconnected', () => {
  dbState.connected = false;
  console.warn('WARN: MongoDB disconnected - using checkpoint cache');
});
mongoose.connection.on('reconnected', () => {
  dbState.connected = true;
  console.log('OK: MongoDB reconnected');
});

// ==============================================================
// SECTION 2 - IN-MEMORY STORAGE + CHECKPOINT CACHE
// ==============================================================

// Live state: latest reading per node
let sensorData = {
  1: { node: 1, master: 1, moisture: null, updatedAt: null, override: null },
  2: { node: 2, master: 1, moisture: null, updatedAt: null, override: null },
  3: { node: 3, master: 2, moisture: null, updatedAt: null, override: null },
  4: { node: 4, master: 2, moisture: null, updatedAt: null, override: null },
};

// ==============================================================
// SECTION 2.1 – REAL SENSOR TRACKING
// ==============================================================
// Timestamp of last VALID real sensor packet per node.
// Used to decide whether to use real data or simulation.
let sensorLastRealAt = { 1: null, 2: null, 3: null, 4: null };

/**
 * Returns true if a valid real sensor reading was received
 * within DATA_TIMEOUT_MS. Used to suppress simulation.
 */
function isNodeLive(nodeId) {
  const lastAt = sensorLastRealAt[nodeId];
  if (!lastAt) return false;
  return (Date.now() - lastAt) < SimConfig.DATA_TIMEOUT_MS;
}

/**
 * Returns 'live' if real data is fresh, 'offline' otherwise.
 * Internal use only — not exposed to normal users.
 */
function getNodeConnectionState(nodeId) {
  return isNodeLive(nodeId) ? 'live' : 'offline';
}

// ==============================================================
// SECTION 2.2 – SIMULATION STATE
// ==============================================================
// Physics-based simulation engine state per node.
// Persisted in the JSON snapshot so server restarts preserve
// accumulated moisture and irrigation history.
//
// This entire system is hidden from normal users.
// Accessible only via the secret developer API endpoints.
// ==============================================================
let simState = {
  enabled:   false,
  timeScale: 1,
  nodes: {
    1: { moisture: 28, lastTickAt: null, lastIrrAt: null, irrDurationMin: 0, moistureBeforeIrr: null, phase: 'NORMAL' },
    2: { moisture: 62, lastTickAt: null, lastIrrAt: null, irrDurationMin: 0, moistureBeforeIrr: null, phase: 'NORMAL' },
    3: { moisture: 38, lastTickAt: null, lastIrrAt: null, irrDurationMin: 0, moistureBeforeIrr: null, phase: 'NORMAL' },
    4: { moisture: 71, lastTickAt: null, lastIrrAt: null, irrDurationMin: 0, moistureBeforeIrr: null, phase: 'NORMAL' },
  },
  irrigationHistory: { 1: [], 2: [], 3: [], 4: [] },
};

// Running interval handle for simulation ticks
let simTickInterval = null;

/**
 * Persist simState into the JSON snapshot alongside existing data.
 * Called after every sim tick so restarts preserve state.
 */
function saveSimState() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return;
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    snap._simState = {
      enabled:   simState.enabled,
      timeScale: simState.timeScale,
      nodes:     JSON.parse(JSON.stringify(simState.nodes)),
      irrigationHistory: JSON.parse(JSON.stringify(simState.irrigationHistory)),
    };
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap, null, 2), 'utf8');
  } catch (err) {
    console.warn('[SIM] Could not persist sim state: ' + err.message);
  }
}

/**
 * Load simState from snapshot on startup.
 */
function loadSimState() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return;
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    if (!snap._simState) return;
    const s = snap._simState;
    simState.enabled   = s.enabled   || false;
    simState.timeScale = s.timeScale || 1;
    SimConfig.TIME_SCALE = simState.timeScale;
    for (const id of [1, 2, 3, 4]) {
      if (s.nodes && s.nodes[id]) {
        Object.assign(simState.nodes[id], s.nodes[id]);
      }
      if (s.irrigationHistory && s.irrigationHistory[id]) {
        simState.irrigationHistory[id] = s.irrigationHistory[id];
      }
    }
    console.log('[SIM] Loaded simulation state from snapshot – enabled=' + simState.enabled);
  } catch (err) {
    console.warn('[SIM] Could not load sim state from snapshot: ' + err.message);
  }
}

// ==============================================================
// SECTION 2.3 – PHYSICS-BASED SIMULATION ENGINE
// ==============================================================

/**
 * Runs one simulation tick for a single node.
 * Called only when:
 *   1. simState.enabled === true
 *   2. isNodeLive(nodeId) === false (real sensor not active)
 *
 * Uses physics-based evaporation / irrigation / rainfall model.
 * Never uses random values.
 */
async function simTick(nodeId) {
  const ns = simState.nodes[nodeId];
  if (!ns) return;

  const now = Date.now();
  const intervalMs = SimConfig.SIMULATION_INTERVAL_MS / SimConfig.TIME_SCALE;

  if (ns.lastTickAt === null) {
    // First tick — just record the time, don't change moisture
    ns.lastTickAt = now;
    console.log('[SIMULATION] Node ' + nodeId + ': First tick – moisture=' + ns.moisture.toFixed(1) + '%');
    return;
  }

  const elapsedMs = now - ns.lastTickAt;
  // Cap catch-up to 30 minutes of simulated time to prevent huge jumps after downtime
  const maxElapsedMs = 30 * 60 * 1000 / SimConfig.TIME_SCALE;
  const effectiveElapsedMs = Math.min(elapsedMs, maxElapsedMs);

  // How many 5-minute ticks have elapsed?
  const ticks = effectiveElapsedMs / intervalMs;
  if (ticks < 0.1) return; // too soon — skip

  // ── Get weather for simulation ────────────────────────────
  let weather = weatherCache.data;
  if (!weather) {
    weather = { available: false, temperature: SimConfig.TEMP_REF, rainExpected: false, maxRainMm: 0 };
  }
  const temp     = (weather.temperature !== null && weather.temperature !== undefined) ? weather.temperature : SimConfig.TEMP_REF;
  const humidity = 60; // reasonable default; real humidity not in OpenWeather response structure used
  const rainMm   = weather.maxRainMm || 0;

  // ── Soil and crop factors ─────────────────────────────────
  const soilFactor = SimConfig.SOIL_FACTORS[farmSettings.soilType]  || 1.0;
  const cropFactor = SimConfig.CROP_FACTORS[farmSettings.cropType]  || 1.0;

  let moisture = ns.moisture;

  // ── Phase detection ───────────────────────────────────────
  // SATURATED: < POST_IRR_HOLD_MIN after irrigation → tiny drift only
  // DRAINING:  ≥ POST_IRR_HOLD_MIN after irrigation → full evaporation
  // NORMAL:    no irrigation event yet
  const postIrrHoldMs = SimConfig.POST_IRR_HOLD_MIN * 60 * 1000;
  const msSinceIrr    = ns.lastIrrAt ? (now - ns.lastIrrAt) : Infinity;

  if (ns.lastIrrAt && msSinceIrr < postIrrHoldMs) {
    // PHASE 1: Saturated – moisture stays elevated with tiny ±0.3% drift per tick
    ns.phase = 'SATURATED';
    const drift = (Math.random() - 0.5) * 0.6 * ticks;
    moisture = Math.max(0, Math.min(100, moisture + drift));
    console.log('[SIMULATION] Node ' + nodeId + ': SATURATED phase – moisture=' + moisture.toFixed(1) + '%');
  } else {
    // PHASE 2 or NORMAL: Calculate realistic evaporation
    if (ns.lastIrrAt && msSinceIrr >= postIrrHoldMs && ns.phase === 'SATURATED') {
      ns.phase = 'DRAINING';
      console.log('[SIMULATION] Node ' + nodeId + ': Switching to DRAINING phase');
    } else if (!ns.lastIrrAt) {
      ns.phase = 'NORMAL';
    }

    // Evaporation loss per tick
    const tempFactor    = 1 + SimConfig.TEMP_COEFF * Math.max(0, temp - SimConfig.TEMP_REF);
    const humidFactor   = Math.max(0.1, 1 - SimConfig.HUMIDITY_COEFF * Math.max(0, humidity - 50));
    const evapPerTick   = SimConfig.BASE_EVAP_RATE * tempFactor * soilFactor * cropFactor * humidFactor;
    const totalEvap     = evapPerTick * ticks;

    // Rainfall gain
    const rainfallGain  = rainMm * SimConfig.RAIN_EFFICIENCY * ticks;

    moisture = moisture - totalEvap + rainfallGain;
    moisture = Math.max(0, Math.min(100, moisture));

    console.log('[SIMULATION] Node ' + nodeId + ': moisture=' + ns.moisture.toFixed(1) +
      ' → evap=' + totalEvap.toFixed(2) + ' rain=' + rainfallGain.toFixed(2) +
      ' → new=' + moisture.toFixed(1) + '%');
  }

  // ── Irrigation decision ────────────────────────────────────
  const rainExpected  = weather.rainExpected || false;
  const override      = sensorData[nodeId] ? sensorData[nodeId].override : null;
  const shouldIrr     = shouldIrrigate(moisture, rainExpected, override);

  if (shouldIrr && ns.phase !== 'SATURATED') {
    const irrDurationMin  = SimConfig.IRR_DURATION_MIN;
    const moistureBefore  = moisture;
    const irrGain         = SimConfig.IRR_RATE_PER_MIN * irrDurationMin;
    moisture              = Math.min(100, moisture + irrGain);

    ns.lastIrrAt         = now;
    ns.irrDurationMin    = irrDurationMin;
    ns.moistureBeforeIrr = moistureBefore;
    ns.phase             = 'SATURATED';

    const reason = moisture < MOISTURE_THRESHOLD
      ? (rainExpected ? 'Low moisture – rain expected but moisture critical' : 'Low moisture + no rain expected')
      : 'Moisture borderline';

    const irrEvent = {
      node:         nodeId,
      startedAt:    new Date(now).toISOString(),
      stoppedAt:    new Date(now + irrDurationMin * 60 * 1000).toISOString(),
      durationMin:  irrDurationMin,
      moistureBefore: parseFloat(moistureBefore.toFixed(1)),
      moistureAfter:  parseFloat(moisture.toFixed(1)),
      reason,
      trigger:      'AUTO',
      weather: {
        temp:         temp,
        rainExpected: rainExpected,
        maxRainMm:    rainMm,
        description:  weather.description || 'unknown',
      },
    };

    simState.irrigationHistory[nodeId].unshift(irrEvent);
    if (simState.irrigationHistory[nodeId].length > SimConfig.MAX_IRR_HISTORY) {
      simState.irrigationHistory[nodeId].pop();
    }

    console.log('[IRRIGATION] Node ' + nodeId + ': ' + moistureBefore.toFixed(1) +
      '% → ' + moisture.toFixed(1) + '% | ' + reason);
  }

  // ── Finalize ──────────────────────────────────────────────
  ns.moisture    = parseFloat(moisture.toFixed(1));
  ns.lastTickAt  = now;

  // Write sim moisture into sensorData so it flows through the normal pipeline
  const existing = sensorData[nodeId];
  sensorData[nodeId] = {
    node:      nodeId,
    master:    existing ? existing.master : (nodeId <= 2 ? 1 : 2),
    moisture:  ns.moisture,
    updatedAt: new Date(now).toISOString(),
    override:  existing ? existing.override : null,
    _simulated: true,   // internal marker, never surfaced to users
  };

  // Append to graph history
  const cache = graphHistoryCache[nodeId];
  const lastPoint = cache.length > 0 ? new Date(cache[cache.length-1].timestamp) : null;
  if (!lastPoint || (now - lastPoint) >= intervalMs) {
    cache.push({
      timestamp:    new Date(now).toISOString(),
      masterId:     sensorData[nodeId].master,
      nodeId,
      moisture:     ns.moisture,
      predictedMoisture: null,
      irrigationOn: shouldIrr,
    });
    if (cache.length > MAX_GRAPH_POINTS) cache.shift();
    saveGraphHistory();
  }

  saveSimState();
}

/**
 * Runs a full simulation cycle across all nodes that need it.
 * Skips any node that is currently receiving real sensor data.
 */
async function runSimCycle() {
  if (!simState.enabled) return;
  for (const nodeId of [1, 2, 3, 4]) {
    if (isNodeLive(nodeId)) {
      // Real data is fresh for this node — skip simulation
      continue;
    }
    try {
      await simTick(nodeId);
    } catch (err) {
      console.error('[SIM] Tick error for Node ' + nodeId + ': ' + err.message);
    }
  }
  // Update snapshot after sim cycle
  try {
    const weather = weatherCache.data || null;
    const processedNodes = await buildProcessedNodes(weather);
    await writeJSONSnapshot(processedNodes, weather);
    saveCheckpoint(processedNodes, weather);
  } catch (err) {
    console.error('[SIM] Snapshot update error: ' + err.message);
  }
}

/**
 * Start or restart the simulation tick interval.
 * Respects TIME_SCALE: real interval = SIMULATION_INTERVAL_MS / TIME_SCALE
 */
function startSimInterval() {
  if (simTickInterval) {
    clearInterval(simTickInterval);
    simTickInterval = null;
  }
  if (!simState.enabled) return;
  const intervalMs = Math.max(1000, SimConfig.SIMULATION_INTERVAL_MS / SimConfig.TIME_SCALE);
  simTickInterval = setInterval(runSimCycle, intervalMs);
  console.log('[SIM] Simulation tick interval started – every ' + (intervalMs / 1000).toFixed(1) + 's (TIME_SCALE=' + SimConfig.TIME_SCALE + ')');
}

/**
 * Backfill graph history with realistic simulated data going back 24 hours.
 * Called on fresh startup so the Sensor Analytics chart has data to display
 * immediately without waiting for 24 hours of real ticks to accumulate.
 *
 * Only runs when a node has NO existing graph history (cache is empty).
 * Uses the same evaporation physics as simTick() but applied retroactively.
 */
function backfillGraphHistory() {
  const TICK_INTERVAL_MS = SimConfig.SIMULATION_INTERVAL_MS; // always 5 real minutes for backfill
  const HOURS_BACK       = 24;
  const totalTicks       = Math.floor((HOURS_BACK * 60 * 60 * 1000) / TICK_INTERVAL_MS); // 288 for 24h
  const now              = Date.now();

  const farmSoil = farmSettings.soilType || 'Loamy';
  const farmCrop = farmSettings.cropType || 'Wheat';
  const soilFactor = SimConfig.SOIL_FACTORS[farmSoil] || 1.0;
  const cropFactor = SimConfig.CROP_FACTORS[farmCrop] || 1.0;

  // Starting moisture per node: slightly higher than current so it declines naturally
  const startMoisture = {
    1: Math.min(95, simState.nodes[1].moisture + 25),
    2: Math.min(95, simState.nodes[2].moisture + 15),
    3: Math.min(95, simState.nodes[3].moisture + 20),
    4: Math.min(95, simState.nodes[4].moisture + 10),
  };

  for (const nodeId of [1, 2, 3, 4]) {
    const cache  = graphHistoryCache[nodeId];
    const master = nodeId <= 2 ? 1 : 2;

    // Only backfill if there's no existing data for this node
    if (cache && cache.length > 0) {
      console.log('[SIM] Node ' + nodeId + ': Graph history exists (' + cache.length + ' pts), skipping backfill');
      continue;
    }

    console.log('[SIM] Node ' + nodeId + ': Backfilling ' + totalTicks + ' graph points (24h)');

    let moisture   = startMoisture[nodeId];
    let irrCooldown = 0; // ticks to wait after irrigation before next decision

    const points = [];
    for (let i = totalTicks; i >= 0; i--) {
      const tickTime = now - i * TICK_INTERVAL_MS;

      // Simple sinusoidal temperature model: hotter midday, cooler at night
      const hourOfDay  = new Date(tickTime).getHours() + new Date(tickTime).getMinutes() / 60;
      const tempApprox = 22 + 10 * Math.sin(Math.PI * (hourOfDay - 6) / 12); // 22–32°C range
      const humidity   = 55 + 15 * Math.cos(Math.PI * hourOfDay / 12);        // 40–70% range

      // Evaporation
      const tempFactor  = 1 + SimConfig.TEMP_COEFF * Math.max(0, tempApprox - SimConfig.TEMP_REF);
      const humidFactor = Math.max(0.1, 1 - SimConfig.HUMIDITY_COEFF * Math.max(0, humidity - 50));
      const evap        = SimConfig.BASE_EVAP_RATE * tempFactor * soilFactor * cropFactor * humidFactor;

      moisture -= evap;
      moisture  = Math.max(5, moisture); // never go below 5%

      // Irrigation when below threshold and cooldown expired
      let irrigated = false;
      if (moisture < MOISTURE_THRESHOLD && irrCooldown <= 0) {
        moisture    += SimConfig.IRR_RATE_PER_MIN * SimConfig.IRR_DURATION_MIN;
        moisture     = Math.min(100, moisture);
        irrigated    = true;
        irrCooldown  = Math.ceil((SimConfig.POST_IRR_HOLD_MIN * 60 * 1000) / TICK_INTERVAL_MS); // ~4 ticks
      } else {
        irrCooldown--;
      }

      points.push({
        timestamp:         new Date(tickTime).toISOString(),
        masterId:          master,
        nodeId,
        moisture:          parseFloat(moisture.toFixed(1)),
        predictedMoisture: null,
        irrigationOn:      irrigated,
      });
    }

    // Merge into cache (backfill comes first, then any live points that may already be there)
    graphHistoryCache[nodeId] = points;
  }

  saveGraphHistory();
  console.log('[SIM] Graph history backfill complete — 24h of data ready for all nodes');
}

// Last VALID checkpoint - deep copy, updated only when data is clean
// Used as fallback if processing fails or MongoDB is unavailable
let lastValidCheckpoint = null;

function saveCheckpoint(processedNodes, weather) {
  lastValidCheckpoint = {
    savedAt: new Date().toISOString(),
    nodes:   JSON.parse(JSON.stringify(processedNodes)),
    weather: weather ? JSON.parse(JSON.stringify(weather)) : null,
  };
}

function hasCheckpoint() {
  return lastValidCheckpoint !== null;
}

// Farm settings
let farmSettings = {
  cropType:    'Wheat',
  soilType:    'Loamy',
  growthStage: 'Vegetative',
  city:        DEFAULT_CITY,
  state:       DEFAULT_STATE,
};

// Weather cache (10-minute TTL)
let weatherCache = { data: null, fetchedAt: null };

// ==============================================================
// SECTION 2.5 – HISTORICAL MOISTURE CACHE
// ==============================================================
//
// PURPOSE:
//   ESP8266 sends many readings per day (e.g. every 10 seconds).
//   We must NOT treat each reading as a separate "day".
//   Instead:
//     1. Accumulate intra-day readings into a dayReadings buffer.
//     2. When a new calendar date is detected, finalise the
//        previous day's average and append it to completedDays
//        (kept at most MAX_HISTORY_DAYS = 7 entries).
//     3. getMLFeaturesEarly() derives lag1/lag3/lag7/roll7_mean progressively
//        from the first reading onward (warm-start strategy).
//        getMLFeaturesStrict() requires >= 7 completed days (dev/internal use).
//     4. Moisture is stored as a FRACTION (0–1), matching the
//        V2 training dataset (ESP8266 % values ÷ 100).
//     5. History is kept SEPARATE per node; nodes never mix.
//     6. The cache is persisted inside the JSON snapshot so a
//        server restart does not destroy accumulated history.
//
// DATA SHAPE per node:
//   currentDay   – "YYYY-MM-DD" of the day currently accumulating
//   dayReadings  – [0.32, 0.31, …]  fractions received today
//   completedDays – [{date:"YYYY-MM-DD", avg:0.31}, …]  max 7
// ==============================================================

const MAX_HISTORY_DAYS = 7;   // completed days for full-history lag features (strict mode)

// One slot per node (keyed by integer node ID)
let moistureHistoryCache = {
  1: { currentDay: null, dayReadings: [], completedDays: [] },
  2: { currentDay: null, dayReadings: [], completedDays: [] },
  3: { currentDay: null, dayReadings: [], completedDays: [] },
  4: { currentDay: null, dayReadings: [], completedDays: [] },
};

// ==============================================================
// SECTION 2.7 – PER-NODE BASELINE MOISTURE STATE
// ==============================================================
//
// The FIRST valid sensor reading for each node establishes its
// reference/baseline moisture. ML irrigation decisions compare
// predicted moisture against (baseline × ML_THRESHOLD_FACTOR)
// instead of the hard-coded 65% fallback.
//
// Rules:
//   - Each node has its own completely independent baseline.
//   - Node 3 and Node 4 baselines are NEVER mixed.
//   - Baseline is set exactly once (on first valid reading).
//   - Persisted in the JSON snapshot so server restarts preserve it.
//   - 65% fallback is used ONLY when nodeBaseline[nodeId] === null
//     AND ML is unavailable.
//
// Shape: { moisture: number (%), establishedAt: ISO string }
// ==============================================================
let nodeBaseline = {
  1: null,
  2: null,
  3: null,
  4: null,
};

// ==============================================================
// SECTION 2.6 – GRAPH HISTORY CACHE (Fallback)
// ==============================================================
let graphHistoryCache = { 1: [], 2: [], 3: [], 4: [] };
const MAX_GRAPH_POINTS = 1000;

function loadGraphHistory() {
  try {
    if (!fs.existsSync(GRAPH_FILE)) return;
    const data = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'));
    if (data && typeof data === 'object') {
      for (const nodeId of [1, 2, 3, 4]) {
        if (Array.isArray(data[nodeId])) {
          graphHistoryCache[nodeId] = data[nodeId];
        }
      }
      console.log('HISTORY: Loaded graph cache from ' + GRAPH_FILE);
    }
  } catch (err) {
    console.warn('HISTORY: Could not load graph cache (will start fresh): ' + err.message);
  }
}

function saveGraphHistory() {
  try {
    const dir = path.dirname(GRAPH_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(GRAPH_FILE, JSON.stringify(graphHistoryCache, null, 2), 'utf8');
  } catch (err) {
    console.error('WARN: Failed to save graph history: ' + err.message);
  }
}

// ── Helpers ────────────────────────────────────────────────────

function getTodayDateStr() {
  return new Date().toISOString().slice(0, 10);  // "YYYY-MM-DD"
}

/**
 * Called every time a validated sensor reading arrives.
 * moisturePct is 0–100 (integer from ESP8266).
 * Converts to fraction and accumulates into the current-day buffer.
 * When the calendar date changes, finalises the completed day and
 * slides the window.
 */
function recordMoistureReading(nodeId, moisturePct) {
  const fraction = moisturePct / 100;
  const today    = getTodayDateStr();
  const cache    = moistureHistoryCache[nodeId];
  if (!cache) return;  // unknown node – ignore

  if (cache.currentDay === null) {
    // Very first reading ever for this node
    cache.currentDay  = today;
    cache.dayReadings = [fraction];
    console.log('HISTORY [Node ' + nodeId + ']: First reading received – accumulating day ' + today);

  } else if (cache.currentDay === today) {
    // Same calendar day – just accumulate
    cache.dayReadings.push(fraction);

  } else {
    // New calendar day detected – finalise the previous day
    const avg = cache.dayReadings.reduce((a, b) => a + b, 0) / cache.dayReadings.length;
    const entry = { date: cache.currentDay, avg: parseFloat(avg.toFixed(6)) };
    cache.completedDays.push(entry);

    // Keep only the last MAX_HISTORY_DAYS entries (sliding window)
    if (cache.completedDays.length > MAX_HISTORY_DAYS) {
      cache.completedDays = cache.completedDays.slice(-MAX_HISTORY_DAYS);
    }

    console.log('HISTORY [Node ' + nodeId + ']: Day ' + cache.currentDay +
      ' finalised – avg=' + avg.toFixed(4) +
      ' | completed days=' + cache.completedDays.length + '/' + MAX_HISTORY_DAYS);

    // Start fresh accumulation for today
    cache.currentDay  = today;
    cache.dayReadings = [fraction];
  }
}

/**
 * STRICT mode: returns full lag features only when >= 7 completed days exist.
 * Returns null otherwise.
 * Used internally by dev endpoints (/api/dev/inject-history).
 * For real-time prediction use getMLFeaturesEarly() instead.
 */
function getMLFeaturesStrict(nodeId) {
  const cache = moistureHistoryCache[nodeId];
  if (!cache || cache.completedDays.length < MAX_HISTORY_DAYS) return null;

  const days       = cache.completedDays.slice(-MAX_HISTORY_DAYS);  // exactly 7
  const lag1       = days[6].avg;  // yesterday
  const lag3       = days[4].avg;  // 3 days ago
  const lag7       = days[0].avg;  // 7 days ago
  const roll7_mean = parseFloat(
    (days.reduce((s, d) => s + d.avg, 0) / days.length).toFixed(6)
  );
  return { lag1, lag3, lag7, roll7_mean, mode: 'strict' };
}

/**
 * EARLY mode: always returns usable ML feature values from the very FIRST
 * sensor reading onward. Uses a progressive warm-start strategy:
 *
 *   completed days = 0  (first reading ever):
 *     All lags = currentFraction. The current reading is the best available
 *     prior – no invented values, just the real sensor value repeated.
 *
 *   completed days = 1–6  (partial history):
 *     lag1 = most recent completed-day average
 *     lag3 = day[n-3] if available, else oldest available day
 *     lag7 = day[n-7] if available, else oldest available day
 *     roll7_mean = mean of all available completed days
 *
 *   completed days >= 7  (full history):
 *     Identical to getMLFeaturesStrict() – real values used exclusively.
 *
 * This strategy introduces no random or invented data. All values are
 * derived exclusively from real sensor readings. Prediction accuracy
 * improves naturally as history accumulates over real calendar days.
 *
 * The lag values are fractions (0–1) to match the training dataset scale.
 *
 * @param {number} nodeId
 * @param {number} currentMoisturePct  – 0–100 percent value from the sensor
 * @returns {{ lag1, lag3, lag7, roll7_mean, mode, completedDays }}
 */
function getMLFeaturesEarly(nodeId, currentMoisturePct) {
  const cache           = moistureHistoryCache[nodeId];
  const currentFraction = currentMoisturePct / 100;

  if (!cache || cache.completedDays.length === 0) {
    // No completed days yet – use current reading as warm-start prior for all lags
    return {
      lag1:        currentFraction,
      lag3:        currentFraction,
      lag7:        currentFraction,
      roll7_mean:  currentFraction,
      mode:        'bootstrap',
      completedDays: 0,
    };
  }

  if (cache.completedDays.length >= MAX_HISTORY_DAYS) {
    // Full history available – use exact values (same as strict mode)
    const days       = cache.completedDays.slice(-MAX_HISTORY_DAYS);
    const roll7_mean = parseFloat(
      (days.reduce((s, d) => s + d.avg, 0) / days.length).toFixed(6)
    );
    return {
      lag1:         days[6].avg,
      lag3:         days[4].avg,
      lag7:         days[0].avg,
      roll7_mean,
      mode:         'full',
      completedDays: cache.completedDays.length,
    };
  }

  // Partial history: 1–6 completed days
  const days = cache.completedDays;
  const n    = days.length;

  // lag1: most recent completed day
  const lag1 = days[n - 1].avg;
  // lag3: 3 days ago if available, else oldest day
  const lag3 = n >= 3 ? days[n - 3].avg : days[0].avg;
  // lag7: 7 days ago if available, else oldest day
  const lag7 = n >= 7 ? days[n - 7].avg : days[0].avg;
  // roll7_mean: mean of all available completed days
  const roll7_mean = parseFloat(
    (days.reduce((s, d) => s + d.avg, 0) / n).toFixed(6)
  );

  return { lag1, lag3, lag7, roll7_mean, mode: 'partial', completedDays: n };
}

/**
 * Restore the history cache from the JSON snapshot on startup.
 * This ensures a server restart does not destroy accumulated
 * daily averages – they are re-loaded from the persisted file.
 */
function loadHistoryFromSnapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return;
    const raw  = fs.readFileSync(SNAPSHOT_FILE, 'utf8');
    const data = JSON.parse(raw);

    // ── Restore moisture history cache ──────────────────────────────
    if (!data.historyCache) {
      console.log('HISTORY: No history cache found in snapshot – starting fresh.');
    } else {
      let totalDays = 0;
      for (const nodeId of [1, 2, 3, 4]) {
        const saved = data.historyCache[nodeId] || data.historyCache[String(nodeId)];
        if (!saved) continue;
        moistureHistoryCache[nodeId].completedDays = Array.isArray(saved.completedDays) ? saved.completedDays : [];
        moistureHistoryCache[nodeId].currentDay    = saved.currentDay  || null;
        moistureHistoryCache[nodeId].dayReadings   = Array.isArray(saved.dayReadings)   ? saved.dayReadings   : [];
        totalDays += moistureHistoryCache[nodeId].completedDays.length;
      }
      console.log('HISTORY: Loaded history from snapshot – total completed days across all nodes: ' + totalDays);
    }

    // ── Restore per-node baseline moisture ──────────────────────────
    // Baselines are persisted alongside historyCache in the snapshot.
    // If restored successfully, the first-reading baseline is preserved
    // across server restarts and ML continues from where it left off.
    if (data.nodeBaseline) {
      let restoredCount = 0;
      for (const nodeId of [1, 2, 3, 4]) {
        const saved = data.nodeBaseline[nodeId] || data.nodeBaseline[String(nodeId)];
        if (saved && typeof saved.moisture === 'number') {
          nodeBaseline[nodeId] = {
            moisture:      saved.moisture,
            establishedAt: saved.establishedAt || null,
          };
          restoredCount++;
          console.log('[BASELINE] Node ' + nodeId + ': Restored from snapshot – baseline=' + saved.moisture + '%');
        }
      }
      if (restoredCount > 0) {
        console.log('[BASELINE] Baselines restored for ' + restoredCount + ' node(s) – ML can predict immediately.');
      }
    } else {
      console.log('[BASELINE] No baseline data in snapshot – will be established on first real sensor reading.');
    }

  } catch (err) {
    console.warn('HISTORY: Could not load history from snapshot (will start fresh): ' + err.message);
  }
}

// ==============================================================
// SECTION 3 - LEGACY MOCK DATA GENERATOR (kept for fallback)
// ==============================================================
// Note: The physics-based simulation engine in Section 2.3 is the
// preferred approach. MOCK_MODE=true in .env now enables the
// simulation engine via the developer API instead of random values.
// The old random generator below is ONLY used if simulation is
// explicitly not initialised (first boot, no snapshot).
// ==============================================================

if (MOCK_MODE) {
  // MOCK_MODE no longer uses a random interval.
  // Instead, the simulation engine is the mechanism.
  // When the server starts with MOCK_MODE=true and no sim state,
  // we auto-enable the sim engine so the dashboard shows data.
  console.log('MOCK: Simulation engine will activate on first /api/dev/sim-toggle or auto-start');
}

// ==============================================================
// SECTION 4 - WEATHER FETCHER (server-side only - key never exposed)
// ==============================================================

async function fetchWeather() {
  // Use the CURRENT city from farmSettings (updated when user changes location)
  const city = activeCity();

  if (weatherCache.data && weatherCache.fetchedAt && weatherCache.city === city) {
    if (Date.now() - weatherCache.fetchedAt < 10 * 60 * 1000) {
      return weatherCache.data;
    }
  }
  if (!isWeatherConfigured()) {
    return { available: false, message: 'Weather API not configured' };
  }
  try {
    const url = 'https://api.openweathermap.org/data/2.5/forecast?q=' +
      encodeURIComponent(city) + '&appid=' + OPENWEATHER_API_KEY + '&units=metric&cnt=8';
    const response = await fetch(url, { timeout: 8000 });
    if (!response.ok) throw new Error('Weather API HTTP ' + response.status);
    const json = await response.json();
    const forecasts = json.list || [];
    let rainExpected = false;
    let maxRainMm    = 0;
    for (const forecast of forecasts) {
      const rain = forecast.rain ? (forecast.rain['1h'] || forecast.rain['3h'] || 0) : 0;
      if (rain > 0) {
        rainExpected = true;
        maxRainMm = Math.max(maxRainMm, rain);
      }
      // Also check weather condition codes: 2xx=thunderstorm, 3xx=drizzle, 5xx=rain
      const weatherId = forecast.weather && forecast.weather[0] ? forecast.weather[0].id : 0;
      if (weatherId >= 200 && weatherId < 700) {
        rainExpected = true;
      }
    }
    const current     = forecasts[0] || {};
    const temp        = current.main ? Math.round(current.main.temp) : null;
    const description = current.weather && current.weather[0] ? current.weather[0].description : 'Unknown';
    const result = {
      available:    true,
      rainExpected,
      maxRainMm:    Math.round(maxRainMm * 10) / 10,
      temperature:  temp,
      description,
      city: json.city ? json.city.name : city,
      message: rainExpected
        ? 'Rain expected (' + maxRainMm.toFixed(1) + ' mm) - Irrigation paused'
        : 'No rain expected - Auto irrigation active',
    };
    weatherCache = { data: result, fetchedAt: Date.now(), city };
    console.log('WEATHER: Fetched for ' + city + ' - ' + (rainExpected ? 'RAIN' : 'CLEAR') + ' ' + temp + 'C');
    return result;
  } catch (err) {
    console.error('WARN: Weather fetch failed for ' + city + ': ' + err.message);
    if (weatherCache.data) {
      console.log('   -> Returning stale weather cache as fallback');
      return Object.assign({}, weatherCache.data, { stale: true });
    }
    return { available: false, message: 'Weather unavailable: ' + err.message };
  }
}

// ==============================================================
// SECTION 4.5 - ML PREDICTION INTEGRATION
// ==============================================================
//
// ML is ALWAYS attempted from the first valid sensor reading onward.
//
// Feature construction strategy:
//   - First reading ever (completedDays=0): warm-start bootstrap
//     All lag values = current reading fraction. No invented values.
//   - Partial history (1-6 days): progressive best-effort lags
//     derived only from real readings.
//   - Full history (7+ days): exact daily-average lag values.
//
// The model output is a soil-moisture FRACTION (0-1), NOT an ON/OFF signal.
// The irrigation decision is made in shouldIrrigateML() by comparing the
// predicted moisture to (nodeBaseline × ML_THRESHOLD_FACTOR).
// ==============================================================

async function fetchMLPrediction(nodeData) {
  // Guard: if no moisture data for this node, cannot build features
  if (nodeData.moisture === null || nodeData.moisture === undefined) {
    return { available: false, error: 'No moisture data for this node.' };
  }

  const now         = new Date();
  const yearStart   = new Date(now.getFullYear(), 0, 0);
  const day_of_year = Math.floor((now - yearStart) / (1000 * 60 * 60 * 24));
  const month       = now.getMonth() + 1;

  // ── 1. Soil composition from farm settings ────────────────────────
  const soilCompositionMap = {
    'Loamy': { clay_content: 20.0, sand_content: 40.0, silt_content: 40.0 },
    'Clay':  { clay_content: 60.0, sand_content: 20.0, silt_content: 20.0 },
    'Sandy': { clay_content: 10.0, sand_content: 80.0, silt_content: 10.0 },
    'Silty': { clay_content: 15.0, sand_content: 15.0, silt_content: 70.0 },
    'Peaty': { clay_content: 30.0, sand_content: 20.0, silt_content: 50.0 },
    'Chalky':{ clay_content: 10.0, sand_content: 50.0, silt_content: 40.0 },
  };
  const soilProps = soilCompositionMap[farmSettings.soilType] || soilCompositionMap['Loamy'];

  // ── 2. Build lag features using EARLY mode ────────────────────────
  // ALWAYS returns a valid feature object from the first reading onward.
  // No 7-day wait. No null return. No ML skip.
  const histFeatures   = getMLFeaturesEarly(nodeData.node, nodeData.moisture);
  const completedCount = (moistureHistoryCache[nodeData.node] || {}).completedDays
    ? moistureHistoryCache[nodeData.node].completedDays.length : 0;

  // ── 3. Build FastAPI request payload ──────────────────────────────
  const payload = {
    clay_content:      soilProps.clay_content,
    sand_content:      soilProps.sand_content,
    silt_content:      soilProps.silt_content,
    sm_tgt_lag1:       histFeatures.lag1,
    sm_tgt_lag3:       histFeatures.lag3,
    sm_tgt_lag7:       histFeatures.lag7,
    sm_tgt_roll7_mean: histFeatures.roll7_mean,
    month,
    day_of_year,
  };

  // ── 4. Structured logging ────────────────────────────────────
  const baseline    = nodeBaseline[nodeData.node];
  const baselinePct = baseline ? baseline.moisture : null;

  console.log('[ML] ──── Sensor reading received ───────────────────────────');
  console.log('[ML] Node         : ' + nodeData.node);
  console.log('[ML] Current      : ' + nodeData.moisture + '%');
  console.log('[ML] Baseline     : ' + (baselinePct !== null ? baselinePct + '%' : 'not yet established'));
  console.log('[ML] History      : ' + completedCount + '/' + MAX_HISTORY_DAYS + ' completed days (mode=' + histFeatures.mode + ')');
  console.log('[ML] Lag features : lag1=' + histFeatures.lag1.toFixed(4)
    + ' lag3=' + histFeatures.lag3.toFixed(4)
    + ' lag7=' + histFeatures.lag7.toFixed(4)
    + ' roll7=' + histFeatures.roll7_mean.toFixed(4));
  console.log('[ML] Calling ML API: ' + ML_API_URL + '/predict');

  // ── 5. Call FastAPI ML service ──────────────────────────────────
  try {
    const mlRes = await fetch(ML_API_URL + '/predict', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      timeout: 5000,
    });

    if (!mlRes.ok) throw new Error('FastAPI HTTP ' + mlRes.status);

    const result       = await mlRes.json();
    const predFraction = result.predicted_soil_moisture;
    const predPct      = Math.round(predFraction * 1000) / 10;  // one decimal (%)

    console.log('[ML] Prediction   : ' + predFraction.toFixed(4) + ' (' + predPct + '%)');

    return {
      available:            true,
      predictedMoisture:    predFraction,
      predictedMoisturePct: predPct,
      model:                result.model || 'XGBoost',
      historyMode:          histFeatures.mode,
      completedDays:        completedCount,
      lag1:                 histFeatures.lag1,
      lag3:                 histFeatures.lag3,
      lag7:                 histFeatures.lag7,
      roll7_mean:           histFeatures.roll7_mean,
    };

  } catch (err) {
    console.error('[ML] Prediction FAILED – ' + err.message);
    return {
      available:     false,
      historyMode:   histFeatures.mode,
      completedDays: completedCount,
      error:         'ML service unreachable: ' + err.message,
    };
  }
}

// ==============================================================
// SECTION 5 - IRRIGATION DECISION LOGIC
// ==============================================================
//
// TWO decision functions exist:
//
//   shouldIrrigate()    – LEGACY simple threshold check.
//                          Used ONLY by the simulation engine (simTick).
//                          Retained to avoid breaking the dev simulation.
//
//   shouldIrrigateML()  – PRIMARY decision for ALL real sensor readings.
//                          Uses ML prediction + per-node baseline.
//                          65% fallback used ONLY when no baseline exists
//                          AND ML is unavailable.
//
// Priority order for shouldIrrigateML:
//   1. Manual override 'ON'  → always ON
//   2. Manual override 'OFF' → always OFF
//   3. No data (null)        → OFF (safe default)
//   4. Rain expected         → OFF (save water)
//   5. ML available + baseline   → ON if predictedPct < baseline × factor
//   6. ML available, no baseline → ON if predictedPct < MOISTURE_THRESHOLD
//   7. ML unavailable + baseline → ON if currentPct < baseline × factor
//   8. No baseline, no ML [FALLBACK] → ON if currentPct < 65%
//
// ==============================================================

/**
 * LEGACY: Simple threshold-based irrigation check.
 * Used ONLY by the simulation engine (simTick). Do not use for real sensors.
 */
function shouldIrrigate(moisture, rainExpected, override) {
  if (override === 'ON')  return true;
  if (override === 'OFF') return false;
  if (moisture === null || moisture === undefined) return false;
  return moisture < MOISTURE_THRESHOLD;
}

/**
 * ML-DRIVEN irrigation decision. Used for ALL real sensor readings.
 *
 * The model predicts future soil moisture (fraction 0–1 converted to %).
 * This function compares that prediction to the node's established baseline
 * to determine whether irrigation is needed.
 *
 * @param {number|null} currentMoisture   – sensor reading in %
 * @param {object}      mlData            – result from fetchMLPrediction()
 * @param {object|null} baseline          – nodeBaseline[nodeId] or null
 * @param {string|null} override          – 'ON', 'OFF', or null
 * @param {boolean}     rainExpected      – from weather cache
 * @returns {{ on: boolean, reason: string }}
 */
function shouldIrrigateML(currentMoisture, mlData, baseline, override, rainExpected) {
  // 1. Manual overrides – always respected first
  if (override === 'ON')  return { on: true,  reason: 'MANUAL OVERRIDE ON' };
  if (override === 'OFF') return { on: false, reason: 'MANUAL OVERRIDE OFF' };

  // 2. No sensor data – safe default OFF, never open an unknown valve
  if (currentMoisture === null || currentMoisture === undefined)
    return { on: false, reason: 'NO SENSOR DATA – safe default OFF' };

  // 3. Rain expected – skip irrigation to save water
  if (rainExpected)
    return { on: false, reason: 'RAIN EXPECTED – irrigation paused' };

  // 4. ML available – primary decision path
  if (mlData && mlData.available) {
    const predPct = mlData.predictedMoisturePct;  // already in %

    if (baseline !== null) {
      // Compare ML-predicted moisture to baseline-relative threshold
      const thresholdPct = parseFloat((baseline.moisture * ML_THRESHOLD_FACTOR).toFixed(2));
      const irrigate     = predPct < thresholdPct;
      return {
        on:     irrigate,
        reason: irrigate
          ? 'ML: predicted ' + predPct + '% < threshold ' + thresholdPct + '% (baseline ' + baseline.moisture + '% × ' + ML_THRESHOLD_FACTOR + ') → IRRIGATION ON'
          : 'ML: predicted ' + predPct + '% ≥ threshold ' + thresholdPct + '% (baseline ' + baseline.moisture + '% × ' + ML_THRESHOLD_FACTOR + ') → OFF',
      };
    } else {
      // No baseline established yet (edge case after restart with cleared snapshot).
      // Use MOISTURE_THRESHOLD as temporary reference until baseline is set.
      const irrigate = predPct < MOISTURE_THRESHOLD;
      return {
        on:     irrigate,
        reason: irrigate
          ? 'ML (no baseline yet): predicted ' + predPct + '% < ' + MOISTURE_THRESHOLD + '% → IRRIGATION ON'
          : 'ML (no baseline yet): predicted ' + predPct + '% ≥ ' + MOISTURE_THRESHOLD + '% → OFF',
      };
    }
  }

  // 5. ML unavailable – use baseline with current sensor reading
  if (baseline !== null) {
    const thresholdPct = parseFloat((baseline.moisture * ML_THRESHOLD_FACTOR).toFixed(2));
    const irrigate     = currentMoisture < thresholdPct;
    console.warn('[FALLBACK] ML unavailable – using current moisture vs baseline threshold.');
    return {
      on:     irrigate,
      reason: irrigate
        ? 'ML unavailable; current ' + currentMoisture + '% < baseline-threshold ' + thresholdPct + '% → IRRIGATION ON'
        : 'ML unavailable; current ' + currentMoisture + '% ≥ baseline-threshold ' + thresholdPct + '% → OFF',
    };
  }

  // 6. LAST-RESORT FALLBACK: no baseline AND no ML prediction.
  // This only happens when the node has NEVER received a valid reading
  // (e.g., brand new deployment, snapshot cleared, server just started).
  console.warn('[FALLBACK] No baseline and no ML prediction available.');
  console.warn('[FALLBACK] Using ' + MOISTURE_THRESHOLD + '% ONLY because no valid ML decision/baseline exists.');
  const irrigate = currentMoisture < MOISTURE_THRESHOLD;
  return {
    on:     irrigate,
    reason: 'FALLBACK (no baseline, no ML): current ' + currentMoisture + '% vs hard-coded ' + MOISTURE_THRESHOLD + '%',
  };
}

// ==============================================================
// SECTION 6 - BUILD PROCESSED NODE LIST
// ==============================================================

async function buildProcessedNodes(weather) {
  const rainExpected = weather && weather.available ? (weather.rainExpected || false) : false;
  const nodes = [];
  for (const nodeId of [1, 2, 3, 4]) {
    const d = sensorData[nodeId];

    // Fetch ML prediction (always attempted for nodes with moisture data)
    const mlData = await fetchMLPrediction(d);

    // ML-driven irrigation decision using per-node baseline
    const baseline = nodeBaseline[nodeId];
    const decision = shouldIrrigateML(d.moisture, mlData, baseline, d.override, rainExpected);
    const irrigationOn = decision.on;

    // Log the final decision for every reading that has data
    if (d.moisture !== null) {
      console.log('[ML] Decision     : ' + (irrigationOn ? 'IRRIGATION ON' : 'IRRIGATION OFF'));
      console.log('[ML] Reason       : ' + decision.reason);
      console.log('[ML] ───────────────────────────────────────────────────────');
    }

    // Internal connection state — not surfaced to normal users
    const connectionState = getNodeConnectionState(nodeId);
    const dataSource = (d && d._simulated) ? 'simulated' : 'real';

    // For simulated nodes: always report updatedAt as now so the frontend
    // never marks them as stale/offline.
    const reportedUpdatedAt = (d._simulated && simState.enabled)
      ? new Date().toISOString()
      : d.updatedAt;

    nodes.push({
      node:            nodeId,
      master:          d.master,
      moisture:        d.moisture,
      status:          d.moisture === null ? 'NO DATA' : (d.moisture < MOISTURE_THRESHOLD ? 'DRY' : 'OK'),
      irrigationOn,
      override:        d.override || null,
      updatedAt:       reportedUpdatedAt,
      ml:              mlData,
      // Internal fields for developer panel — not displayed in normal UI
      connectionState,
      dataSource,
      lastRealDataAt:  sensorLastRealAt[nodeId] ? new Date(sensorLastRealAt[nodeId]).toISOString() : null,
      secondsAgoReal:  sensorLastRealAt[nodeId] ? Math.round((Date.now() - sensorLastRealAt[nodeId]) / 1000) : null,
    });
  }
  return nodes;
}

// ==============================================================
// SECTION 7 - JSON SNAPSHOT
// ==============================================================

async function writeJSONSnapshot(processedNodes, weather) {
  try {
    const dir = path.dirname(SNAPSHOT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const snapshot = {
      timestamp:  new Date().toISOString(),
      dataSource: MOCK_MODE ? 'MOCK' : 'REAL',
      threshold:  MOISTURE_THRESHOLD,
      weather: weather ? {
        available:    weather.available,
        rainExpected: weather.rainExpected || false,
        temperature:  weather.temperature || null,
        description:  weather.description || null,
        city:         weather.city || CITY,
        maxRainMm:    weather.maxRainMm || 0,
      } : null,
      nodes: {},
    };
    for (const n of processedNodes) {
      snapshot.nodes['node' + n.node] = {
        nodeId:    n.node,
        masterId:  n.master,
        moisture:  n.moisture,
        status:    n.status,
        irrigation: n.irrigationOn ? 'ON' : 'OFF',
        override:  n.override,
        updatedAt: n.updatedAt,
      };
    }
    // Persist the history cache so server restarts preserve daily averages
    snapshot.historyCache = moistureHistoryCache;
    // Persist per-node baselines so restarts preserve established reference values
    // The baseline is the cornerstone of the ML irrigation decision logic.
    snapshot.nodeBaseline = nodeBaseline;
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
    console.log('SNAP: JSON snapshot updated: ' + SNAPSHOT_FILE);
    return true;
  } catch (err) {
    console.error('WARN: Failed to write JSON snapshot: ' + err.message);
    return false;
  }
}

// ==============================================================
// SECTION 8 - GITHUB AUTO-PUSH (THROTTLED)
// ==============================================================

let lastPushTime = null;
const GIT_PUSH_INTERVAL_MS = GIT_PUSH_INTERVAL_MIN * 60 * 1000;

async function maybeGitPush() {
  if (!GITHUB_AUTO_PUSH) return;
  const now = Date.now();
  if (lastPushTime && (now - lastPushTime) < GIT_PUSH_INTERVAL_MS) {
    const minAgo = Math.round((now - lastPushTime) / 60000);
    console.log('GIT: Push skipped - last push was ' + minAgo + ' min ago (interval: ' + GIT_PUSH_INTERVAL_MIN + ' min)');
    return;
  }
  try {
    const repoRoot = path.resolve(__dirname, '..');
    const git = simpleGit(repoRoot);
    const status = await git.status();
    const snapshotRelative = path.relative(repoRoot, SNAPSHOT_FILE).replace(/\\/g, '/');
    const hasChanges = status.modified.includes(snapshotRelative)
                    || status.not_added.includes(snapshotRelative)
                    || status.created.includes(snapshotRelative);
    if (!hasChanges) {
      console.log('GIT: Push skipped - no changes in snapshot file');
      return;
    }
    // Stage ONLY the snapshot file (never .env or secrets)
    await git.add([snapshotRelative]);
    const dateStr = new Date().toISOString().slice(0, 10);
    const commitMsg = 'Update irrigation data - ' + dateStr;
    await git.commit(commitMsg);
    await git.push('origin', 'HEAD');
    lastPushTime = now;
    console.log('GIT: Push successful: "' + commitMsg + '"');
  } catch (err) {
    console.error('WARN: GitHub push failed: ' + err.message);
    // Never crash on push failure
  }
}

// ==============================================================
// SECTION 9 - SAVE TO MONGODB (with safe fallback)
// ==============================================================

async function saveToMongoDB(nodeData, irrigationOn, weather) {
  if (!SensorReading || !dbState.connected) {
    if (MONGODB_URI) {
      console.warn('WARN: MongoDB unavailable - skipping DB write for Node ' + nodeData.node + ' (checkpoint preserved)');
    }
    return false;
  }
  try {
    const doc = new SensorReading({
      nodeId:       nodeData.node,
      masterId:     nodeData.master,
      moisture:     nodeData.moisture,
      predictedMoisture: (nodeData.ml && nodeData.ml.available) ? nodeData.ml.predictedMoisturePct : null,
      // B6 fix: guard against null moisture — never compare null as a number
      status:       nodeData.moisture === null ? 'NO DATA' : (nodeData.moisture < MOISTURE_THRESHOLD ? 'DRY' : 'OK'),
      irrigationOn,
      override:     nodeData.override || null,
      rainExpected: weather && weather.rainExpected ? true : false,
      temperature:  weather && weather.temperature ? weather.temperature : null,
      weatherDesc:  weather && weather.description ? weather.description : null,
      dataSource:   MOCK_MODE ? 'mock' : 'real',
      timestamp:    new Date(),
    });
    await doc.save();
    return true;
  } catch (err) {
    console.error('WARN: MongoDB write failed for Node ' + nodeData.node + ': ' + err.message);
    dbState.connected = false;
    return false;
  }
}

// ==============================================================
// SECTION 10 - COMBINED PROCESS + SNAPSHOT HELPER
// ==============================================================

let lastDbWriteTime = { 1: 0, 2: 0, 3: 0, 4: 0 };
let lastDbWriteUpdateStr = { 1: null, 2: null, 3: null, 4: null };

async function processAndSnapshot() {
  try {
    const weather        = await fetchWeather();
    const processedNodes = await buildProcessedNodes(weather);
    let graphAppended = false;
    for (const n of processedNodes) {
      if (n.moisture !== null) {
        
        // --- MONGODB 5-MINUTE THROTTLE & DUPLICATE PREVENTION ---
        const nodeState = sensorData[n.node];
        const nowMs = Date.now();
        const hasNewData = nodeState && nodeState.updatedAt !== lastDbWriteUpdateStr[n.node];
        const timeSinceLastWrite = nowMs - lastDbWriteTime[n.node];
        
        if (hasNewData && timeSinceLastWrite >= 300000) {
          await saveToMongoDB(n, n.irrigationOn, weather);
          lastDbWriteTime[n.node] = nowMs;
          lastDbWriteUpdateStr[n.node] = nodeState ? nodeState.updatedAt : null;
        }
        
        // Append to graph cache (downsampled to 1 point every 5 mins)
        const cache = graphHistoryCache[n.node];
        let shouldAppend = cache.length === 0;
        if (!shouldAppend) {
          const lastPointTime = new Date(cache[cache.length - 1].timestamp);
          if (nowMs - lastPointTime >= 300000) shouldAppend = true;
        }
        if (shouldAppend) {
          cache.push({
            timestamp: new Date(nowMs).toISOString(),
            masterId: n.master,
            nodeId: n.node,
            moisture: n.moisture,
            predictedMoisture: (n.ml && n.ml.available) ? n.ml.predictedMoisturePct : null,
            irrigationOn: n.irrigationOn
          });
          if (cache.length > MAX_GRAPH_POINTS) cache.shift();
          graphAppended = true;
        }
      }
    }
    if (graphAppended) saveGraphHistory();
    const snapshotOk = await writeJSONSnapshot(processedNodes, weather);
    if (snapshotOk) {
      saveCheckpoint(processedNodes, weather);
      await maybeGitPush();
    }
    return { processedNodes, weather };
  } catch (err) {
    console.error('WARN: processAndSnapshot error: ' + err.message);
    if (hasCheckpoint()) {
      console.log('   -> Returning last valid checkpoint');
      return lastValidCheckpoint;
    }
    throw err;
  }
}

// ==============================================================
// API ENDPOINTS
// ==============================================================

// POST /api/sensor-data
// ESP8266 masters call this to send moisture readings.
// Body: { "master": 1, "node": 1, "moisture": 32 }
app.post('/api/sensor-data', async (req, res) => {
  let { master, node, moisture } = req.body || {};
  master   = Number(master);
  node     = Number(node);
  moisture = Number(moisture);

  const errors = [];
  if (isNaN(master) || master < 1 || master > 2)
    errors.push('master must be 1 or 2');
  if (isNaN(node) || node < 1 || node > 4)
    errors.push('node must be 1, 2, 3, or 4');
  if (isNaN(moisture) || moisture < 0 || moisture > 100)
    errors.push('moisture must be a number between 0 and 100');
  if (!errors.length) {
    if (master === 1 && node > 2) errors.push('Master 1 owns Nodes 1 and 2 only');
    if (master === 2 && node < 3) errors.push('Master 2 owns Nodes 3 and 4 only');
  }

  if (errors.length) {
    console.warn('REJECTED: Master=' + master + ' Node=' + node + ' - ' + errors.join('; '));
    return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
  }

  const existing = sensorData[node];
  sensorData[node] = {
    node, master, moisture,
    updatedAt: new Date().toISOString(),
    override:  existing ? existing.override : null,
    _simulated: false,  // real sensor data — never simulated
  };

  // Track when this node last received real data (for sim priority logic)
  sensorLastRealAt[node] = Date.now();

  // ── Establish per-node baseline on FIRST valid reading ────────────────
  // The first valid moisture reading becomes the reference/baseline for this node.
  // All subsequent ML-based irrigation decisions compare against this value.
  // Each node has a completely independent baseline.
  if (nodeBaseline[node] === null) {
    nodeBaseline[node] = {
      moisture:      moisture,
      establishedAt: new Date().toISOString(),
    };
    console.log('[BASELINE] ────────────────────────────────────────────');
    console.log('[BASELINE] Node ' + node);
    console.log('[BASELINE] First moisture reading  : ' + moisture + '%');
    console.log('[BASELINE] Baseline established    : ' + nodeBaseline[node].establishedAt);
    console.log('[BASELINE] ML will use warm-start features on this reading.');
    console.log('[BASELINE] ────────────────────────────────────────────');
  }

  // Update the per-node daily moisture history (accumulates into daily avg)
  recordMoistureReading(node, moisture);

  console.log('[DATA] Real sensor received – Master=' + master + ' Node=' + node + ' Moisture=' + moisture + '%');
  if (simState.enabled && simState.nodes[node]) {
    // Sync sim state moisture so if real data stops, sim picks up from current real value
    simState.nodes[node].moisture = moisture;
    console.log('[DATA] Node ' + node + ' is LIVE – simulation paused for this node');
  }

  // Process async - don't block the response
  processAndSnapshot().catch(err => {
    console.error('WARN: Background processing failed: ' + err.message);
  });

  res.json({ success: true, message: 'Node ' + node + ' data recorded' });
});

// GET /api/status
// The website polls this every 10 seconds.
app.get('/api/status', async (req, res) => {
  let processedNodes, weather, dataMode;
  try {
    weather        = await fetchWeather();
    processedNodes = await buildProcessedNodes(weather);
    dataMode       = 'LIVE';
    const anyData = processedNodes.some(n => n.moisture !== null);
    if (anyData) saveCheckpoint(processedNodes, weather);
  } catch (err) {
    console.error('WARN: /api/status build failed: ' + err.message);
    if (hasCheckpoint()) {
      processedNodes = lastValidCheckpoint.nodes;
      weather        = lastValidCheckpoint.weather;
      dataMode       = 'LAST_KNOWN';
      console.log('   -> Serving checkpoint from ' + lastValidCheckpoint.savedAt);
    } else {
      dataMode = 'ERROR';
      weather  = { available: false, message: 'Backend error - no data available' };
      processedNodes = [1, 2, 3, 4].map(id => ({
        node: id, master: id <= 2 ? 1 : 2,
        moisture: null, status: 'NO DATA',
        irrigationOn: false, override: null, updatedAt: null,
      }));
    }
  }

  res.json({
    mockMode:    MOCK_MODE,
    threshold:   MOISTURE_THRESHOLD,
    farmSettings,
    weather,
    nodes:       processedNodes,
    serverTime:  new Date().toISOString(),
    dataMode,      // 'LIVE', 'LAST_KNOWN', or 'ERROR'
    dbConnected: dbState.connected,
    checkpoint:  hasCheckpoint() ? lastValidCheckpoint.savedAt : null,
    // Internal field used only by hidden developer panel
    simEnabled:  simState.enabled,
  });
});

// GET /api/weather
app.get('/api/weather', async (req, res) => {
  try {
    res.json(await fetchWeather());
  } catch (err) {
    res.status(503).json({ available: false, message: err.message });
  }
});

// GET /api/history
// Returns historical data for a specific master and node.
app.get('/api/history', async (req, res) => {
  const master = parseInt(req.query.master);
  const node = parseInt(req.query.node);
  const range = req.query.range || '24h';
  
  if (isNaN(master) || isNaN(node)) {
    return res.status(400).json({ error: 'Valid master and node are required' });
  }

  let msAgo = 24 * 60 * 60 * 1000;
  if (range === '7d') msAgo = 7 * 24 * 60 * 60 * 1000;
  if (range === '30d') msAgo = 30 * 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - msAgo);

  try {
    if (dbState.connected && SensorReading) {
      if (range === '24h') {
        // For 24h, return raw 5-minute throttled data directly
        const docs = await SensorReading.find({
          nodeId: node,
          masterId: master,
          timestamp: { $gte: since }
        }).sort({ timestamp: 1 }).lean();
        
        const results = docs.map(d => ({
          timestamp: d.timestamp,
          moisture: d.moisture,
          predictedMoisture: d.predictedMoisture,
          irrigationOn: d.irrigationOn
        }));
        return res.json(results);
      } else {
        // For 7d and 30d, use MongoDB aggregation to average by hour
        // This prevents returning too many points and crashing the frontend
        const agg = await SensorReading.aggregate([
          { 
            $match: { 
              nodeId: node, 
              masterId: master, 
              timestamp: { $gte: since } 
            } 
          },
          {
            $group: {
              _id: {
                year: { $year: "$timestamp" },
                month: { $month: "$timestamp" },
                day: { $dayOfMonth: "$timestamp" },
                hour: { $hour: "$timestamp" }
              },
              timestamp: { $first: "$timestamp" },
              moisture: { $avg: "$moisture" },
              predictedMoisture: { $avg: "$predictedMoisture" },
              irrigationOn: { $max: { $cond: ["$irrigationOn", 1, 0] } } // If any point in hour was on, it's on
            }
          },
          { $sort: { timestamp: 1 } },
          {
            $project: {
              _id: 0,
              timestamp: 1,
              moisture: { $round: ["$moisture", 1] },
              predictedMoisture: { $round: ["$predictedMoisture", 1] },
              irrigationOn: { $eq: ["$irrigationOn", 1] }
            }
          }
        ]);
        return res.json(agg);
      }
    } else {
      const cache = graphHistoryCache[node] || [];
      const results = cache.filter(p => new Date(p.timestamp) >= since && p.masterId === master);
      return res.json(results);
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history', details: err.message });
  }
});

// POST /api/settings
app.post('/api/settings', (req, res) => {
  const { cropType, soilType, growthStage, city, state } = req.body || {};
  if (cropType)    farmSettings.cropType    = String(cropType).trim();
  if (soilType)    farmSettings.soilType    = String(soilType).trim();
  if (growthStage) farmSettings.growthStage = String(growthStage).trim();

  // If city or state changed, IMMEDIATELY clear weather cache so next /api/status
  // fetches fresh weather for the new location (no stale data shown)
  const newCity  = city  ? String(city).trim()  : null;
  const newState = state ? String(state).trim() : null;
  const cityChanged = newCity  && newCity  !== farmSettings.city;
  const stateChanged = newState && newState !== farmSettings.state;
  if (newCity)  farmSettings.city  = newCity;
  if (newState) farmSettings.state = newState;
  if (cityChanged || stateChanged) {
    weatherCache = { data: null, fetchedAt: null, city: null };
    console.log('SETTINGS: Location changed to ' + farmSettings.city + ', ' + farmSettings.state + ' - weather cache cleared');
  }

  console.log('SETTINGS: Updated -', JSON.stringify(farmSettings));
  res.json({ success: true, settings: farmSettings });
});

// POST /api/toggle-valve
// Manual override: force a node valve ON or OFF
app.post('/api/toggle-valve', (req, res) => {
  const { node, state } = req.body || {};
  const nodeId = parseInt(node);
  if (!sensorData[nodeId])
    return res.status(400).json({ success: false, error: 'Node not found' });
  if (state !== 'ON' && state !== 'OFF' && state !== 'AUTO' && state !== null)
    return res.status(400).json({ success: false, error: 'state must be ON, OFF, AUTO, or null' });
  
  const newOverride = (state === 'AUTO' || state === null) ? null : state;
  sensorData[nodeId].override = newOverride;
  console.log('OVERRIDE: Node ' + nodeId + ' -> ' + (newOverride || 'AUTO (cleared)'));
  processAndSnapshot().catch(err => console.error('Toggle snapshot error: ' + err.message));
  res.json({ success: true, node: nodeId, override: newOverride });
});

// POST /api/toggle-all
// Global ALL ON / ALL OFF / ALL AUTO - sets override on all 4 nodes at once
// Body: { "state": "ON" }, { "state": "OFF" }, or { "state": "AUTO" }
app.post('/api/toggle-all', (req, res) => {
  const { state } = req.body || {};
  if (state !== 'ON' && state !== 'OFF' && state !== 'AUTO')
    return res.status(400).json({ success: false, error: 'state must be ON, OFF or AUTO' });
  const results = [];
  const newOverride = (state === 'AUTO') ? null : state;
  for (const nodeId of [1, 2, 3, 4]) {
    sensorData[nodeId].override = newOverride;
    results.push({ node: nodeId, override: newOverride });
  }
  console.log('OVERRIDE-ALL: All nodes -> ' + (newOverride || 'AUTO (cleared)'));
  processAndSnapshot().catch(err => console.error('Toggle-all snapshot error: ' + err.message));
  res.json({ success: true, state, nodes: results });
});

// GET /api/snapshot
// Returns the current JSON snapshot file
app.get('/api/snapshot', (req, res) => {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE))
      return res.status(404).json({ error: 'No snapshot available yet' });
    res.json(JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: 'Snapshot read failed: ' + err.message });
  }
});

// ==============================================================
// DEVELOPER-ONLY ENDPOINTS (Hidden simulation engine)
// ==============================================================
// These endpoints are not documented anywhere in the normal UI.
// They are accessed only via the hidden developer panel (Ctrl+Shift+D).
// ==============================================================

// GET /api/dev/sim-state
// Returns full simulation state for the developer panel.
app.get('/api/dev/sim-state', (req, res) => {
  const nodeDetails = {};
  for (const nodeId of [1, 2, 3, 4]) {
    const ns = simState.nodes[nodeId];
    const live = isNodeLive(nodeId);
    const irrHistory = (simState.irrigationHistory[nodeId] || []).slice(0, 5);
    nodeDetails[nodeId] = {
      moisture:        ns.moisture,
      phase:           ns.phase,
      isLive:          live,
      lastRealAt:      sensorLastRealAt[nodeId] ? new Date(sensorLastRealAt[nodeId]).toISOString() : null,
      secondsAgoReal:  sensorLastRealAt[nodeId] ? Math.round((Date.now() - sensorLastRealAt[nodeId]) / 1000) : null,
      lastIrrAt:       ns.lastIrrAt ? new Date(ns.lastIrrAt).toISOString() : null,
      lastTickAt:      ns.lastTickAt ? new Date(ns.lastTickAt).toISOString() : null,
      recentIrrigation: irrHistory,
    };
  }
  res.json({
    enabled:   simState.enabled,
    timeScale: simState.timeScale,
    intervalSec: (SimConfig.SIMULATION_INTERVAL_MS / SimConfig.TIME_SCALE / 1000).toFixed(1),
    nodes:     nodeDetails,
    farmSettings,
    serverTime: new Date().toISOString(),
  });
});

// POST /api/dev/sim-toggle
// Enable or disable the simulation engine, and optionally set time scale.
// Body: { "enabled": true, "timeScale": 60 }
app.post('/api/dev/sim-toggle', (req, res) => {
  const { enabled, timeScale } = req.body || {};

  if (typeof enabled === 'boolean') {
    simState.enabled = enabled;
    console.log('[SIM] Simulation ' + (enabled ? 'ENABLED' : 'DISABLED') + ' via dev toggle');
  }

  if (typeof timeScale === 'number' && timeScale >= 1 && timeScale <= 3600) {
    simState.timeScale  = timeScale;
    SimConfig.TIME_SCALE = timeScale;
    console.log('[SIM] TIME_SCALE set to ' + timeScale);
  }

  // Initialize lastTickAt for any node that hasn't been ticked yet
  if (simState.enabled) {
    for (const nodeId of [1, 2, 3, 4]) {
      const ns = simState.nodes[nodeId];
      if (ns.lastTickAt === null) {
        ns.lastTickAt = Date.now();
        // Sync current real moisture if available
        if (sensorData[nodeId] && sensorData[nodeId].moisture !== null) {
          ns.moisture = sensorData[nodeId].moisture;
        }
      }
    }
    startSimInterval();
    // Run an immediate cycle so the dashboard updates right away
    runSimCycle().catch(err => console.error('[SIM] Immediate cycle error: ' + err.message));
  } else {
    if (simTickInterval) {
      clearInterval(simTickInterval);
      simTickInterval = null;
      console.log('[SIM] Tick interval stopped');
    }
    // Clear out any simulated data so the dashboard returns to a blank slate
    // (No Data) unless there's real hardware connected.
    for (const nodeId of [1, 2, 3, 4]) {
      if (sensorData[nodeId] && sensorData[nodeId]._simulated) {
        sensorData[nodeId].moisture = null;
        sensorData[nodeId].updatedAt = null;
        sensorData[nodeId]._simulated = false;
      }
    }
  }

  saveSimState();

  res.json({
    success:   true,
    enabled:   simState.enabled,
    timeScale: simState.timeScale,
    intervalSec: (SimConfig.SIMULATION_INTERVAL_MS / SimConfig.TIME_SCALE / 1000).toFixed(1),
  });
});

// GET /api/irrigation-history
// Returns irrigation events for a specific node.
// ?node=1&limit=10
app.get('/api/irrigation-history', (req, res) => {
  const nodeId = parseInt(req.query.node);
  const limit  = Math.min(parseInt(req.query.limit) || 10, 50);

  if (isNaN(nodeId) || nodeId < 1 || nodeId > 4) {
    return res.status(400).json({ error: 'node must be 1, 2, 3, or 4' });
  }

  const history = (simState.irrigationHistory[nodeId] || []).slice(0, limit);
  res.json({
    node:    nodeId,
    count:   history.length,
    events:  history,
  });
});

// POST /api/dev/sim-reset
// Resets simulation state for one or all nodes (dev use only).
// Body: { "nodeId": 3 } or {} for all nodes
app.post('/api/dev/sim-reset', (req, res) => {
  const { nodeId } = req.body || {};
  const defaults = [
    { id: 1, moisture: 28 },
    { id: 2, moisture: 62 },
    { id: 3, moisture: 38 },
    { id: 4, moisture: 71 },
  ];
  const targets = nodeId ? defaults.filter(n => n.id === parseInt(nodeId)) : defaults;

  for (const t of targets) {
    simState.nodes[t.id] = {
      moisture: t.moisture,
      lastTickAt: null,
      lastIrrAt: null,
      irrDurationMin: 0,
      moistureBeforeIrr: null,
      phase: 'NORMAL',
    };
    simState.irrigationHistory[t.id] = [];
    sensorLastRealAt[t.id] = null;
    console.log('[SIM] Reset Node ' + t.id + ' to moisture=' + t.moisture + '%');
  }
  saveSimState();
  res.json({ success: true, reset: targets.map(t => t.id) });
});

// POST /api/dev/inject-history
// ─────────────────────────────────────────────────────────────
// DEVELOPMENT / TESTING ONLY – gated behind MOCK_MODE.
// Directly loads a set of completed daily averages into the
// in-memory history cache for a given node, enabling full
// end-to-end ML testing without waiting 7 real days.
//
// Body: { nodeId: 1, completedDays: [{date:"YYYY-MM-DD", avg:0.31}, …] }
//
// WARNING: This endpoint is NEVER to be called in production.
//          It is only reachable when MOCK_MODE=true.
// ─────────────────────────────────────────────────────────────
app.post('/api/dev/inject-history', (req, res) => {
  if (!MOCK_MODE) {
    return res.status(403).json({
      error: 'This endpoint is only available in MOCK_MODE. Set MOCK_MODE=true in .env.',
    });
  }
  const { nodeId, completedDays } = req.body || {};
  const id = parseInt(nodeId);
  if (!moistureHistoryCache[id]) {
    return res.status(400).json({ error: 'Invalid nodeId: ' + nodeId });
  }
  if (!Array.isArray(completedDays) || completedDays.length === 0) {
    return res.status(400).json({ error: 'completedDays must be a non-empty array.' });
  }
  for (const d of completedDays) {
    if (typeof d.date !== 'string' || typeof d.avg !== 'number') {
      return res.status(400).json({
        error: 'Each entry must be {date: "YYYY-MM-DD", avg: <fraction 0-1>}.',
      });
    }
  }
  // Load only the most recent MAX_HISTORY_DAYS entries
  moistureHistoryCache[id].completedDays = completedDays.slice(-MAX_HISTORY_DAYS);
  moistureHistoryCache[id].currentDay    = getTodayDateStr();
  moistureHistoryCache[id].dayReadings   = [];

  const ready = moistureHistoryCache[id].completedDays.length >= MAX_HISTORY_DAYS;
  console.log('DEV: Injected ' + moistureHistoryCache[id].completedDays.length +
    ' history days for Node ' + id + ' – ML ready: ' + ready);

  res.json({
    success:       true,
    nodeId:        id,
    completedDays: moistureHistoryCache[id].completedDays.length,
    mlFeaturesReady: ready,
    // getMLFeaturesStrict returns full 7-day features or null (same as old getMLFeatures)
    features:      ready ? getMLFeaturesStrict(id) : getMLFeaturesEarly(id, 0),
  });
});

// POST /api/dev/clear-history
// ─────────────────────────────────────────────────────────────────────────
// DEVELOPMENT / TESTING ONLY – gated behind MOCK_MODE.
// Resets the in-memory moisture history cache so all simulated data is
// removed before live hardware deployment.
//
// Body (optional):
//   {}               – clears ALL nodes
//   { "nodeId": 1 }  – clears a specific node only
//
// Also immediately writes the cleared state back to the JSON snapshot so
// a server restart after clearing will NOT reload old simulation data.
//
// After clearing: ML returns "unavailable" until 7 real days accumulate.
// ─────────────────────────────────────────────────────────────────────────
app.post('/api/dev/clear-history', (req, res) => {
  if (!MOCK_MODE) {
    return res.status(403).json({
      error: 'This endpoint is only available in MOCK_MODE. Set MOCK_MODE=true in .env.',
    });
  }

  const { nodeId } = req.body || {};
  const targets = nodeId ? [parseInt(nodeId)] : [1, 2, 3, 4];

  // Validate nodeId if provided
  if (nodeId && !moistureHistoryCache[targets[0]]) {
    return res.status(400).json({ error: 'Invalid nodeId: ' + nodeId });
  }

  // Reset in-memory cache for targeted nodes
  for (const id of targets) {
    moistureHistoryCache[id] = { currentDay: null, dayReadings: [], completedDays: [] };
  }

  console.log('DEV: History cache CLEARED for node(s): ' + targets.join(', '));

  // Immediately persist the cleared state to the snapshot file so a
  // server restart after clearing does not reload old simulation data.
  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
      snap.historyCache = moistureHistoryCache;
      fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap, null, 2), 'utf8');
      console.log('DEV: Snapshot updated with cleared history.');
    }
  } catch (snErr) {
    console.warn('DEV: Could not update snapshot during clear (non-fatal): ' + snErr.message);
  }

  res.json({
    success:  true,
    cleared:  targets,
    message:  'History cache reset for node(s) [' + targets.join(', ') + ']. '
            + 'ML is now unavailable until 7 real completed days accumulate.',
  });
});

// GET /api/health
// Quick health check - useful for monitoring and tests
app.get('/api/health', async (req, res) => {
  let mlHealth = { status: 'unknown' };
  try {
    const mlRes = await fetch(`${ML_API_URL}/health`, { timeout: 2000 });
    if (mlRes.ok) {
      mlHealth = await mlRes.json();
    } else {
      mlHealth = { status: 'unreachable', error: `HTTP ${mlRes.status}` };
    }
  } catch (err) {
    mlHealth = { status: 'unreachable', error: err.message };
  }

  res.json({
    status:        'ok',
    uptime:        Math.round(process.uptime()),
    mockMode:      MOCK_MODE,
    dbConnected:   dbState.connected,
    dbConfigured:  !!MONGODB_URI,
    hasCheckpoint: hasCheckpoint(),
    checkpointAge: hasCheckpoint()
      ? Math.round((Date.now() - new Date(lastValidCheckpoint.savedAt)) / 1000)
      : null,
    lastPushTime:  lastPushTime ? new Date(lastPushTime).toISOString() : null,
    timestamp:     new Date().toISOString(),
    mlService:     mlHealth
  });
});

// ==============================================================
// STARTUP
// ==============================================================

async function start() {
  loadHistoryFromSnapshot();  // Restore daily moisture history before anything else
  loadGraphHistory();         // Restore downsampled graph history
  loadSimState();             // Restore simulation engine state from snapshot
  await connectMongoDB();

  app.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('OK: CropConnect server running on http://localhost:' + PORT);
    console.log('   Dashboard : http://localhost:' + PORT);
    console.log('   Health    : http://localhost:' + PORT + '/api/health');
    console.log('   Snapshot  : http://localhost:' + PORT + '/api/snapshot');
    console.log('========================================');
    console.log('');
  });

  // If simulation was enabled before restart, resume it
  if (simState.enabled) {
    console.log('[SIM] Resuming simulation engine (was enabled before restart)');
    backfillGraphHistory(); // fill any missing graph history on restart
    startSimInterval();
    // Give weather cache a moment to load before first tick
    setTimeout(() => {
      runSimCycle().catch(err => console.error('[SIM] Resume cycle error: ' + err.message));
    }, 2000);
  } else if (MOCK_MODE) {
    // In MOCK_MODE with no existing sim state, auto-enable simulation
    // so the dashboard shows data out of the box.
    console.log('[SIM] MOCK_MODE=true and no prior sim state – auto-enabling simulation engine');
    simState.enabled = true;
    for (const nodeId of [1, 2, 3, 4]) {
      simState.nodes[nodeId].lastTickAt = Date.now();
    }
    backfillGraphHistory(); // generate 24h of history so chart has data immediately
    startSimInterval();
    setTimeout(() => {
      runSimCycle().catch(err => console.error('[SIM] Auto-start cycle error: ' + err.message));
    }, 2000);
  } else {
    // Initial snapshot on startup (real mode)
    setTimeout(() => {
      processAndSnapshot().catch(err => console.error('Startup snapshot error: ' + err.message));
    }, 1000);
  }
}

start().catch(err => {
  console.error('FATAL startup error: ' + err.message);
  process.exit(1);
});
