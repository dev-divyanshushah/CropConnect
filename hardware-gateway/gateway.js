// ==============================================================
// CropConnect Hardware Gateway  v1.0
// ==============================================================
//
// ROLE:
//   Laptop USB-Serial bridge between ESP32 hardware and the
//   CropConnect cloud backend.
//
// DATA FLOW (upward):
//   ESP32 → SENSOR,<node>,<moisture>\n
//   Gateway → POST /api/sensor-data  { master:2, node, moisture }
//
// DATA FLOW (downward):
//   Gateway polls GET /api/status every POLL_INTERVAL_MS
//   Reads irrigationOn per node → deduplicates → sends only when changed
//   Gateway → COMMAND,<node>,<ON|OFF>,<cmdId>\n → ESP32
//   ESP32 → ACK,<node>,<ON|OFF>,<cmdId>\n → Gateway confirms state
//
// SAFETY:
//   - Cloud unavailable  → no new command issued
//   - Serial disconnected → no new command issued
//   - No ACK after MAX_RETRIES → gives up, retries on next state change
//   - Invalid packets silently discarded, never crash
//
// USAGE:
//   node gateway.js            Start in production mode
//   node gateway.js --test     Start in test mode (no cloud)
//
// TEST MODE interactive commands (type in console):
//   SENSOR,3,32.5    Simulate incoming sensor data
//   COMMAND,3,ON     Manually send command to ESP32 via serial
//   ACK,3,ON,42      Simulate incoming ACK from ESP32
//   q                Quit
// ==============================================================

'use strict';

require('dotenv').config();
const { SerialPort }     = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const fetch              = require('node-fetch');

// ── Configuration ─────────────────────────────────────────────
const CLOUD_URL        = process.env.CLOUD_URL         || 'https://cropconnect-backend-p0bo.onrender.com';
const BAUD_RATE        = parseInt(process.env.BAUD_RATE)        || 115200;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS) || 5000;
const ACK_TIMEOUT_MS   = parseInt(process.env.ACK_TIMEOUT_MS)   || 10000;
const MAX_RETRIES      = parseInt(process.env.MAX_RETRIES)      || 3;
const SERIAL_PORT_CFG  = process.env.SERIAL_PORT                || null;  // empty = auto-detect

const TEST_MODE = process.argv.includes('--test');

// ── Master 2 node IDs (the hardware nodes this gateway handles) ─
const MASTER2_NODE_IDS = [3, 4];

// ── Per-node command deduplication state ─────────────────────
// The gateway maintains independent state for each hardware node.
// A command is only sent when:
//   1. desiredState !== confirmedState AND pendingCmdId === null
//   2. pendingCmdId !== null AND timeout has expired (retry)
const nodeState = {};
for (const id of MASTER2_NODE_IDS) {
  nodeState[id] = {
    desiredState:   null,  // 'ON' | 'OFF' | null  (set by cloud poll)
    confirmedState: null,  // 'ON' | 'OFF' | null  (set on valid ACK)
    pendingCmdId:   null,  // uint8 | null
    pendingCmdAt:   null,  // Date.now() when command was sent
    retryCount:     0,
  };
}

// Global command ID — wraps 0→255
let lastCmdId = 0;
function nextCmdId() {
  lastCmdId = (lastCmdId + 1) % 256;
  return lastCmdId;
}

// ── Serial port state ─────────────────────────────────────────
let port       = null;
let parser     = null;
let serialReady = false;

// ── Logging helpers ───────────────────────────────────────────
function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  console.log('[' + ts + '] [' + tag + '] ' + msg);
}
function warn(tag, msg)  { console.warn( '[WARN]  [' + tag + '] ' + msg); }
function error(tag, msg) { console.error('[ERROR] [' + tag + '] ' + msg); }

