// ═══════════════════════════════════════════════════════════════
// CropConnect Smart Irrigation – Frontend Logic
// ═══════════════════════════════════════════════════════════════
//
// What this file does (in simple terms):
//   1. Every 10 seconds, asks the backend for sensor data
//   2. Updates each node card with moisture, status, irrigation
//   3. Updates the weather strip at the top
//   4. Handles the settings panel (crop type, soil type, etc.)
//
// Note: NO API keys here. Everything sensitive is in the backend.
// ═══════════════════════════════════════════════════════════════

// ── Backend URL ─────────────────────────────────────────────────
// When running locally, the backend is at http://localhost:3000
// When deployed to a server, change this to your server's address
const BACKEND_URL = 'http://localhost:3000';

// ── How often to refresh data ───────────────────────────────────
const REFRESH_INTERVAL_MS = 10000; // 10 seconds

// ─────────────────────────────────────────────────────────────────
// MAIN: Fetch status from backend and update the UI
// ─────────────────────────────────────────────────────────────────
async function fetchAndUpdate() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/status`);
    if (!response.ok) throw new Error(`Server error: ${response.status}`);
    const data = await response.json();

    // Update connection dot → green (connected)
    setConnectionStatus(true);

    // Show/hide the MOCK mode badge in the header
    const mockBadge = document.getElementById('mock-badge');
    if (data.mockMode) {
      mockBadge.classList.add('visible');
    } else {
      mockBadge.classList.remove('visible');
    }

    // Update weather strip
    updateWeatherStrip(data.weather);

    // Update each node card
    for (const node of data.nodes) {
      updateNodeCard(node, data.weather);
    }

    // Update farm settings fields (if user hasn't edited them)
    if (data.farmSettings) {
      updateSettingsFields(data.farmSettings);
    }

    // Update threshold display
    const thresholdEl = document.getElementById('threshold-display');
    if (thresholdEl) thresholdEl.textContent = `${data.threshold}%`;

  } catch (err) {
    console.error('❌ Could not reach backend:', err.message);
    setConnectionStatus(false);
  }
}

// ─────────────────────────────────────────────────────────────────
// Update the connection status indicator in the header
// ─────────────────────────────────────────────────────────────────
function setConnectionStatus(isConnected) {
  const dot  = document.getElementById('connection-dot');
  const text = document.getElementById('connection-text');
  if (isConnected) {
    dot.className = 'connection-dot connected';
    text.textContent = 'Live';
  } else {
    dot.className = 'connection-dot error';
    text.textContent = 'No connection';
  }
}

// ─────────────────────────────────────────────────────────────────
// Update the weather strip at the top of the dashboard
// ─────────────────────────────────────────────────────────────────
function updateWeatherStrip(weather) {
  const strip   = document.getElementById('weather-strip');
  const icon    = document.getElementById('weather-icon');
  const msg     = document.getElementById('weather-message');
  const sub     = document.getElementById('weather-sub');
  const tempEl  = document.getElementById('weather-temp');
  const descEl  = document.getElementById('weather-desc');

  if (!weather || !weather.available) {
    strip.className = 'weather-strip';
    icon.textContent = '🌡️';
    msg.textContent = 'Weather data unavailable';
    sub.textContent = 'Add your OpenWeatherMap API key in backend/.env to enable this';
    if (tempEl) tempEl.textContent = '—';
    if (descEl) descEl.textContent = '—';
    return;
  }

  if (weather.rainExpected) {
    strip.className = 'weather-strip rain';
    icon.textContent = '🌧️';
    msg.textContent = 'Rain is expected – Automatic irrigation is paused';
    sub.textContent = `Forecast: ${weather.description || 'Rain'} · Expected rainfall: ${weather.maxRainMm || 0} mm`;
  } else {
    strip.className = 'weather-strip clear';
    icon.textContent = '☀️';
    msg.textContent = 'No rain expected – Automatic irrigation is active';
    sub.textContent = `Forecast: ${weather.description || 'Clear'} · ${weather.city || ''}`;
  }

  if (tempEl) tempEl.textContent = weather.temperature !== null && weather.temperature !== undefined ? `${weather.temperature}°C` : '—';
  if (descEl) descEl.textContent = weather.description ? capitalize(weather.description) : '—';
}

// ─────────────────────────────────────────────────────────────────
// Update a single node card
// ─────────────────────────────────────────────────────────────────
function updateNodeCard(node, weather) {
  const card = document.getElementById(`node-card-${node.node}`);
  if (!card) return;

  const moisture    = node.moisture;
  const status      = node.status;       // 'OK', 'DRY', 'NO DATA'
  const irrigating  = node.irrigationOn;
  const updatedAt   = node.updatedAt;

  // ── Card state class ────────────────────────────────────────
  card.className = 'node-card';
  if (irrigating) {
    card.classList.add('state-irrigating');
  } else if (status === 'DRY') {
    card.classList.add('state-dry');
  } else if (status === 'OK') {
    card.classList.add('state-ok');
  } else {
    card.classList.add('state-nodata');
  }

  // ── Moisture value ──────────────────────────────────────────
  const moistureEl = card.querySelector('.moisture-value');
  if (moisture !== null) {
    moistureEl.textContent = Math.round(moisture);
    moistureEl.style.color = irrigating ? 'var(--blue)' : (status === 'DRY' ? 'var(--red)' : 'var(--green)');
  } else {
    moistureEl.textContent = '—';
    moistureEl.style.color = 'var(--text-muted)';
  }

  // ── Progress bar fill ───────────────────────────────────────
  const bar = card.querySelector('.moisture-bar-fill');
  const pct = moisture !== null ? Math.min(100, Math.max(0, moisture)) : 0;
  bar.style.width = `${pct}%`;
  bar.className = 'moisture-bar-fill';
  if (irrigating)     bar.classList.add('irrigating');
  else if (status === 'DRY') bar.classList.add('dry');

  // ── Status badge ────────────────────────────────────────────
  const badge = card.querySelector('.node-status-badge');
  badge.className = 'node-status-badge';
  if (status === 'OK') {
    badge.textContent = '✅ OK';
    badge.classList.add('badge-ok');
  } else if (status === 'DRY') {
    badge.textContent = '🔴 DRY';
    badge.classList.add('badge-dry');
  } else {
    badge.textContent = '⬜ No Data';
    badge.classList.add('badge-nodata');
  }

  // ── Irrigation row ──────────────────────────────────────────
  const irrRow   = card.querySelector('.irrigation-row');
  const irrValue = card.querySelector('.irrigation-value');
  if (irrigating) {
    irrRow.classList.add('active');
    irrValue.textContent = '💧 ON';
    irrValue.className = 'irrigation-value irr-on';
  } else {
    irrRow.classList.remove('active');
    irrValue.textContent = 'OFF';
    irrValue.className = 'irrigation-value irr-off';
  }

  // ── Last updated ────────────────────────────────────────────
  const lastUpdatedEl = card.querySelector('.last-updated');
  if (updatedAt) {
    const d = new Date(updatedAt);
    lastUpdatedEl.textContent = `Updated: ${d.toLocaleTimeString()}`;
  } else {
    lastUpdatedEl.textContent = 'No data received yet';
  }
}

// ─────────────────────────────────────────────────────────────────
// Update the settings form fields (only if user is not editing)
// ─────────────────────────────────────────────────────────────────
let userIsEditing = false;

function updateSettingsFields(settings) {
  if (userIsEditing) return;
  const fields = ['cropType', 'soilType', 'growthStage', 'city', 'state'];
  for (const field of fields) {
    const el = document.getElementById(`setting-${field}`);
    if (el && settings[field]) el.value = settings[field];
  }
}

// ─────────────────────────────────────────────────────────────────
// Save settings to backend
// ─────────────────────────────────────────────────────────────────
async function saveSettings() {
  const settings = {
    cropType:    document.getElementById('setting-cropType').value,
    soilType:    document.getElementById('setting-soilType').value,
    growthStage: document.getElementById('setting-growthStage').value,
    city:        document.getElementById('setting-city').value,
    state:       document.getElementById('setting-state').value,
  };

  try {
    const response = await fetch(`${BACKEND_URL}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!response.ok) throw new Error('Failed to save');
    const msg = document.getElementById('settings-save-msg');
    msg.classList.add('visible');
    setTimeout(() => msg.classList.remove('visible'), 2500);
  } catch (err) {
    console.error('Could not save settings:', err);
    alert('Could not save settings. Is the backend running?');
  }
}

// ─────────────────────────────────────────────────────────────────
// Toggle the settings panel open/closed
// ─────────────────────────────────────────────────────────────────
function toggleSettings() {
  const body = document.getElementById('settings-body');
  const icon = document.getElementById('settings-toggle-icon');
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  icon.classList.toggle('open', !isOpen);
}

// ─────────────────────────────────────────────────────────────────
// Utility: Capitalize first letter of a string
// ─────────────────────────────────────────────────────────────────
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─────────────────────────────────────────────────────────────────
// STARTUP: Run immediately and then every 10 seconds
// ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Mark as editing when user focuses any settings field
  document.querySelectorAll('.settings-field input, .settings-field select').forEach(el => {
    el.addEventListener('focus', () => { userIsEditing = true; });
    el.addEventListener('blur',  () => { userIsEditing = false; });
  });

  // Initial fetch
  fetchAndUpdate();

  // Refresh every 10 seconds
  setInterval(fetchAndUpdate, REFRESH_INTERVAL_MS);
});
