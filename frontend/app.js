// =================================================================
// CropConnect Smart Irrigation - Frontend Logic  (v2.1)
// =================================================================
//
// What this file does:
//   1. Every 10 seconds, asks the backend for sensor data
//   2. Updates each node card with moisture, status, irrigation
//   3. Updates the weather strip at the top
//   4. Handles individual valve toggle AND global ALL ON / ALL OFF
//   5. Handles State -> City dependent dropdown for 29 Indian states
//   6. Handles the settings panel (crop type, soil type, etc.)
//
// Note: NO API keys here. Everything sensitive is in the backend.
// =================================================================

// ── Backend URL ──────────────────────────────────────────────────
const BACKEND_URL = 'http://localhost:3000';

// ── How often to refresh data ────────────────────────────────────
const REFRESH_INTERVAL_MS = 10000; // 10 seconds

// =================================================================
// INDIA STATE -> CITY MAP  (all 29 states)
// Add or adjust cities as needed. This is the single source of truth.
// =================================================================
const INDIA_CITIES = {
  'Andhra Pradesh':    ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Tirupati', 'Rajahmundry', 'Kadapa', 'Kakinada', 'Anantapur'],
  'Arunachal Pradesh': ['Itanagar', 'Naharlagun', 'Pasighat', 'Tawang', 'Ziro', 'Bomdila'],
  'Assam':             ['Guwahati', 'Dibrugarh', 'Jorhat', 'Silchar', 'Tezpur', 'Nagaon', 'Tinsukia', 'Bongaigaon'],
  'Bihar':             ['Patna', 'Gaya', 'Muzaffarpur', 'Bhagalpur', 'Purnia', 'Darbhanga', 'Bihar Sharif', 'Arrah', 'Begusarai'],
  'Chhattisgarh':      ['Raipur', 'Bilaspur', 'Durg', 'Korba', 'Rajnandgaon', 'Jagdalpur', 'Raigarh', 'Ambikapur'],
  'Goa':               ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa', 'Ponda'],
  'Gujarat':           ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Gandhinagar', 'Junagadh', 'Anand', 'Nadiad'],
  'Haryana':           ['Faridabad', 'Gurgaon', 'Panipat', 'Ambala', 'Yamunanagar', 'Rohtak', 'Hisar', 'Karnal', 'Sonipat', 'Panchkula'],
  'Himachal Pradesh':  ['Shimla', 'Solan', 'Mandi', 'Kangra', 'Dharamsala', 'Kullu', 'Hamirpur', 'Una', 'Bilaspur'],
  'Jharkhand':         ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro', 'Deoghar', 'Hazaribagh', 'Dumka', 'Giridih'],
  'Karnataka':         ['Bengaluru', 'Mysuru', 'Hubballi', 'Mangaluru', 'Belagavi', 'Davanagere', 'Ballari', 'Vijayapura', 'Shivamogga', 'Tumkuru'],
  'Kerala':            ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam', 'Palakkad', 'Alappuzha', 'Malappuram', 'Kannur', 'Kottayam'],
  'Madhya Pradesh':    ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Dewas', 'Satna', 'Ratlam', 'Rewa'],
  'Maharashtra':       ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Aurangabad', 'Solapur', 'Kolhapur', 'Amravati', 'Thane', 'Nanded'],
  'Manipur':           ['Imphal', 'Thoubal', 'Kakching', 'Churachandpur', 'Bishnupur'],
  'Meghalaya':         ['Shillong', 'Tura', 'Jowai', 'Nongstoin', 'Baghmara'],
  'Mizoram':           ['Aizawl', 'Lunglei', 'Saiha', 'Champhai', 'Kolasib'],
  'Nagaland':          ['Kohima', 'Dimapur', 'Mokokchung', 'Tuensang', 'Wokha'],
  'Odisha':            ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur', 'Sambalpur', 'Puri', 'Balasore', 'Bhadrak', 'Baripada'],
  'Punjab':            ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Pathankot', 'Hoshiarpur', 'Mohali', 'Moga'],
  'Rajasthan':         ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer', 'Bikaner', 'Alwar', 'Bhilwara', 'Sri Ganganagar', 'Sikar'],
  'Sikkim':            ['Gangtok', 'Namchi', 'Mangan', 'Gyalshing'],
  'Tamil Nadu':        ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Tiruppur', 'Erode', 'Vellore', 'Thanjavur'],
  'Telangana':         ['Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Khammam', 'Ramagundam', 'Mahbubnagar', 'Nalgonda', 'Adilabad'],
  'Tripura':           ['Agartala', 'Dharmanagar', 'Udaipur', 'Ambassa', 'Belonia'],
  'Uttar Pradesh':     ['Lucknow', 'Kanpur', 'Agra', 'Varanasi', 'Meerut', 'Allahabad', 'Bareilly', 'Aligarh', 'Moradabad', 'Gorakhpur'],
  'Uttarakhand':       ['Dehradun', 'Haridwar', 'Roorkee', 'Haldwani', 'Rudrapur', 'Kashipur', 'Rishikesh', 'Nainital'],
  'West Bengal':       ['Kolkata', 'Howrah', 'Durgapur', 'Asansol', 'Siliguri', 'Malda', 'Bardhaman', 'Kharagpur', 'Haldia'],
  'Delhi':             ['New Delhi', 'Dwarka', 'Rohini', 'Pitampura', 'Janakpuri', 'Lajpat Nagar', 'Saket', 'Noida (NCR)', 'Gurugram (NCR)'],
};