// ── Banner ────────────────────────────────────────────────────
console.log('');
console.log('========================================');
console.log('  CROPCONNECT HARDWARE GATEWAY  v1.0');
console.log('========================================');
console.log('  Mode      : ' + (TEST_MODE ? 'TEST (cloud disabled)' : 'PRODUCTION'));
console.log('  Cloud     : ' + CLOUD_URL);
console.log('  Baud      : ' + BAUD_RATE);
console.log('  Poll      : every ' + (POLL_INTERVAL_MS / 1000).toFixed(1) + 's');
console.log('  ACK wait  : ' + (ACK_TIMEOUT_MS / 1000).toFixed(0) + 's');
console.log('  Max retry : ' + MAX_RETRIES);
console.log('========================================');
console.log('');

// ==============================================================
// SECTION 1 – SERIAL PORT
// ==============================================================

// Known USB-Serial adapter vendor IDs used with ESP32 boards
const ESP32_VENDOR_IDS   = ['10c4', '1a86', '0403', '067b', '239a'];
const ESP32_MFGR_PATTERN = /silicon labs|cp210|ch340|ch341|ftdi|prolific|adafruit/i;

async function detectESP32Port() {
  if (SERIAL_PORT_CFG) {
    log('SERIAL', 'Using configured port: ' + SERIAL_PORT_CFG);
    return SERIAL_PORT_CFG;
  }
  try {
    const ports = await SerialPort.list();
    if (ports.length === 0) {
      warn('SERIAL', 'No serial ports found on this system.');
      return null;
    }

    // Try VID match first (most reliable)
    for (const p of ports) {
      if (p.vendorId && ESP32_VENDOR_IDS.includes(p.vendorId.toLowerCase())) {
        log('SERIAL', 'Auto-detected: ' + p.path + ' (VID:' + p.vendorId + ' / ' + (p.manufacturer || 'unknown') + ')');
        return p.path;
      }
    }
    // Try manufacturer name pattern
    for (const p of ports) {
      if (p.manufacturer && ESP32_MFGR_PATTERN.test(p.manufacturer)) {
        log('SERIAL', 'Auto-detected: ' + p.path + ' (' + p.manufacturer + ')');
        return p.path;
      }
    }

    warn('SERIAL', 'Could not auto-detect ESP32. Available ports:');
    for (const p of ports) {
      warn('SERIAL', '  ' + p.path.padEnd(10) +
        ' | VID:' + (p.vendorId || '????') +
        ' | ' + (p.manufacturer || 'unknown manufacturer'));
    }
    warn('SERIAL', 'Set SERIAL_PORT=<port> in hardware-gateway/.env and restart.');
    return null;
  } catch (err) {
    error('SERIAL', 'Could not list ports: ' + err.message);
    return null;
  }
}

async function openSerial() {
  const portPath = await detectESP32Port();
  if (!portPath) {
    log('SERIAL', 'Retrying port detection in 5 seconds...');
    setTimeout(openSerial, 5000);
    return;
  }

  try {
    port   = new SerialPort({ path: portPath, baudRate: BAUD_RATE, autoOpen: false });
    parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

    port.open((err) => {
      if (err) {
        error('SERIAL', 'Failed to open ' + portPath + ': ' + err.message);
        port   = null;
        parser = null;
        serialReady = false;
        setTimeout(openSerial, 5000);
        return;
      }
      serialReady = true;
      log('SERIAL', 'ESP32 connected on ' + portPath + ' at ' + BAUD_RATE + ' baud');
    });

    parser.on('data', handleSerialLine);

    port.on('close', () => {
      serialReady = false;
      warn('SERIAL', 'ESP32 disconnected — no commands will be sent until reconnected');
      port   = null;
      parser = null;
      setTimeout(openSerial, 3000);
    });

    port.on('error', (err) => {
      error('SERIAL', 'Port error: ' + err.message);
      serialReady = false;
    });

  } catch (err) {
    error('SERIAL', 'openSerial exception: ' + err.message);
    setTimeout(openSerial, 5000);
  }
}

// ==============================================================
// SECTION 2 – INCOMING SERIAL LINE HANDLER
// ==============================================================

