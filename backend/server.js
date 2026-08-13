// ═══════════════════════════════════════════════════════════════
// CropConnect Smart Irrigation – Backend Server
// ═══════════════════════════════════════════════════════════════
//
// What this file does (in simple terms):
//   1. Receives soil moisture data from ESP8266 masters (POST /api/sensor-data)
//   2. Decides whether to irrigate based on moisture + weather
//   3. Fetches weather forecast from OpenWeatherMap (server-side only)
//   4. Provides a /api/status endpoint that the website reads
//   5. In MOCK mode, generates fake sensor data for testing
//
// To run: node server.js
// ═══════════════════════════════════════════════════════════════

require('dotenv').config(); // Load settings from .env file
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

// ── Middleware ──────────────────────────────────────────────────
app.use(cors());            // Allow the website to call this server
app.use(express.json());    // Allow reading JSON data sent by ESP8266
app.use(express.static('../frontend')); // Serve the website files

// ── Settings (read from .env file) ─────────────────────────────
const PORT = process.env.PORT || 3000;
const MOCK_MODE = process.env.MOCK_MODE === 'true';
const MOISTURE_THRESHOLD = parseInt(process.env.MOISTURE_THRESHOLD) || 40;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const CITY = process.env.CITY || 'Delhi';
const STATE = process.env.STATE || 'Delhi';

console.log(`📋 Settings loaded:`);
console.log(`   Mode: ${MOCK_MODE ? '🧪 MOCK (fake data)' : '🔌 REAL (hardware)'}`);
console.log(`   Moisture threshold: ${MOISTURE_THRESHOLD}%`);
console.log(`   Location: ${CITY}, ${STATE}`);
console.log(`   Weather API: ${OPENWEATHER_API_KEY && OPENWEATHER_API_KEY !== 'your_openweathermap_api_key_here' ? '✅ Configured' : '⚠️  Not configured (weather disabled)'}`);

// ── In-memory Storage ───────────────────────────────────────────
// This stores the latest reading for each node (Node 1, 2, 3, 4)
// No database needed – simple JavaScript object
let sensorData = {
  1: { node: 1, master: 1, moisture: null, updatedAt: null },
  2: { node: 2, master: 1, moisture: null, updatedAt: null },
  3: { node: 3, master: 2, moisture: null, updatedAt: null },
  4: { node: 4, master: 2, moisture: null, updatedAt: null },
};

// Crop/farm settings (can be updated from the website later)
let farmSettings = {
  cropType: 'Wheat',
  soilType: 'Loamy',
  growthStage: 'Vegetative',
  city: CITY,
  state: STATE,
};

// Cache the last weather result (to avoid calling the API too often)
let weatherCache = {
  data: null,
  fetchedAt: null,
};

// ── Mock Data Generator ─────────────────────────────────────────
// These are the fake sensor values used in MOCK mode
const MOCK_VALUES = {
  1: 25,  // Node 1: 25% – DRY
  2: 61,  // Node 2: 61% – OK
  3: 38,  // Node 3: 38% – DRY
  4: 72,  // Node 4: 72% – OK
};

function loadMockData() {
  const now = new Date().toISOString();
  for (const nodeId of [1, 2, 3, 4]) {
    // Add small random variation (±5%) to make it feel realistic
    const base = MOCK_VALUES[nodeId];
    const variation = Math.floor(Math.random() * 11) - 5; // -5 to +5
    const moisture = Math.max(0, Math.min(100, base + variation));
    sensorData[nodeId] = {
      node: nodeId,
      master: nodeId <= 2 ? 1 : 2,
      moisture: moisture,
      updatedAt: now,
    };
  }
}

// In MOCK mode: refresh fake data every 15 seconds
if (MOCK_MODE) {
  loadMockData(); // Load immediately on startup
  setInterval(loadMockData, 15000);
  console.log('🧪 MOCK mode: Fake sensor data will refresh every 15 seconds');
}