// =================================================================
// STATE -> CITY DROPDOWN LOGIC
// =================================================================

// Track whether initial load has synced dropdowns from backend
let settingsInitialized = false;

// Called when the state dropdown changes
function onStateChange() {
  const stateEl  = document.getElementById('setting-state');
  const cityEl   = document.getElementById('setting-city');
  const state    = stateEl.value;
  const cities   = INDIA_CITIES[state] || [];

  // Clear and repopulate city dropdown
  cityEl.innerHTML = '';
  if (!state || cities.length === 0) {
    cityEl.innerHTML = '<option value="">-- Select State first --</option>';
    return;
  }
  cities.forEach((city, i) => {
    const opt = document.createElement('option');
    opt.value = city;
    opt.textContent = city;
    if (i === 0) opt.selected = true;
    cityEl.appendChild(opt);
  });
}

// Called when city dropdown changes - auto-save location immediately
// This means the user doesn't need to click Save just to change location/weather
async function onCityChange() {
  const city  = document.getElementById('setting-city').value;
  const state = document.getElementById('setting-state').value;
  if (!city || !state) return;

  // Update the weather location label immediately in the UI
  const locLabel = document.getElementById('weather-location-label');
  if (locLabel) locLabel.textContent = city + ', ' + state;

  try {
    await fetch(`${BACKEND_URL}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city, state }),
    });
    // Fetch fresh weather for the new city (small delay to let backend process)
    setTimeout(fetchAndUpdate, 300);
  } catch (err) {
    console.error('Could not update location:', err.message);
  }
}

// =================================================================
// MAIN: Fetch status from backend and update the UI
// =================================================================
async function fetchAndUpdate() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/status`);
    if (!response.ok) throw new Error(`Server error: ${response.status}`);
    const data = await response.json();

    // Update data mode banner (LIVE / LAST_KNOWN / ERROR)
    const dataMode = data.dataMode || 'LIVE';
    updateDataModeBanner(dataMode, data.checkpoint);

    // Update connection dot
    if (dataMode === 'LIVE') {
      setConnectionStatus('live');
    } else if (dataMode === 'LAST_KNOWN') {
      setConnectionStatus('last_known');
    } else {
      setConnectionStatus('error');
    }

    // Update weather strip
    updateWeatherStrip(data.weather);

    // Update each node card
    for (const node of data.nodes) {
      updateNodeCard(node, data.weather);
    }

    // Update farm settings fields (only if user is not currently editing)
    if (data.farmSettings) {
      updateSettingsFields(data.farmSettings);
    }

    // Update threshold display
    const thresholdEl = document.getElementById('threshold-display');
    if (thresholdEl) thresholdEl.textContent = `${data.threshold}%`;

  } catch (err) {
    console.error('Could not reach backend:', err.message);
    setConnectionStatus('offline');
    updateDataModeBanner('OFFLINE', null);
  }
}