function handleSerialLine(raw) {
  const line = String(raw).replace(/\r/g, '').trim();
  if (!line) return;

  const parts    = line.split(',');
  const msgType  = parts[0];

  if      (msgType === 'SENSOR') { handleSensorMessage(parts, line); }
  else if (msgType === 'ACK')    { handleAckMessage(parts, line);    }
  else if (msgType === 'LOG')    { log('ESP32', parts.slice(1).join(',')); }
  else {
    warn('SERIAL', 'Unknown message type "' + msgType + '", discarding: ' + line);
  }
}

// ── SENSOR,<node>,<moisture> ─────────────────────────────────
async function handleSensorMessage(parts, line) {
  // Validate field count
  if (parts.length !== 3) {
    warn('SENSOR', 'Malformed SENSOR packet (need 3 fields): ' + line);
    return;
  }

  const node     = parseInt(parts[1], 10);
  const moisture = parseFloat(parts[2]);

  // Validate values
  if (!MASTER2_NODE_IDS.includes(node)) {
    warn('SENSOR', 'Invalid node ID ' + parts[1] + ' (expected 3 or 4)');
    return;
  }
  if (isNaN(moisture) || moisture < 0 || moisture > 100) {
    warn('SENSOR', 'Invalid moisture value "' + parts[2] + '" for Node ' + node);
    return;
  }

  console.log('');
  console.log('─────────────────────────────────────────');
  log('SENSOR', 'Node ' + node + ' | Moisture: ' + moisture.toFixed(1) + '%');

  if (TEST_MODE) {
    log('TEST',   'Cloud upload skipped (test mode)');
    console.log('─────────────────────────────────────────');
    return;
  }

  await uploadSensorData(node, moisture, 1);
}

// ── ACK,<node>,<ON|OFF>,<cmdId> ─────────────────────────────
function handleAckMessage(parts, line) {
  if (parts.length !== 4) {
    warn('ACK', 'Malformed ACK (need 4 fields): ' + line);
    return;
  }

  const node   = parseInt(parts[1], 10);
  const state  = parts[2].toUpperCase().trim();
  const cmdId  = parseInt(parts[3], 10);

  // Validate
  if (!MASTER2_NODE_IDS.includes(node)) {
    warn('ACK', 'Invalid node ID in ACK: ' + parts[1]);
    return;
  }
  if (state !== 'ON' && state !== 'OFF') {
    warn('ACK', 'Invalid state in ACK: "' + parts[2] + '"');
    return;
  }
  if (isNaN(cmdId) || cmdId < 0 || cmdId > 255) {
    warn('ACK', 'Invalid cmdId in ACK: "' + parts[3] + '"');
    return;
  }

  const ns = nodeState[node];

  // No pending command
  if (ns.pendingCmdId === null) {
    warn('ACK', 'Received ACK for Node ' + node + ' but no command pending. Stale ACK — ignoring.');
    return;
  }

  // Wrong cmdId (stale ACK from previous command)
  if (cmdId !== ns.pendingCmdId) {
    warn('ACK', 'Stale ACK for Node ' + node +
      ' (expected cmdId=' + ns.pendingCmdId + ', got ' + cmdId + ') — ignoring');
    return;
  }

  // ✅ Valid ACK — confirm state
  ns.confirmedState = state;
  ns.pendingCmdId   = null;
  ns.pendingCmdAt   = null;
  ns.retryCount     = 0;

  console.log('');
  log('ACK', '✅ Confirmed: Node ' + node + ' pump is now ' + state + ' (cmdId=' + cmdId + ')');
  console.log('─────────────────────────────────────────');
}

// ==============================================================
// SECTION 3 – CLOUD UPLOAD (SENSOR DATA)
// ==============================================================

const MAX_UPLOAD_RETRIES = 3;