// ── Weather Fetcher ─────────────────────────────────────────────
// This runs on the SERVER only – the API key never reaches the browser
async function fetchWeather() {
  // Return cached data if it's less than 10 minutes old
  if (weatherCache.data && weatherCache.fetchedAt) {
    const ageMs = Date.now() - weatherCache.fetchedAt;
    if (ageMs < 10 * 60 * 1000) {
      return weatherCache.data;
    }
  }

  // If no API key is set, return a "not available" response
  if (!OPENWEATHER_API_KEY || OPENWEATHER_API_KEY === 'your_openweathermap_api_key_here') {
    return { available: false, message: 'Weather API not configured' };
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?q=${CITY}&appid=${OPENWEATHER_API_KEY}&units=metric&cnt=8`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const json = await response.json();

    // Check if any forecast in the next 24 hours predicts rain
    let rainExpected = false;
    let maxRainMm = 0;
    const forecasts = json.list || [];

    for (const forecast of forecasts) {
      const rain = forecast.rain ? (forecast.rain['3h'] || 0) : 0;
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

    // Get current temperature and description
    const current = forecasts[0] || {};
    const temp = current.main ? Math.round(current.main.temp) : null;
    const description = current.weather && current.weather[0] ? current.weather[0].description : 'Unknown';

    const result = {
      available: true,
      rainExpected,
      maxRainMm: Math.round(maxRainMm * 10) / 10,
      temperature: temp,
      description: description,
      city: json.city ? json.city.name : CITY,
      message: rainExpected
        ? `🌧️ Rain expected (${maxRainMm.toFixed(1)} mm) – Irrigation paused`
        : `☀️ No rain expected – Auto irrigation active`,
    };

    // Save to cache
    weatherCache = { data: result, fetchedAt: Date.now() };
    return result;

  } catch (err) {
    console.error('⚠️  Weather fetch failed:', err.message);
    return { available: false, message: 'Weather data unavailable' };
  }
}

// ── Irrigation Decision Logic ───────────────────────────────────
// Simple rule: irrigate if moisture is below threshold AND no rain expected
function shouldIrrigate(moisture, rainExpected) {
  if (moisture === null) return false;          // No data yet, don't irrigate
  if (rainExpected) return false;               // Rain coming, save water
  return moisture < MOISTURE_THRESHOLD;         // Irrigate if soil is dry
}

// ═══════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════

// ── POST /api/sensor-data ───────────────────────────────────────
// ESP8266 masters call this to send moisture readings
// Example body: { "master": 1, "node": 1, "moisture": 32 }
app.post('/api/sensor-data', (req, res) => {
  const { master, node, moisture } = req.body;

  // Basic validation
  if (!master || !node || moisture === undefined) {
    return res.status(400).json({ error: 'Missing required fields: master, node, moisture' });
  }
  if (node < 1 || node > 4) {
    return res.status(400).json({ error: 'Node must be 1, 2, 3, or 4' });
  }
  if (moisture < 0 || moisture > 100) {
    return res.status(400).json({ error: 'Moisture must be between 0 and 100' });
  }
  if (MOCK_MODE) {
    // In mock mode, still accept data but log a warning
    console.log(`⚠️  MOCK mode is ON – received real data from Master ${master}, Node ${node} but mock values are active`);
  }

  sensorData[node] = {
    node: parseInt(node),
    master: parseInt(master),
    moisture: parseFloat(moisture),
    updatedAt: new Date().toISOString(),
  };

  console.log(`📡 Received: Master ${master}, Node ${node}, Moisture: ${moisture}%`);
  res.json({ success: true, message: `Data saved for Node ${node}` });
});

// ── GET /api/status ─────────────────────────────────────────────
// The website calls this to get all node statuses
app.get('/api/status', async (req, res) => {
  const weather = await fetchWeather();
  const rainExpected = weather.rainExpected || false;

  const nodes = [];
  for (const nodeId of [1, 2, 3, 4]) {
    const d = sensorData[nodeId];
    const irrigationOn = shouldIrrigate(d.moisture, rainExpected);

    nodes.push({
      node: nodeId,
      master: d.master,
      moisture: d.moisture,
      status: d.moisture === null ? 'NO DATA' : (d.moisture < MOISTURE_THRESHOLD ? 'DRY' : 'OK'),
      irrigationOn: irrigationOn,
      updatedAt: d.updatedAt,
    });
  }

  res.json({
    mockMode: MOCK_MODE,
    threshold: MOISTURE_THRESHOLD,
    farmSettings,
    weather,
    nodes,
    serverTime: new Date().toISOString(),
  });
});

// ── GET /api/weather ────────────────────────────────────────────
// The website can also call this separately for weather only
app.get('/api/weather', async (req, res) => {
  const weather = await fetchWeather();
  res.json(weather);
});

// ── POST /api/settings ──────────────────────────────────────────
// The website can update farm settings (crop, soil type, etc.)
app.post('/api/settings', (req, res) => {
  const { cropType, soilType, growthStage, city, state } = req.body;
  if (cropType) farmSettings.cropType = cropType;
  if (soilType) farmSettings.soilType = soilType;
  if (growthStage) farmSettings.growthStage = growthStage;
  if (city) farmSettings.city = city;
  if (state) farmSettings.state = state;
  console.log('⚙️  Farm settings updated:', farmSettings);
  res.json({ success: true, settings: farmSettings });
});

// ── Start Server ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('════════════════════════════════════════');
  console.log(`✅ CropConnect server running on http://localhost:${PORT}`);
  console.log(`🌐 Open the dashboard at: http://localhost:${PORT}`);
  console.log('════════════════════════════════════════');
  console.log('');
});