// =================================================================
// Data Mode Banner
// =================================================================
function updateDataModeBanner(mode, checkpointTime) {
  const banner = document.getElementById('data-mode-banner');
  const text   = document.getElementById('data-mode-text');
  if (!banner || !text) return;
  banner.classList.remove('visible', 'mode-last-known', 'mode-error', 'mode-offline');
  if (mode === 'LIVE') return;
  banner.classList.add('visible');
  if (mode === 'LAST_KNOWN') {
    banner.classList.add('mode-last-known');
    const ageStr = checkpointTime
      ? ` (as of ${new Date(checkpointTime).toLocaleTimeString()})`
      : '';
    text.textContent = `Warning: Showing last known data${ageStr} - Live connection lost. Auto-reconnecting...`;
  } else if (mode === 'OFFLINE') {
    banner.classList.add('mode-offline');
    text.textContent = 'OFFLINE - Cannot reach backend. Check that the server is running.';
  } else {
    banner.classList.add('mode-error');
    text.textContent = 'ERROR - Backend encountered an error. Last known data may be stale.';
  }
}

// =================================================================
// Connection Status Dot
// =================================================================
function setConnectionStatus(state) {
  const dot  = document.getElementById('connection-dot');
  const text = document.getElementById('connection-text');
  if (!dot || !text) return;
  if (state === 'live') {
    dot.className    = 'connection-dot connected';
    text.textContent = '● Live';
  } else if (state === 'last_known') {
    dot.className    = 'connection-dot warning';
    text.textContent = '⚠ Last Known';
  } else {
    dot.className    = 'connection-dot error';
    text.textContent = state === 'offline' ? '✕ Offline' : '✕ Error';
  }
}

// =================================================================
// Weather Strip Updater
// =================================================================
function updateWeatherStrip(weather) {
  const strip  = document.getElementById('weather-strip');
  const icon   = document.getElementById('weather-icon');
  const msg    = document.getElementById('weather-message');
  const sub    = document.getElementById('weather-sub');
  const tempEl = document.getElementById('weather-temp');
  const descEl = document.getElementById('weather-desc');
  const locLabel = document.getElementById('weather-location-label');

  if (!weather || !weather.available) {
    strip.className = 'weather-strip';
    icon.textContent = 'thermometer';
    msg.textContent = 'Weather data unavailable';
    sub.textContent = 'Add your OpenWeatherMap API key in backend/.env to enable this';
    if (tempEl) tempEl.textContent = '-';
    if (descEl) descEl.textContent = '-';
    return;
  }

  // Update location label (only if the label exists and user isn't currently changing city)
  if (locLabel && weather.city) {
    // Only update from weather API response if label is still showing the default
    if (!locLabel.dataset.userSet) {
      locLabel.textContent = weather.city;
    }
  }

  if (weather.rainExpected) {
    strip.className = 'weather-strip rain';
    icon.textContent = 'rain';
    msg.textContent = 'Rain is expected – Automatic irrigation is paused';
    sub.textContent = `Forecast: ${weather.description || 'Rain'} · Expected rainfall: ${weather.maxRainMm || 0} mm`;
  } else {
    strip.className = 'weather-strip clear';
    icon.textContent = 'sun';
    msg.textContent = 'No rain expected – Automatic irrigation is active';
    sub.textContent = `Forecast: ${weather.description || 'Clear'} · ${weather.city || ''}`;
  }
  if (tempEl) tempEl.textContent = weather.temperature !== null && weather.temperature !== undefined ? `${weather.temperature}°C` : '-';
  if (descEl) descEl.textContent = weather.description ? capitalize(weather.description) : '-';

  // Stale indicator
  if (weather.stale) {
    sub.textContent += ' (last known - live weather unavailable)';
  }
}

