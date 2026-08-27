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
const BACKEND_URL = "https://cropconnect-backend-p0bo.onrender.com";

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
    
    // Update master cards (unified irrigation controls)
    updateMasterCard(1, data.nodes);
    updateMasterCard(2, data.nodes);

    // Update farm settings fields (only if user is not currently editing)
    if (data.farmSettings) {
      updateSettingsFields(data.farmSettings);
    }

    // Update Live Charts
    if (typeof updateChartsLive === 'function') {
      try { updateChartsLive(data.nodes); } catch (e) { console.error('Chart update error:', e); }
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

  // Moisture value — F10: '--' (double dash) when no data
  const moistureEl = card.querySelector('.moisture-value');
  if (moisture !== null) {
    moistureEl.textContent = Math.round(moisture);
    moistureEl.style.color = irrigating ? 'var(--blue)' : (status === 'DRY' ? 'var(--red)' : 'var(--green)');
  } else {
    moistureEl.textContent = '--';
    moistureEl.style.color = 'var(--text-muted)';
  }

  // Progress bar — F3: hide (width=0, no fill class) when no data
  const bar = card.querySelector('.moisture-bar-fill');
  bar.className = 'moisture-bar-fill';
  if (moisture !== null) {
    const pct = Math.min(100, Math.max(0, moisture));
    bar.style.width = `${pct}%`;
    if (irrigating)          bar.classList.add('irrigating');
    else if (status==='DRY') bar.classList.add('dry');
  } else {
    bar.style.width = '0%';
  }

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



  // Last updated + F8: stale sensor detection (5 minute threshold)
  const STALE_MS = 5 * 60 * 1000; // 5 minutes
  const lastUpdatedEl = card.querySelector('.last-updated');
  const mlStatusEl    = card.querySelector('.ml-status');

  let isStale = false;
  if (updatedAt) {
    const age = Date.now() - new Date(updatedAt).getTime();
    isStale = age > STALE_MS;
    if (isStale) {
      // Keep last moisture value visible as historical info — only change badge/state
      card.classList.remove('state-ok', 'state-dry', 'state-irrigating', 'state-nodata');
      card.classList.add('state-stale');
      badge.textContent = '⚠ Sensor Offline';
      badge.className = 'node-status-badge badge-stale';
      const lastSeen = new Date(updatedAt).toLocaleTimeString();
      lastUpdatedEl.textContent = `⚠ Last seen: ${lastSeen} — Sensor offline`;
    } else {
      lastUpdatedEl.textContent = `Updated: ${new Date(updatedAt).toLocaleTimeString()}`;
    }
  } else {
    lastUpdatedEl.textContent = 'No data received yet';
  }

  // F9: ML status indicator — shown only when we have sensor data and ml object exists
  if (mlStatusEl) {
    mlStatusEl.className = 'ml-status';
    mlStatusEl.textContent = '';
    if (node.ml) {
      if (node.ml.available === true) {
        mlStatusEl.textContent = '🤖 ML Prediction: Active';
        mlStatusEl.classList.add('ml-active');
      } else if (node.ml.error && node.ml.error.includes('Insufficient history')) {
        const count = node.ml.completedDays || 0;
        mlStatusEl.textContent = `🤖 ML: Warming up (${count}/7 days)`;
        mlStatusEl.classList.add('ml-warming');
      } else if (node.ml.available === false) {
        mlStatusEl.textContent = '⚠ ML: Unavailable — Real sensor data active';
        mlStatusEl.classList.add('ml-unavail');
      }
    }
  }

}  // end updateNodeCard

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

async function setValveAuto(nodeId) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/toggle-valve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: nodeId, state: 'AUTO' }),
    });
    if (response.ok) {
      fetchAndUpdate();
    }
  } catch (err) {
    console.error('Failed to set valve auto:', err);
    alert('Could not connect to backend to set valve to AUTO.');
  }
}

// =================================================================
// Master Valve Toggle
// =================================================================
async function toggleMaster(masterId) {
  const nodes = masterId === 1 ? [1, 2] : [3, 4];
  const card = document.getElementById(`master-card-${masterId}`);
  if (!card) return;
  const btn = card.querySelector(`#master-valve-btn-${masterId}`);
  const isCurrentlyOn = btn.textContent.trim() === 'ON';
  const newState = isCurrentlyOn ? 'OFF' : 'ON';

  try {
    await Promise.all(nodes.map(nodeId => 
      fetch(`${BACKEND_URL}/api/toggle-valve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node: nodeId, state: newState }),
      })
    ));
    fetchAndUpdate();
  } catch (err) {
    console.error('Failed to toggle master valve:', err);
    alert('Could not connect to backend to toggle master valve.');
  }
}

async function setMasterAuto(masterId) {
  const nodes = masterId === 1 ? [1, 2] : [3, 4];
  try {
    await Promise.all(nodes.map(nodeId => 
      fetch(`${BACKEND_URL}/api/toggle-valve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node: nodeId, state: 'AUTO' }),
      })
    ));
    fetchAndUpdate();
  } catch (err) {
    console.error('Failed to set master auto:', err);
    alert('Could not connect to backend to set master valve to AUTO.');
  }
}

