// =============================================================================
// CropConnect – Isolated ML Simulation & History Test Tool
// =============================================================================
//
// PURPOSE:
//   Injects synthetic historical moisture data into the Node.js backend so the
//   full ML pipeline (history → lag features → FastAPI → XGBoost → /api/status)
//   can be tested WITHOUT physical hardware or waiting 7 real days.
//
// ISOLATION GUARANTEE:
//   • Simulated data is injected via /api/dev/inject-history (MOCK_MODE only).
//   • By default the script AUTO-CLEARS all injected data on exit via
//     /api/dev/clear-history, so no simulation data leaks into production.
//   • Use --keep only when you need to inspect ML output manually afterward.
//     Always run with --clear before switching to real hardware.
//
// REQUIREMENTS:
//   • backend/server.js must be running   →  cd backend && npm run dev
//   • ml FastAPI service must be running  →  python -m uvicorn ml.api.main:app --port 8000
//   • MOCK_MODE=true must be set in backend/.env
//
// USAGE:
//   node simulate_history.js               Run full test, then AUTO-CLEAR
//   node simulate_history.js --keep        Run full test, preserve history
//   node simulate_history.js --clear       Clear all simulation data only
//   node simulate_history.js --fallback    Full test + interactive fallback check
//
// WARNING:
//   /api/dev/inject-history and /api/dev/clear-history are MOCK_MODE-only.
//   They return HTTP 403 in production. Never call them in a live deployment.
// =============================================================================

'use strict';

const http     = require('http');
const readline = require('readline');

// ── Configuration ─────────────────────────────────────────────────────────────

const BASE_HOST = 'localhost';
const BASE_PORT = 3000;

const args          = process.argv.slice(2);
const FLAG_KEEP     = args.includes('--keep');
const FLAG_CLEAR    = args.includes('--clear');
const FLAG_FALLBACK = args.includes('--fallback');

const NODES = [
  { master: 1, node: 1 },
  { master: 1, node: 2 },
  { master: 2, node: 3 },
  { master: 2, node: 4 },
];

// 7 days of synthetic moisture FRACTIONS (0–1), oldest → newest.
// These are representative agronomic patterns; they are NOT real sensor readings.
// They are ONLY used via /api/dev/inject-history and are auto-cleared on exit.
const SIM_HISTORY = {
  1: [0.41, 0.39, 0.37, 0.35, 0.33, 0.31, 0.30],  // Sector 1 – gradually drying
  2: [0.62, 0.60, 0.61, 0.59, 0.58, 0.60, 0.62],  // Sector 2 – stable moist
  3: [0.28, 0.30, 0.29, 0.27, 0.26, 0.25, 0.24],  // Sector 3 – consistently dry
  4: [0.70, 0.68, 0.72, 0.71, 0.69, 0.68, 0.70],  // Sector 4 – well irrigated
};

// Live moisture percentages to send after injecting history
const LIVE_MOISTURE_PCT = { 1: 32, 2: 61, 3: 26, 4: 70 };

// ── HTTP helpers (no external deps – uses built-in 'http') ───────────────────

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: BASE_HOST,
      port:     BASE_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Request timed out after 8s')); });
    if (data) req.write(data);
    req.end();
  });
}

const post = (path, body) => request('POST', path, body);
const get  = (path)       => request('GET',  path, null);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve =>
    rl.question(question, answer => { rl.close(); resolve(answer); })
  );
}

// ── Build synthetic completedDays array ──────────────────────────────────────

function buildCompletedDays(avgArray) {
  const today = new Date();
  // avgArray[0] = 7 days ago, avgArray[6] = yesterday
  return avgArray.map((avg, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (avgArray.length - i));  // shift backward
    return { date: d.toISOString().slice(0, 10), avg };
  });
}

// ── Individual test steps ─────────────────────────────────────────────────────

