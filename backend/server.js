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
// Threshold: 65% (irrigate if moisture < 65%)
const MOISTURE_THRESHOLD    = parseInt(process.env.MOISTURE_THRESHOLD) || 65;
const OPENWEATHER_API_KEY   = process.env.OPENWEATHER_API_KEY || '';
const DEFAULT_CITY          = process.env.CITY || 'Mumbai';
const DEFAULT_STATE         = process.env.STATE || 'Maharashtra';
const MONGODB_URI           = process.env.MONGODB_URI || '';
const GITHUB_AUTO_PUSH      = process.env.GITHUB_AUTO_PUSH === 'true';
const GIT_PUSH_INTERVAL_MIN = parseInt(process.env.GIT_PUSH_INTERVAL_MINUTES) || 30;
const JSON_SNAPSHOT_PATH    = process.env.JSON_SNAPSHOT_PATH || '../data/irrigation_data.json';
const ML_API_URL            = process.env.ML_API_URL || 'http://localhost:8000';

// Resolve snapshot path relative to this file's directory
const SNAPSHOT_FILE = path.resolve(__dirname, JSON_SNAPSHOT_PATH);

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
      status:       { type: String },
      irrigationOn: { type: Boolean },
      override:     { type: String, default: null },
      rainExpected: { type: Boolean, default: false },
      temperature:  { type: Number, default: null },
      weatherDesc:  { type: String, default: null },
      dataSource:   { type: String, default: 'real' },
      timestamp:    { type: Date, default: Date.now, index: true },
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
// SECTION 3 - MOCK DATA GENERATOR
// ==============================================================

const MOCK_BASE = { 1: 25, 2: 61, 3: 38, 4: 72 };

function loadMockData() {
  const now = new Date().toISOString();
  for (const nodeId of [1, 2, 3, 4]) {
    const base      = MOCK_BASE[nodeId];
    const variation = Math.floor(Math.random() * 11) - 5;
    const moisture  = Math.max(0, Math.min(100, base + variation));
    sensorData[nodeId] = {
      node:      nodeId,
      master:    nodeId <= 2 ? 1 : 2,
      moisture,
      updatedAt: now,
      override:  sensorData[nodeId].override,  // preserve manual override
    };
  }
}

if (MOCK_MODE) {
  loadMockData();
  setInterval(() => {
    loadMockData();
    processAndSnapshot().catch(err => console.error('Mock snapshot error: ' + err.message));
  }, 15000);
  console.log('MOCK: Fake sensor data refreshes every 15 seconds');
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

async function fetchMLPrediction(nodeData) {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const day_of_year = Math.floor(diff / (1000 * 60 * 60 * 24));
  const month = now.getMonth() + 1;

  // 1. Soil Composition Mapping (Configured mapping, not raw sensor measurements)
  const soilCompositionMap = {
    "Loamy": { clay_content: 20.0, sand_content: 40.0, silt_content: 40.0 },
    "Clay":  { clay_content: 60.0, sand_content: 20.0, silt_content: 20.0 },
    "Sandy": { clay_content: 10.0, sand_content: 80.0, silt_content: 10.0 }
  };
  const soilProps = soilCompositionMap[farmSettings.soilType] || soilCompositionMap["Loamy"];

  // 2. Historical features check
  // The backend does not yet maintain lag1, lag3, lag7, or roll7_mean.
  // We MUST NOT use placeholders or fake values.
  const hasHistory = false; // To be implemented in next phase

  if (!hasHistory) {
    return {
      available: false,
      error: "Missing required historical ML features (lag1, lag3, lag7, roll7). ML disabled until history cache is implemented."
    };
  }

  // Future payload when history is implemented:
  // const payload = {
  //   clay_content: soilProps.clay_content,
  //   sand_content: soilProps.sand_content,
  //   silt_content: soilProps.silt_content,
  //   sm_tgt_lag1: nodeData.history.lag1, 
  //   sm_tgt_lag3: nodeData.history.lag3, 
  //   sm_tgt_lag7: nodeData.history.lag7, 
  //   sm_tgt_roll7_mean: nodeData.history.roll7,
  //   month: month,
  //   day_of_year: day_of_year
  // };

  // try {
  //   const response = await fetch(`${ML_API_URL}/predict`, { ... });
  //   ...
  // }
}

// ==============================================================
// SECTION 5 - IRRIGATION DECISION LOGIC
// ==============================================================
//
// Priority order:
//   1. Manual override 'ON'  -> always ON
//   2. Manual override 'OFF' -> always OFF
//   3. No data (null)        -> OFF  (safe default, never open unknown valve)
//   4. Rain expected         -> OFF  (save water)
//   5. moisture < threshold  -> ON   (dry soil, irrigate)
//   6. Otherwise             -> OFF
//
// SAFETY: On error/unreliable data, always returns OFF.
// ==============================================================

function shouldIrrigate(moisture, rainExpected, override) {
  if (override === 'ON')  return true;
  if (override === 'OFF') return false;
  if (moisture === null || moisture === undefined) return false;
  
  // The user requested valves automatically turn on based ONLY on the 65% threshold
  // without being paused by the rain forecast. 
  return moisture < MOISTURE_THRESHOLD;
}

// ==============================================================
// SECTION 6 - BUILD PROCESSED NODE LIST
// ==============================================================

async function buildProcessedNodes(weather) {
  const rainExpected = weather && weather.available ? (weather.rainExpected || false) : false;
  const nodes = [];
  for (const nodeId of [1, 2, 3, 4]) {
    const d = sensorData[nodeId];
    const irrigationOn = shouldIrrigate(d.moisture, rainExpected, d.override);
    
    // Fetch ML data gracefully
    const mlData = await fetchMLPrediction(d);

    nodes.push({
      node:        nodeId,
      master:      d.master,
      moisture:    d.moisture,
      status:      d.moisture === null ? 'NO DATA' : (d.moisture < MOISTURE_THRESHOLD ? 'DRY' : 'OK'),
      irrigationOn,
      override:    d.override || null,
      updatedAt:   d.updatedAt,
      ml:          mlData
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
      status:       nodeData.moisture < MOISTURE_THRESHOLD ? 'DRY' : 'OK',
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

async function processAndSnapshot() {
  try {
    const weather        = await fetchWeather();
    const processedNodes = await buildProcessedNodes(weather);
    for (const n of processedNodes) {
      if (n.moisture !== null) {
        await saveToMongoDB(sensorData[n.node], n.irrigationOn, weather);
      }
    }
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
  };

  console.log('DATA: Master=' + master + ' Node=' + node + ' Moisture=' + moisture + '%');
  if (MOCK_MODE) console.log('   WARN: MOCK mode is ON - real data accepted but mock timer still runs');

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

  // Initial snapshot on startup
  if (MOCK_MODE) {
    setTimeout(() => {
      processAndSnapshot().catch(err => console.error('Startup snapshot error: ' + err.message));
    }, 1000);
  }
}

start().catch(err => {
  console.error('FATAL startup error: ' + err.message);
  process.exit(1);
});