async function uploadSensorData(node, moisture, attempt) {
  const body = JSON.stringify({ master: 2, node, moisture });

  log('CLOUD', 'Uploading: POST /api/sensor-data  { master:2, node:' + node + ', moisture:' + moisture + ' }  (attempt ' + attempt + ')');
  try {
    const res  = await fetch(CLOUD_URL + '/api/sensor-data', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      timeout: 8000,
    });
    const json = await res.json();

    if (res.ok && json.success) {
      log('CLOUD', '✅ Upload OK: ' + json.message);
    } else {
      warn('CLOUD', 'Backend rejected upload (HTTP ' + res.status + '): ' + JSON.stringify(json));
    }
  } catch (err) {
    warn('CLOUD', 'Upload failed (attempt ' + attempt + '/' + MAX_UPLOAD_RETRIES + '): ' + err.message);
    if (attempt < MAX_UPLOAD_RETRIES) {
      const delay = attempt * 2000;
      log('CLOUD', 'Retrying in ' + (delay / 1000).toFixed(0) + 's...');
      setTimeout(() => uploadSensorData(node, moisture, attempt + 1), delay);
    } else {
      error('CLOUD', 'Max retries reached. Sensor reading for Node ' + node + ' lost.');
    }
  }
}

// ==============================================================
// SECTION 4 – SEND COMMAND TO ESP32
// ==============================================================

function sendCommandToESP32(node, state, cmdId) {
  if (!serialReady || !port) {
    warn('COMMAND', 'Serial not ready — cannot send COMMAND to Node ' + node);
    return false;
  }

  const msg = 'COMMAND,' + node + ',' + state + ',' + cmdId + '\n';
  port.write(msg, (err) => {
    if (err) {
      error('COMMAND', 'Serial write error: ' + err.message);
    }
  });

  log('COMMAND', '→ ESP32: COMMAND,' + node + ',' + state + ',' + cmdId);
  return true;
}

// ==============================================================
// SECTION 5 – CLOUD POLL + COMMAND DEDUPLICATION STATE MACHINE
// ==============================================================

async function pollCloud() {
  if (TEST_MODE) return; // test mode: no cloud polling

  try {
    const res = await fetch(CLOUD_URL + '/api/status', { timeout: 8000 });

    if (!res.ok) {
      warn('POLL', '/api/status returned HTTP ' + res.status + ' — no new commands issued');
      return;
    }

    const data = await res.json();

    // Safety gate: if backend reports an error state, don't issue commands
    if (data.dataMode === 'ERROR') {
      warn('POLL', 'Backend dataMode=ERROR — no new commands issued');
      return;
    }

    if (!Array.isArray(data.nodes)) {
      warn('POLL', 'Unexpected /api/status shape (nodes not array) — no commands');
      return;
    }

    const now = Date.now();

    for (const nodeData of data.nodes) {
      // Only handle Master 2 nodes (3 and 4)
      if (!MASTER2_NODE_IDS.includes(nodeData.node)) continue;

      const node    = nodeData.node;
      const desired = nodeData.irrigationOn ? 'ON' : 'OFF';
      const ns      = nodeState[node];

      // Update desired state from cloud (cloud is source of truth)
      ns.desiredState = desired;

      // ── Case 1: outstanding command — check ACK timeout / retry ──
      if (ns.pendingCmdId !== null) {
        const elapsed = now - ns.pendingCmdAt;
        if (elapsed >= ACK_TIMEOUT_MS) {
          if (ns.retryCount >= MAX_RETRIES) {
            warn('COMMAND', 'Node ' + node + ': No ACK after ' + MAX_RETRIES +
              ' retries for cmdId=' + ns.pendingCmdId + '. Clearing — will reissue if state still differs.');
            ns.pendingCmdId = null;
            ns.pendingCmdAt = null;
            ns.retryCount   = 0;
            // Fall through to Case 3 below in same poll cycle
          } else {
            // Retry with the same cmdId (idempotent — ESP32 will re-ACK)
            ns.retryCount++;
            ns.pendingCmdAt = now;
            warn('COMMAND', 'Node ' + node + ': Retry ' + ns.retryCount + '/' + MAX_RETRIES +
              ' cmdId=' + ns.pendingCmdId + ' state=' + desired);
            sendCommandToESP32(node, desired, ns.pendingCmdId);
            continue; // don't start new command
          }
        } else {
          // Still within ACK window — do nothing, wait
          continue;
        }
      }

      // ── Case 2: already confirmed in correct state ──────────────
      if (desired === ns.confirmedState) {
        // Nothing to do — state is confirmed, no command sent
        continue;
      }

      // ── Case 3: state change needed — issue a new command ────────
      const cmdId = nextCmdId();
      ns.pendingCmdId = cmdId;
      ns.pendingCmdAt = now;
      ns.retryCount   = 0;

      console.log('');
      console.log('─────────────────────────────────────────');
      log('COMMAND', 'State change for Node ' + node + ':');
      log('COMMAND', '  Confirmed: ' + (ns.confirmedState || 'UNKNOWN') + ' → Desired: ' + desired);
      log('COMMAND', '  ML result visible in /api/status → ml.predictedMoisturePct');

      const sent = sendCommandToESP32(node, desired, cmdId);
      if (!sent) {
        // Serial not available — clear pending so we retry next poll
        ns.pendingCmdId = null;
        ns.pendingCmdAt = null;
        warn('COMMAND', 'Serial not ready — command not sent, will retry on next poll');
      }
      console.log('─────────────────────────────────────────');
    }

  } catch (err) {
    warn('POLL', 'Cloud poll error: ' + err.message + ' — no new commands issued');
  }
}