async function stepClearHistory(targets) {
  const label = targets ? 'Node ' + targets : 'ALL nodes';
  console.log('\n  [CLEAR] Resetting history for ' + label + '...');
  const body = targets ? { nodeId: targets } : {};
  const { status, body: r } = await post('/api/dev/clear-history', body);
  if (status === 200 && r.success) {
    console.log('  ✓ Cleared nodes: [' + r.cleared.join(', ') + ']');
    console.log('  → ML disabled until 7 real days accumulate.');
  } else if (status === 403) {
    console.error('  ✗ Endpoint blocked (403). Is MOCK_MODE=true in backend/.env?');
  } else {
    console.error('  ✗ Clear failed (HTTP ' + status + '):', JSON.stringify(r));
  }
}

async function stepInjectHistory() {
  console.log('\nSTEP 1 ▸ Inject 7 simulated days of history per node');
  console.log('  [Isolated test data – will be auto-cleared on script exit]');
  let allOk = true;
  for (const { node } of NODES) {
    const completedDays = buildCompletedDays(SIM_HISTORY[node]);
    const { status, body: r } = await post('/api/dev/inject-history', { nodeId: node, completedDays });
    if (status === 200 && r.success) {
      const f = r.features;
      const featureStr = f
        ? '  lag1=' + f.lag1.toFixed(4)
          + ' lag3=' + f.lag3.toFixed(4)
          + ' lag7=' + f.lag7.toFixed(4)
          + ' roll7=' + f.roll7_mean.toFixed(4)
        : '  (features not returned)';
      console.log('  Node ' + node + ': ✓ ' + r.completedDays + '/7 days |' + featureStr
        + ' | ML ready: ' + r.mlFeaturesReady);
    } else if (status === 403) {
      console.error('  Node ' + node + ': ✗ Blocked (403). Set MOCK_MODE=true in .env');
      allOk = false;
    } else {
      console.error('  Node ' + node + ': ✗ HTTP ' + status + ' –', JSON.stringify(r));
      allOk = false;
    }
  }
  return allOk;
}

async function stepSendLiveReadings() {
  console.log('\nSTEP 2 ▸ Send live sensor readings via POST /api/sensor-data');
  for (const { master, node } of NODES) {
    const { status, body: r } = await post('/api/sensor-data', {
      master,
      node,
      moisture: LIVE_MOISTURE_PCT[node],
    });
    console.log('  Node ' + node
      + ' (Master ' + master + '): moisture=' + LIVE_MOISTURE_PCT[node] + '% → '
      + (status === 200 && r.success ? '✓ accepted' : '✗ HTTP ' + status + ' ' + JSON.stringify(r)));
  }
  process.stdout.write('  Waiting 1 s for background processing...');
  await sleep(1000);
  console.log(' done.');
}

async function stepCheckStatus(label) {
  console.log('\n' + label);
  const { status, body } = await get('/api/status');
  if (status !== 200) {
    console.error('  ✗ /api/status returned HTTP ' + status);
    return { allMLReady: false, nodes: [] };
  }

  console.log('  dataMode=' + body.dataMode
    + '  mockMode=' + body.mockMode
    + '  threshold=' + body.threshold + '%');
  console.log('  ' + '─'.repeat(60));

  let allMLReady = true;
  for (const n of (body.nodes || [])) {
    const ml = n.ml || {};
    let mlStr;
    if (ml.available) {
      mlStr = '✓ ' + ml.predictedMoisturePct + '% [' + (ml.model || 'XGBoost') + ']'
        + '  lag1=' + (ml.lag1 || '?').toString().slice(0, 5);
    } else {
      mlStr = '✗ ' + (ml.error || 'unavailable');
      allMLReady = false;
    }
    console.log('  Node ' + n.node
      + ' | moisture=' + (n.moisture !== null ? n.moisture + '%' : 'null')
      + ' | irrig=' + (n.irrigationOn ? 'ON ' : 'OFF')
      + ' | ML: ' + mlStr);
  }

  console.log('  ' + '─'.repeat(60));
  return { allMLReady, nodes: body.nodes || [] };
}

