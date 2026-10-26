# CropConnect — Current Handoff

## Current physical scope

The active build uses **one Master ESP8266 and two Sensor ESP8266 boards**. The frontend displays sensor readings and ML/software analysis only. No hardware actuation is implemented.

## Canonical data path

1. Sensor Node 1 and Sensor Node 2 read analog soil moisture from A0.
2. Each node connects to the local access point created by Master 1 (`CropConnect-Master`, local IP `192.168.4.1`).
3. Each node POSTs `node` and `moisture` to `http://192.168.4.1/sensor`.
4. Master 1 joins the internet Wi-Fi/hotspot separately and POSTs `{ master: 1, node: 1|2, moisture: number }` to the Render backend's `/api/sensor-data`.
5. The backend validates data and runs the existing software/ML pipeline.
6. The Vercel dashboard polls `/api/status` and renders nodes 1 and 2.

## Canonical files

- Master firmware: `firmware/master1/master1.ino`
- Node 1 firmware: `firmware/node1/node1.ino`
- Node 2 firmware: `firmware/node2/node2.ino`
- Hardware setup: `firmware/README.md` and `HARDWARE_INTEGRATION.md`
- Frontend: `frontend/index.html`, `frontend/style.css`, `frontend/app.js`
- Backend ingestion route: `backend/server.js`, `POST /api/sensor-data`
- Cloud API: `https://cropconnect-backend-p0bo.onrender.com`
- Dashboard: `https://crop-connect-five.vercel.app/`

## Important setup

- Set `WIFI_SSID` and `WIFI_PASSWORD` in Master 1's sketch before uploading.
- The sensor nodes do not use those internet Wi-Fi credentials; they connect to the master's AP using the credentials embedded in all three sketches.
- The current code assumes analog moisture readings where lower ADC values mean wetter soil. Calibrate this for the actual sensors before relying on percentage values.
- Set Render's `MOCK_MODE=false` for a production run with real sensor data.
- Local IPs printed by the earlier temporary Wi-Fi test sketches are not used by the new design.
- The old `master2`, `node3`, `node4`, and `esp32_gateway` sketches are retired and intentionally fail to compile. The old hardware gateway is disabled.

## Safety boundary

No commands are sent from the backend to firmware. No pump, motor, valve, relay, or actuator is switched. Backend decision fields are informational software outputs only.

## Suggested bring-up order

1. Flash Master 1 and verify AP startup and internet connection in Serial Monitor (115200 baud).
2. Flash Node 1 and verify it joins the master's AP and sends readings.
3. Flash Node 2 and verify it joins the master's AP and sends readings.
4. Verify Master 1 reports HTTP 2xx from the cloud API.
5. Open the dashboard and confirm the values and timestamps update.