function updateMasterCard(masterId, nodesData) {
  const nodeIds = masterId === 1 ? [1, 2] : [3, 4];
  const masterNodes = nodesData.filter(n => nodeIds.includes(n.node));
  if (masterNodes.length === 0) return;

  const card = document.getElementById(`master-card-${masterId}`);
  if (!card) return;

  const irrRow = card.querySelector('.irrigation-row');
  const irrValue = card.querySelector(`#master-valve-btn-${masterId}`);
  if (!irrRow || !irrValue) return;

  // If any node in this master is irrigating, show as ON
  const isIrrigating = masterNodes.some(n => n.irrigationOn);

  if (isIrrigating) {
    irrRow.classList.add('active');
    irrValue.textContent = 'ON';
    irrValue.className = 'irrigation-value irr-on';
    card.classList.add('state-irrigating');
  } else {
    irrRow.classList.remove('active');
    irrValue.textContent = 'OFF';
    irrValue.className = 'irrigation-value irr-off';
    card.classList.remove('state-irrigating');
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
  const btnAuto = document.getElementById('btn-all-auto');
  if (btnOn)  btnOn.disabled  = true;
  if (btnOff) btnOff.disabled = true;
  if (btnAuto) btnAuto.disabled = true;

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
    alert('Could not send toggle-all command. Backend may be down.');
  } finally {
    // Re-enable buttons after a short delay
    setTimeout(() => {
      const btnOn  = document.getElementById('btn-all-on');
      const btnOff = document.getElementById('btn-all-off');
      const btnAuto = document.getElementById('btn-all-auto');
      if (btnOn)  btnOn.disabled  = false;
      if (btnOff) btnOff.disabled = false;
      if (btnAuto) btnAuto.disabled = false;
    }, 1000);
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
  fetchHistory(); // Fetch initial chart data

  // Refresh every 10 seconds
  setInterval(fetchAndUpdate, REFRESH_INTERVAL_MS);
});

// =================================================================
// Sensor Analytics (Charts)
// =================================================================
let charts = { moisture: null, ml: null, irrigation: null };
let historyData = [];