async function stepFallbackTest() {
  console.log('\nSTEP 4 ▸ Interactive FastAPI Failure / Rule-Based Fallback Test');
  console.log('  ' + '─'.repeat(60));
  console.log('  Stop FastAPI now (Ctrl+C in its terminal window).');
  console.log('  The Node.js backend must keep running.');
  await prompt('  Press Enter here once FastAPI is stopped → ');

  await sleep(600);
  const { allMLReady, nodes } = await stepCheckStatus('  /api/status with FastAPI DOWN:');

  const irrigWorks = nodes.every(n => typeof n.irrigationOn === 'boolean');
  console.log('');
  if (!allMLReady && irrigWorks) {
    console.log('  ✅ PASS: FastAPI down → ML unavailable, rule-based irrigation still running.');
  } else if (allMLReady) {
    console.log('  ⚠  ML still reporting predictions. Was FastAPI fully stopped?');
    console.log('     (node-fetch caches connections – try waiting a few more seconds)');
  } else {
    console.log('  ✗  Could not verify rule-based fallback. Check server logs.');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('');
  console.log('═'.repeat(65));
  console.log('  CropConnect – Isolated ML Simulation & History Test Tool');
  console.log('═'.repeat(65));
  console.log('  Flags: --keep (no auto-clear)  --clear (reset only)');
  console.log('         --fallback (interactive FastAPI-down test)');
  console.log('═'.repeat(65));

  // ── CLEAR-ONLY MODE ────────────────────────────────────────────────────────
  if (FLAG_CLEAR) {
    await stepClearHistory(null);
    console.log('');
    return;
  }

  // ── INJECT HISTORY ─────────────────────────────────────────────────────────
  const injected = await stepInjectHistory();
  if (!injected) {
    console.error('\n✗ Injection failed. Ensure the backend is running with MOCK_MODE=true.');
    process.exit(1);
  }

  // ── SEND LIVE READINGS ─────────────────────────────────────────────────────
  await stepSendLiveReadings();

  // ── CHECK ML PREDICTIONS ──────────────────────────────────────────────────
  console.log('\nSTEP 3 ▸ ML Prediction Test (FastAPI must be running on :8000)');
  const { allMLReady } = await stepCheckStatus('  /api/status response:');

  console.log('');
  if (allMLReady) {
    console.log('  ✅ PASS: All nodes returned real XGBoost predictions via FastAPI.');
  } else {
    console.log('  ⚠  Some/all nodes did not return ML predictions.');
    console.log('     Ensure FastAPI is running:');
    console.log('     cd ../ml && python -m uvicorn api.main:app --host 0.0.0.0 --port 8000');
  }

  // ── OPTIONAL INTERACTIVE FALLBACK TEST ────────────────────────────────────
  if (FLAG_FALLBACK) {
    await stepFallbackTest();
  } else {
    console.log('\n  ── Manual Fallback Test (run with --fallback for interactive mode) ──');
    console.log('  1. Stop FastAPI (Ctrl+C in its terminal)');
    console.log('  2. Run: node simulate_history.js --clear  [to clear sim data first]');
    console.log('         Then send a reading: send any POST /api/sensor-data');
    console.log('  3. Check: curl -s http://localhost:3000/api/status');
    console.log('     → ml.available should be false on all nodes');
    console.log('     → irrigationOn must still reflect moisture < 65% rule');
  }

  // ── AUTO-CLEAR (default) or KEEP ──────────────────────────────────────────
  console.log('\n' + '─'.repeat(65));
  if (!FLAG_KEEP) {
    await stepClearHistory(null);
    console.log('  Simulated data has been removed.');
    console.log('  Server is now in a clean state for real hardware.');
    console.log('  [Use --keep if you need to inspect ML output manually]');
  } else {
    console.log('  [--keep flag set: simulated history preserved in memory + snapshot]');
    console.log('  ⚠  Run this before connecting real hardware:');
    console.log('     node simulate_history.js --clear');
  }

  console.log('');
  console.log('═'.repeat(65));
  console.log('  Simulation complete.');
  console.log('═'.repeat(65));
  console.log('');
}

run().catch(err => {
  console.error('\n✗ Simulation error: ' + err.message);
  console.error('  Is the Node.js backend running? → cd backend && npm run dev');
  process.exit(1);
});
