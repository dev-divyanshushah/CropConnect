// CropConnect — software-only sensor dashboard
// Displays two sensor nodes and ML analysis. No actuator commands are sent.
const BACKEND_URL = "https://cropconnect-backend-p0bo.onrender.com";
const REFRESH_INTERVAL_MS = 10000;

// The backend currently identifies the two retained physical nodes as 3 and 4.
// The website presents them simply as Sensor Node 01 and Sensor Node 02.
const DISPLAY_NODES = [
  { display: 1, backendId: 3 },
  { display: 2, backendId: 4 },
];

const byId = (id) => document.getElementById(id);

function setConnection(state, message) {
  const dot = byId("connection-dot");
  const text = byId("connection-text");
  dot.className = "connection-dot" + (state ? " " + state : "");
  text.textContent = message;
}

function setSystemStatus(title, detail, mode = "") {
  byId("system-status-title").textContent = title;
  byId("system-status-detail").textContent = detail;
  const strip = document.querySelector(".status-strip");
  strip.classList.remove("status-live", "status-warn", "status-error");
  if (mode) strip.classList.add("status-" + mode);
}

function formatTime(value) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function moistureDescription(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "No valid reading received";
  const moisture = Number(value);
  if (moisture < 20) return "Very low moisture reading";
  if (moisture < 40) return "Low moisture reading";
  if (moisture < 70) return "Moderate moisture reading";
  return "High moisture reading";
}

function softwareAnalysis(current, ml) {
  if (!ml || ml.available !== true || !Number.isFinite(Number(ml.predictedMoisturePct))) {
    return {
      prediction: "Not available",
      note: ml && ml.error
        ? "The sensor reading is available, but the ML prediction service did not return a prediction."
        : "A prediction has not been returned yet. Current sensor readings can still be viewed above.",
    };
  }

  const predicted = Number(ml.predictedMoisturePct);
  let note;
  if (!Number.isFinite(Number(current))) {
    note = "A prediction is available, but there is no current sensor reading to compare against.";
  } else {
    const difference = predicted - Number(current);
    if (difference < -3) {
      note = "The predicted moisture is lower than the current reading. The model estimates a downward change.";
    } else if (difference > 3) {
      note = "The predicted moisture is higher than the current reading. The model estimates an upward change.";
    } else {
      note = "The predicted moisture is close to the current reading. The model estimates little change.";
    }
  }
  return { prediction: predicted.toFixed(1) + "%", note };
}

function renderNode(displayId, node) {
  const current = node && node.moisture !== null && node.moisture !== undefined
    ? Number(node.moisture)
    : null;
  const valid = Number.isFinite(current);
  const card = byId("sensor-card-" + displayId);
  const badge = byId("state-badge-" + displayId);

  byId("moisture-" + displayId).textContent = valid ? current.toFixed(1) : "—";
  byId("reading-caption-" + displayId).textContent = valid
    ? moistureDescription(current)
    : "Waiting for sensor data";

  const fill = byId("meter-" + displayId);
  fill.style.width = valid ? Math.max(0, Math.min(100, current)) + "%" : "0%";
  fill.classList.toggle("meter-low", valid && current < 30);
  fill.classList.toggle("meter-high", valid && current >= 70);

  badge.className = "state-badge " + (valid ? "state-reading" : "state-waiting");
  badge.textContent = valid ? "Reading available" : "No data";
  card.classList.toggle("card-no-data", !valid);

  const analysis = softwareAnalysis(current, node && node.ml);
  byId("prediction-" + displayId).textContent = analysis.prediction;
  byId("analysis-" + displayId).textContent = analysis.note;
  byId("updated-" + displayId).textContent = valid ? formatTime(node.updatedAt) : "No data yet";
}

async function refreshDashboard() {
  try {
    const response = await fetch(BACKEND_URL + "/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Backend returned HTTP " + response.status);
    const data = await response.json();
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const byBackendId = new Map(nodes.map((node) => [Number(node.node), node]));

    for (const mapping of DISPLAY_NODES) {
      renderNode(mapping.display, byBackendId.get(mapping.backendId));
    }

    const hasReading = DISPLAY_NODES.some((mapping) => {
      const node = byBackendId.get(mapping.backendId);
      return node && node.moisture !== null && node.moisture !== undefined && Number.isFinite(Number(node.moisture));
    });
    const mode = data.dataMode || "LIVE";
    if (mode === "LIVE") {
      setConnection("connected", "Backend connected");
      setSystemStatus(
        hasReading ? "Sensor data received" : "Connected — waiting for sensor readings",
        hasReading ? "Latest readings and available software analysis are shown below." : "The server is reachable, but no valid readings are available for the two displayed nodes.",
        hasReading ? "live" : "warn"
      );
    } else if (mode === "LAST_KNOWN") {
      setConnection("warning", "Showing last-known data");
      setSystemStatus("Showing last-known data", "The backend is responding with previously saved information. Readings may not be current.", "warn");
    } else {
      setConnection("warning", "Backend connected with limited data");
      setSystemStatus("Data status: " + mode, "Some live information may be unavailable. Check the backend and sensor connection.", "warn");
    }
    byId("last-refresh").textContent = "Last checked: " + formatTime(new Date().toISOString());
  } catch (error) {
    console.error("CropConnect refresh failed:", error);
    setConnection("error", "Backend unavailable");
    setSystemStatus("Cannot load sensor data", "The dashboard could not reach the backend. Check the service and try again.", "error");
    byId("last-refresh").textContent = "Last checked: " + formatTime(new Date().toISOString());
  }
}

refreshDashboard();
setInterval(refreshDashboard, REFRESH_INTERVAL_MS);