// =================================================================
// Node Card Updater
// =================================================================
function updateNodeCard(node, weather) {
  const card = document.getElementById(`node-card-${node.node}`);
  if (!card) return;

  const moisture   = node.moisture;
  const status     = node.status;       // 'OK', 'DRY', 'NO DATA'
  const irrigating = node.irrigationOn;
  const updatedAt  = node.updatedAt;

  // Card state class
  card.className = 'node-card';
  if (irrigating)         card.classList.add('state-irrigating');
  else if (status==='DRY') card.classList.add('state-dry');
  else if (status==='OK')  card.classList.add('state-ok');
  else                     card.classList.add('state-nodata');

  // Moisture value
  const moistureEl = card.querySelector('.moisture-value');
  if (moisture !== null) {
    moistureEl.textContent = Math.round(moisture);
    moistureEl.style.color = irrigating ? 'var(--blue)' : (status === 'DRY' ? 'var(--red)' : 'var(--green)');
  } else {
    moistureEl.textContent = '-';
    moistureEl.style.color = 'var(--text-muted)';
  }

  // Progress bar
  const bar = card.querySelector('.moisture-bar-fill');
  const pct = moisture !== null ? Math.min(100, Math.max(0, moisture)) : 0;
  bar.style.width = `${pct}%`;
  bar.className = 'moisture-bar-fill';
  if (irrigating)          bar.classList.add('irrigating');
  else if (status==='DRY') bar.classList.add('dry');

  // Status badge
  const badge = card.querySelector('.node-status-badge');
  badge.className = 'node-status-badge';
  if (status === 'OK') {
    badge.textContent = 'OK';
    badge.classList.add('badge-ok');
  } else if (status === 'DRY') {
    badge.textContent = 'DRY';
    badge.classList.add('badge-dry');
  } else {
    badge.textContent = 'No Data';
    badge.classList.add('badge-nodata');
  }

  // Irrigation button
  const irrRow   = card.querySelector('.irrigation-row');
  const irrValue = card.querySelector('.irrigation-value');
  if (irrigating) {
    irrRow.classList.add('active');
    irrValue.textContent = 'ON';
    irrValue.className = 'irrigation-value irr-on';
  } else {
    irrRow.classList.remove('active');
    irrValue.textContent = 'OFF';
    irrValue.className = 'irrigation-value irr-off';
  }

  // Last updated
  const lastUpdatedEl = card.querySelector('.last-updated');
  if (updatedAt) {
    const d = new Date(updatedAt);
    lastUpdatedEl.textContent = `Updated: ${d.toLocaleTimeString()}`;
  } else {
    lastUpdatedEl.textContent = 'No data received yet';
  }
}

// =================================================================
// Settings Field Updater (called on data refresh)
// IMPORTANT: Only syncs dropdowns on the FIRST load.
// After that, we never overwrite the user's selections from polling.
// The user controls city/state freely; Save button commits to backend.
// =================================================================
let userIsEditing = false;

function updateSettingsFields(settings) {
  if (userIsEditing) return;

  // Simple dropdowns (non-location): always sync
  ['cropType', 'soilType', 'growthStage'].forEach(field => {
    const el = document.getElementById(`setting-${field}`);
    if (el && settings[field]) el.value = settings[field];
  });

  // Location dropdowns: ONLY sync on the very first load, never after that.
  // This prevents the 10s poll from overwriting the user's city/state selection.
  if (!settingsInitialized) {
    settingsInitialized = true;

    const stateEl = document.getElementById('setting-state');
    if (stateEl && settings.state) {
      stateEl.value = settings.state;
      onStateChange(); // repopulate city list for this state
    }
    const cityEl = document.getElementById('setting-city');
    if (cityEl && settings.city) {
      cityEl.value = settings.city;
    }

    // Sync the weather location label
    const locLabel = document.getElementById('weather-location-label');
    if (locLabel && settings.city && settings.state) {
      locLabel.textContent = settings.city + ', ' + settings.state;
    }
  }
}