// Common Chart.js options for dark theme
const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  color: '#eef0f8',
  plugins: {
    legend: { labels: { color: '#eef0f8', font: { family: 'Inter' } } }
  },
  scales: {
    x: { ticks: { color: '#8a8fa8', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.05)' } },
    y: { ticks: { color: '#8a8fa8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
  }
};

async function fetchHistory() {
  const nodeSelect = document.getElementById('analytics-node-select').value;
  const range = document.getElementById('analytics-range-select').value;
  const [master, node] = nodeSelect.split('-');
  
  const emptyState = document.getElementById('analytics-empty-state');
  const chartsContainer = document.getElementById('analytics-charts-container');
  
  emptyState.style.display = 'block';
  emptyState.textContent = 'Loading sensor history...';
  chartsContainer.style.display = 'none';

  try {
    const res = await fetch(`${BACKEND_URL}/api/history?master=${master}&node=${node}&range=${range}`);
    if (!res.ok) throw new Error('Failed to fetch history');
    const data = await res.json();
    historyData = data;
    
    if (data.length === 0) {
      emptyState.style.display = 'block';
      emptyState.textContent = 'No historical data available for this range.';
      chartsContainer.style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      chartsContainer.style.display = 'grid';
      renderCharts(data);
    }
  } catch (err) {
    console.error('History fetch error:', err);
    emptyState.style.display = 'block';
    emptyState.textContent = 'Failed to load sensor history.';
    chartsContainer.style.display = 'none';
  }
}

function renderCharts(data) {
  // Format labels: HH:MM for 24h, MM/DD HH:MM for 7d/30d
  const range = document.getElementById('analytics-range-select').value;
  const labels = data.map(d => {
    const date = new Date(d.timestamp);
    if (range === '24h') return date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    return date.toLocaleDateString([], {month: 'short', day: 'numeric'}) + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  });
  
  // 1. Moisture History
  const ctxMoisture = document.getElementById('chart-moisture');
  if (charts.moisture) charts.moisture.destroy();
  charts.moisture = new Chart(ctxMoisture, {
    type: 'line',
    data: {
      labels: [...labels],
      datasets: [{
        label: 'Soil Moisture (%)',
        data: data.map(d => d.moisture),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.2,
        pointRadius: data.length > 50 ? 0 : 3
      }]
    },
    options: Object.assign({}, chartOptions, {
      plugins: { title: { display: true, text: 'Soil Moisture History', color: '#eef0f8', font: { size: 14 } } }
    })
  });

  // 2. Actual vs ML
  const ctxMl = document.getElementById('chart-ml');
  if (charts.ml) charts.ml.destroy();
  charts.ml = new Chart(ctxMl, {
    type: 'line',
    data: {
      labels: [...labels],
      datasets: [
        {
          label: 'Actual Moisture',
          data: data.map(d => d.moisture),
          borderColor: '#3b82f6',
          tension: 0.2,
          pointRadius: data.length > 50 ? 0 : 3
        },
        {
          label: 'Predicted Moisture (ML)',
          data: data.map(d => d.predictedMoisture),
          borderColor: '#f59e0b',
          borderDash: [5, 5],
          tension: 0.2,
          spanGaps: false,
          pointRadius: data.length > 50 ? 0 : 3
        }
      ]
    },
    options: Object.assign({}, chartOptions, {
      plugins: { title: { display: true, text: 'Actual vs ML Predicted', color: '#eef0f8', font: { size: 14 } } }
    })
  });

  // 3. Irrigation Activity
  const ctxIrrigation = document.getElementById('chart-irrigation');
  if (charts.irrigation) charts.irrigation.destroy();
  charts.irrigation = new Chart(ctxIrrigation, {
    type: 'line',
    data: {
      labels: [...labels],
      datasets: [{
        label: 'Irrigation Valve (1=ON, 0=OFF)',
        data: data.map(d => d.irrigationOn ? 1 : 0),
        borderColor: '#22c55e',
        stepped: true,
        fill: true,
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        pointRadius: 0
      }]
    },
    options: Object.assign({}, chartOptions, {
      plugins: { title: { display: true, text: 'Irrigation Activity', color: '#eef0f8', font: { size: 14 } } },
      scales: {
        x: chartOptions.scales.x,
        y: { min: -0.1, max: 1.1, ticks: { stepSize: 1, color: '#8a8fa8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    })
  });
}

function updateChartsLive(nodesData) {
  if (historyData.length === 0 || !charts.moisture) return;
  const nodeSelect = document.getElementById('analytics-node-select').value;
  const selectedNodeId = parseInt(nodeSelect.split('-')[1]);
  
  const liveNode = nodesData.find(n => n.node === selectedNodeId);
  if (!liveNode || liveNode.moisture === null) return;
  
  const now = new Date();
  const range = document.getElementById('analytics-range-select').value;
  let timeLabel = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  if (range !== '24h') {
    timeLabel = now.toLocaleDateString([], {month: 'short', day: 'numeric'}) + ' ' + timeLabel;
  }
  
  // Append to datasets directly
  const addData = (chart, dataPoints) => {
    chart.data.labels.push(timeLabel);
    chart.data.datasets.forEach((dataset, i) => {
      dataset.data.push(dataPoints[i]);
    });
    // Keep max 500 points in view to prevent memory leak
    if (chart.data.labels.length > 500) {
      chart.data.labels.shift();
      chart.data.datasets.forEach(dataset => dataset.data.shift());
    }
    chart.update('none'); // Update without animation
  };

  addData(charts.moisture, [liveNode.moisture]);
  const predicted = (liveNode.ml && liveNode.ml.available) ? liveNode.ml.predictedMoisturePct : null;
  addData(charts.ml, [liveNode.moisture, predicted]);
  addData(charts.irrigation, [liveNode.irrigationOn ? 1 : 0]);
}

// =================================================================
// HIDDEN DEVELOPER PANEL
// =================================================================
// Secret keyboard shortcut: Ctrl + Shift + D
// Opens a terminal-style floating panel for controlling the
// hidden simulation engine. Not visible or accessible to users.
// No indication of this panel exists anywhere in the normal UI.
// =================================================================

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────
  const LS_SIM_ENABLED   = 'cc_sim_enabled';
  const LS_SIM_TIMESCALE = 'cc_sim_timescale';
  let devPanelOpen   = false;
  let devRefreshTimer = null;

  // ── Restore simulation state from localStorage on page load ───
  // This ensures the simulation stays ON (or explicitly turns OFF) after a page refresh.
  (function restoreSimState() {
    const lsVal = localStorage.getItem(LS_SIM_ENABLED);
    if (lsVal === null) return; // No preference saved yet
    const wasEnabled = lsVal === 'true';
    const savedScale = parseInt(localStorage.getItem(LS_SIM_TIMESCALE)) || 1;
    fetch(`${BACKEND_URL}/api/dev/sim-toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: wasEnabled, timeScale: savedScale }),
    }).catch(() => {}); // silent — backend may not be ready yet
  })();

  // ── Keyboard shortcut ─────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      toggleDevPanel();
    }
  });

  // ── Panel toggle ─────────────────────────────────────────────
  function toggleDevPanel() {
    const existing = document.getElementById('cc-dev-panel');
    if (existing) {
      existing.remove();
      devPanelOpen = false;
      if (devRefreshTimer) { clearInterval(devRefreshTimer); devRefreshTimer = null; }
    } else {
      devPanelOpen = true;
      openDevPanel();
    }
  }

  // ── Build and open the panel ─────────────────────────────────
  async function openDevPanel() {
    const panel = document.createElement('div');
    panel.id = 'cc-dev-panel';
    panel.innerHTML = `
      <h2>
        ⚙ DEV / SIM ENGINE
        <button class="dev-close-btn" id="dev-close-x" title="Close (Ctrl+Shift+D)">✕</button>
      </h2>
      <div id="dev-panel-body">Loading…</div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('#dev-close-x').addEventListener('click', toggleDevPanel);

    await refreshDevPanel();

    // Auto-refresh dev panel every 5 seconds
    devRefreshTimer = setInterval(refreshDevPanel, 5000);
  }

  // ── Fetch sim state and re-render panel body ─────────────────
  async function refreshDevPanel() {
    const panel = document.getElementById('cc-dev-panel');
    if (!panel) return;

    let state;
    try {
      const res = await fetch(`${BACKEND_URL}/api/dev/sim-state`);
      state = await res.json();
    } catch (err) {
      panel.querySelector('#dev-panel-body').innerHTML =
        `<div style="color:#ef4444">Backend unreachable: ${err.message}</div>`;
      return;
    }

    const simOn        = state.enabled;
    const timeScale    = state.timeScale || 1;
    const intervalSec  = state.intervalSec || '300.0';
    const farmInfo     = state.farmSettings || {};
    const nodes        = state.nodes || {};

    // ── Render body ────────────────────────────────────────────
    let html = '';

    // ── Control: Sim on/off ────────────────────────────────────
    html += `
      <div class="dev-section">
        <div class="dev-label">Simulation Engine</div>
        <div class="dev-row">
          <span class="dev-key">Status</span>
          <span class="dev-val ${simOn ? 'live' : 'off'}">${simOn ? '● ACTIVE' : '○ INACTIVE'}</span>
        </div>
        <div class="dev-btn-group">
          <button id="dev-sim-on"  ${simOn ? 'class="active"' : ''}>Enable</button>
          <button id="dev-sim-off" ${!simOn ? 'class="active"' : ''}>Disable</button>
        </div>
      </div>
    `;

    // ── Control: Time scale ────────────────────────────────────
    html += `
      <div class="dev-section">
        <div class="dev-label">Tick Interval</div>
        <div class="dev-row">
          <span class="dev-key">Time Scale</span>
          <span class="dev-val">${timeScale}× (every ${intervalSec}s)</span>
        </div>
        <div class="dev-btn-group">
          <button id="dev-ts-1"   ${timeScale===1   ? 'class="active"' : ''}>1× real</button>
          <button id="dev-ts-10"  ${timeScale===10  ? 'class="active"' : ''}>10× fast</button>
          <button id="dev-ts-60"  ${timeScale===60  ? 'class="active"' : ''}>60× demo</button>
          <button id="dev-ts-300" ${timeScale===300 ? 'class="active"' : ''}>300× ultra</button>
        </div>
      </div>
    `;

    // ── Farm context ───────────────────────────────────────────
    html += `
      <div class="dev-section">
        <div class="dev-label">Farm Context</div>
        <div class="dev-row"><span class="dev-key">Crop</span><span class="dev-val">${farmInfo.cropType||'—'}</span></div>
        <div class="dev-row"><span class="dev-key">Soil</span><span class="dev-val">${farmInfo.soilType||'—'}</span></div>
        <div class="dev-row"><span class="dev-key">Location</span><span class="dev-val">${farmInfo.city||'—'}</span></div>
      </div>
    `;

    // ── Per-node status ────────────────────────────────────────
    html += `<div class="dev-section"><div class="dev-label">Node Status</div><div class="dev-node-grid">`;
    for (const id of [1, 2, 3, 4]) {
      const n = nodes[id] || {};
      const isLive = n.isLive;
      const phase  = n.phase || 'NORMAL';
      const phaseClass = phase === 'SATURATED' ? 'sat' : (phase === 'DRAINING' ? 'drain' : '');
      const dotClass = isLive ? 'live-dot' : 'sim-dot';
      const label    = isLive ? 'LIVE' : (simOn ? 'SIM' : 'STALE');
      const irrMini  = n.lastIrrAt
        ? `Irr: ${new Date(n.lastIrrAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`
        : 'No irr yet';
      html += `
        <div class="dev-node-box">
          <div class="node-id">
            <span class="dev-status-dot ${dotClass}"></span>Node ${id}
          </div>
          <div><span class="dev-val ${isLive ? 'live' : 'sim'}">${label}</span>
            <span class="dev-val"> ${n.moisture !== undefined ? n.moisture.toFixed(1) : '—'}%</span>
          </div>
          <div class="dev-val ${phaseClass}" style="font-size:9px">${phase}</div>
          <div class="dev-irr-mini">${irrMini}</div>
        </div>
      `;
    }
    html += `</div></div>`;

    // ── Recent irrigation events ───────────────────────────────
    let irrEvents = [];
    for (const id of [1, 2, 3, 4]) {
      if (nodes[id] && nodes[id].recentIrrigation) {
        nodes[id].recentIrrigation.slice(0, 2).forEach(ev => {
          irrEvents.push({ ...ev, _nodeId: id });
        });
      }
    }
    irrEvents.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    irrEvents = irrEvents.slice(0, 5);

    if (irrEvents.length > 0) {
      html += `<div class="dev-section"><div class="dev-label">Recent Irrigation</div>`;
      for (const ev of irrEvents) {
        const t = new Date(ev.startedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
        html += `
          <div class="dev-irr-event">
            <strong>Node ${ev._nodeId || ev.node}</strong> @ ${t}
            — ${ev.moistureBefore}% → ${ev.moistureAfter}% (${ev.durationMin}min)<br>
            <span style="color:#475569">${ev.reason || '—'}</span>
          </div>
        `;
      }
      html += `</div>`;
    }

    // ── Reset button ───────────────────────────────────────────
    html += `
      <div class="dev-section">
        <div class="dev-label">Reset</div>
        <div class="dev-btn-group">
          <button id="dev-reset-all" class="danger">Reset All Nodes</button>
        </div>
      </div>
    `;

    // ── Server time ────────────────────────────────────────────
    html += `
      <div style="color:#1e3a5f;font-size:9px;margin-top:8px;text-align:right">
        ${state.serverTime ? new Date(state.serverTime).toLocaleTimeString() : '—'}
        &nbsp;·&nbsp; Ctrl+Shift+D to close
      </div>
    `;

    panel.querySelector('#dev-panel-body').innerHTML = html;

    // ── Wire buttons ───────────────────────────────────────────
    const bind = (id, fn) => { const el = panel.querySelector('#' + id); if (el) el.addEventListener('click', fn); };

    bind('dev-sim-on',  () => setSimEnabled(true,  timeScale));
    bind('dev-sim-off', () => setSimEnabled(false, timeScale));
    bind('dev-ts-1',    () => setSimEnabled(simOn, 1));
    bind('dev-ts-10',   () => setSimEnabled(simOn, 10));
    bind('dev-ts-60',   () => setSimEnabled(simOn, 60));
    bind('dev-ts-300',  () => setSimEnabled(simOn, 300));
    bind('dev-reset-all', resetAllNodes);
  }

  // ── API helpers ───────────────────────────────────────────────
  async function setSimEnabled(enabled, timeScale) {
    try {
      await fetch(`${BACKEND_URL}/api/dev/sim-toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, timeScale }),
      });
      // Persist in localStorage so page refresh preserves state
      localStorage.setItem(LS_SIM_ENABLED,   String(enabled));
      localStorage.setItem(LS_SIM_TIMESCALE, String(timeScale));
      await refreshDevPanel();
      // Trigger a normal dashboard refresh to pick up new moisture values
      fetchAndUpdate();
    } catch (err) {
      alert('Dev toggle failed: ' + err.message);
    }
  }

  async function resetAllNodes() {
    if (!confirm('Reset all simulation nodes to default moisture values?')) return;
    try {
      await fetch(`${BACKEND_URL}/api/dev/sim-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      await refreshDevPanel();
      fetchAndUpdate();
    } catch (err) {
      alert('Reset failed: ' + err.message);
    }
  }

})(); // end hidden developer panel IIFE