// ==============================================================
// SECTION 6 – TEST MODE (interactive stdin)
// ==============================================================

function startTestMode() {
  console.log('');
  console.log('========================================');
  console.log('  TEST MODE — Interactive Console');
  console.log('========================================');
  console.log('  Commands you can type:');
  console.log('  SENSOR,3,32.5      Simulate sensor from ESP32');
  console.log('  SENSOR,4,55.0      Simulate sensor from ESP32');
  console.log('  COMMAND,3,ON       Manually send command to ESP32');
  console.log('  COMMAND,4,OFF      Manually send command to ESP32');
  console.log('  ACK,3,ON,42        Simulate incoming ACK from ESP32');
  console.log('  q                  Quit');
  console.log('========================================');
  console.log('');

  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  process.stdin.on('data', (raw) => {
    const line = raw.toString().trim();
    if (!line) return;

    if (line === 'q' || line === 'quit' || line === 'exit') {
      console.log('\nExiting test mode.');
      process.exit(0);
    }

    const parts = line.split(',');

    if (parts[0] === 'COMMAND' && parts.length === 3) {
      // User manually sends a command — assign new cmdId
      const node  = parseInt(parts[1], 10);
      const state = parts[2].toUpperCase().trim();
      if (!MASTER2_NODE_IDS.includes(node)) {
        warn('TEST', 'Invalid node: ' + parts[1] + '. Use 3 or 4.');
        return;
      }
      if (state !== 'ON' && state !== 'OFF') {
        warn('TEST', 'Invalid state: ' + parts[2] + '. Use ON or OFF.');
        return;
      }
      const cmdId = nextCmdId();
      log('TEST', 'Sending manual command: COMMAND,' + node + ',' + state + ',' + cmdId);
      sendCommandToESP32(node, state, cmdId);
      // Track in state machine for ACK matching
      nodeState[node].pendingCmdId = cmdId;
      nodeState[node].pendingCmdAt = Date.now();
      nodeState[node].retryCount   = 0;
    } else {
      // Simulate a line arriving from ESP32 (pass through normal handler)
      handleSerialLine(line);
    }
  });
}

// ==============================================================
// SECTION 7 – MAIN ENTRY POINT
// ==============================================================

async function main() {
  // Step 1: Open serial connection to ESP32
  await openSerial();

  if (TEST_MODE) {
    startTestMode();
  } else {
    // Step 2: Start cloud polling for irrigation commands
    // Initial poll after 3 seconds to let serial settle
    setTimeout(pollCloud, 3000);
    setInterval(pollCloud, POLL_INTERVAL_MS);

    log('GATEWAY', 'Production mode started. Cloud polling every ' + (POLL_INTERVAL_MS / 1000).toFixed(1) + 's.');
  }
}

main().catch((err) => {
  error('FATAL', err.message);
  process.exit(1);
});