// =================================================================
// Save Settings to Backend
// =================================================================
async function saveSettings() {
  const settings = {
    cropType:    document.getElementById('setting-cropType').value,
    soilType:    document.getElementById('setting-soilType').value,
    growthStage: document.getElementById('setting-growthStage').value,
    city:        document.getElementById('setting-city').value,
    state:       document.getElementById('setting-state').value,
  };

  if (!settings.city || !settings.state) {
    alert('Please select both a State and a City before saving.');
    return;
  }

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

    // Update weather location label immediately
    const locLabel = document.getElementById('weather-location-label');
    if (locLabel) locLabel.textContent = settings.city + ', ' + settings.state;

    // Fetch fresh weather for new location right away
    setTimeout(fetchAndUpdate, 300);
  } catch (err) {
    console.error('Could not save settings:', err);
    alert('Could not save settings. Is the backend running?');
  }
}

// =================================================================
// Toggle Settings Panel
// =================================================================
function toggleSettings() {
  const body  = document.getElementById('settings-body');
  const icon  = document.getElementById('settings-toggle-icon');
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  icon.classList.toggle('open', !isOpen);
}

// =================================================================
// Utility
// =================================================================
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// =================================================================
// Individual Valve Toggle
// =================================================================
async function toggleValve(nodeId) {
  const card = document.getElementById(`node-card-${nodeId}`);
  const btn  = card.querySelector('.irrigation-value');
  const isCurrentlyOn = btn.textContent.trim() === 'ON';
  const newState = isCurrentlyOn ? 'OFF' : 'ON';

  try {
    const response = await fetch(`${BACKEND_URL}/api/toggle-valve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: nodeId, state: newState }),
    });
    if (response.ok) {
      fetchAndUpdate();
    }
  } catch (err) {
    console.error('Failed to toggle valve:', err);
    alert('Could not connect to backend to toggle valve.');
  }
}

// =================================================================
// ALL ON / ALL OFF - Global Control
// Calls /api/toggle-all to set override on all 4 nodes at once.
// This goes through the same backend override pathway as individual toggles.
// =================================================================
async function toggleAll(state) {
  // Immediately disable buttons to prevent double-click
  const btnOn  = document.getElementById('btn-all-on');
  const btnOff = document.getElementById('btn-all-off');
  if (btnOn)  btnOn.disabled  = true;
  if (btnOff) btnOff.disabled = true;

  try {
    const response = await fetch(`${BACKEND_URL}/api/toggle-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    if (!response.ok) throw new Error(`Server error: ${response.status}`);
    // Immediately refresh all node cards
    await fetchAndUpdate();
  } catch (err) {
    console.error('Failed to toggle all valves:', err);
    alert('Could not connect to backend to toggle all valves.');
  } finally {
    if (btnOn)  btnOn.disabled  = false;
    if (btnOff) btnOff.disabled = false;
  }
}

// =================================================================
// STARTUP: Run immediately and then every 10 seconds
// =================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Mark as editing when user focuses any settings field
  document.querySelectorAll('.settings-field input, .settings-field select').forEach(el => {
    el.addEventListener('focus', () => { userIsEditing = true; });
    el.addEventListener('blur',  () => { userIsEditing = false; });
  });

  // Wire up state dropdown: when state changes, repopulate cities
  const stateEl = document.getElementById('setting-state');
  if (stateEl) {
    stateEl.addEventListener('change', () => {
      onStateChange();
      // Auto-save location when state changes (first city in new state)
      setTimeout(onCityChange, 50);
    });
  }

  // Wire up city dropdown: auto-save when city is selected
  const cityEl = document.getElementById('setting-city');
  if (cityEl) {
    cityEl.addEventListener('change', onCityChange);
  }

  // Initial fetch - this will call updateSettingsFields which runs
  // the FIRST-LOAD sync of location dropdowns from backend state
  fetchAndUpdate();

  // Refresh every 10 seconds
  setInterval(fetchAndUpdate, REFRESH_INTERVAL_MS);
});
