# CropConnect Hardware Gateway

Laptop USB-Serial bridge between the ESP32 and the CropConnect cloud backend.

---

## Overview

```
Node 3 / Node 4
      │ ESP-NOW
      ▼
   Master 2
      │ ESP-NOW
      ▼
    ESP32
      │ USB Serial (115200 baud)
      ▼
  This Gateway  ←─── you are here
      │ HTTPS
      ▼
CropConnect Cloud
      │
      ▼
  ML + Irrigation Decision
```

The gateway is the **only** component that communicates with the cloud. The ESP32 and Master 2 are pure ESP-NOW/serial bridges.

---

## 1. Prerequisites

- Node.js 16 or higher
- ESP32 connected to laptop via USB
- `backend/server.js` running locally **or** using the Render cloud URL

Check Node.js version:
```bash
node --version
```

---

## 2. Installation

```bash
cd hardware-gateway
npm install
```

This installs:
- `serialport` — USB serial communication
- `@serialport/parser-readline` — line-by-line serial parsing
- `node-fetch` — HTTP requests to cloud backend
- `dotenv` — configuration from `.env` file

---

## 3. Configuration

Copy the example config:
```bash
# Windows
copy .env.example .env

# Linux / Mac
cp .env.example .env
```

Edit `hardware-gateway/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `CLOUD_URL` | Render URL | Backend URL — change to `http://localhost:3000` for local backend |
| `SERIAL_PORT` | *(empty)* | Leave empty for auto-detection, or set e.g. `COM10` |
| `BAUD_RATE` | `115200` | Must match `SERIAL_BAUD` in `esp32_gateway.ino` |
| `POLL_INTERVAL_MS` | `5000` | Cloud poll interval in milliseconds |
| `ACK_TIMEOUT_MS` | `10000` | Milliseconds to wait for ACK before retrying |
| `MAX_RETRIES` | `3` | Max retries before giving up on a command |

---

## 4. Finding the ESP32 COM Port

### Windows
1. Open **Device Manager** → **Ports (COM & LPT)**
2. Look for: `Silicon Labs CP210x`, `CH340`, `FTDI`, or similar
3. Note the COM port number (e.g. `COM10`)
4. Set `SERIAL_PORT=COM10` in `.env`

### Linux
```bash
ls /dev/ttyUSB* /dev/ttyACM*
```
Common: `/dev/ttyUSB0`

### Mac
```bash
ls /dev/cu.usbserial-* /dev/cu.SLAB*
```

The gateway also auto-detects by USB vendor ID — leave `SERIAL_PORT` empty and it will find the ESP32 automatically. If auto-detection fails, the console will list all available ports.

---

## 5. Running the Gateway

### Production mode (real hardware + cloud)

```bash
cd hardware-gateway
node gateway.js
```

Expected console output:
```
========================================
  CROPCONNECT HARDWARE GATEWAY  v1.0
========================================
  Mode      : PRODUCTION
  Cloud     : https://cropconnect-backend-p0bo.onrender.com
  Baud      : 115200
  Poll      : every 5.0s
  ACK wait  : 10s
  Max retry : 3
========================================

[12:00:00.000] [SERIAL] Auto-detected: COM10 (VID:10c4 / Silicon Labs)
[12:00:01.000] [SERIAL] ESP32 connected on COM10 at 115200 baud

─────────────────────────────────────────
[12:00:05.000] [SENSOR] Node 3 | Moisture: 32.5%
[12:00:05.010] [CLOUD ] Uploading: POST /api/sensor-data ...
[12:00:05.800] [CLOUD ] ✅ Upload OK: Node 3 data recorded

─────────────────────────────────────────
[12:00:10.000] [COMMAND] State change for Node 3:
[12:00:10.000] [COMMAND]   Confirmed: UNKNOWN → Desired: ON
[12:00:10.000] [COMMAND] → ESP32: COMMAND,3,ON,1
─────────────────────────────────────────

[12:00:12.000] [ACK   ] ✅ Confirmed: Node 3 pump is now ON (cmdId=1)
```

### Test mode (no cloud required)

```bash
node gateway.js --test
```

In test mode:
- Serial connection to ESP32 is still attempted
- Cloud upload and cloud polling are **disabled**
- You can type commands directly in the console

Interactive test commands:
```
SENSOR,3,32.5      → processes as if received from ESP32 (no cloud upload)
SENSOR,4,55.0      → same for Node 4
COMMAND,3,ON       → sends COMMAND,3,ON,<cmdId> to ESP32 via serial
COMMAND,4,OFF      → sends command to Node 4
ACK,3,ON,1         → simulates ACK received from ESP32 (tests state machine)
q                  → quit
```

---

## 6. Serial Protocol Reference

All messages are newline-terminated ASCII at 115200 baud.

| Direction | Format | Example | Meaning |
|-----------|--------|---------|---------|
| ESP32 → Laptop | `SENSOR,<node>,<moisture>` | `SENSOR,3,32.50` | Soil moisture reading |
| ESP32 → Laptop | `ACK,<node>,<ON\|OFF>,<cmdId>` | `ACK,3,ON,42` | Command acknowledged |
| ESP32 → Laptop | `LOG,<message>` | `LOG,Master2 connected` | Informational log |
| Laptop → ESP32 | `COMMAND,<node>,<ON\|OFF>,<cmdId>` | `COMMAND,3,ON,42` | Irrigation command |

**cmdId**: uint8 (0–255, wraps). Used to match each COMMAND with its ACK. A command is only considered confirmed when the ACK carries the same cmdId as the COMMAND.

---

## 7. Cloud API Reference

### Sensor upload
```
POST /api/sensor-data
{ "master": 2, "node": 3, "moisture": 32.5 }
```

Response:
```json
{ "success": true, "message": "Node 3 data recorded" }
```

### Get irrigation commands
```
GET /api/status
```

The gateway reads `nodes[].irrigationOn` for nodes 3 and 4:
```json
{
  "dataMode": "LIVE",
  "nodes": [
    { "node": 3, "master": 2, "irrigationOn": true,  "ml": { "predictedMoisturePct": 28.4, ... } },
    { "node": 4, "master": 2, "irrigationOn": false, ... }
  ]
}
```

If `dataMode` is `"ERROR"` or the request fails, **no command is issued**.

---

## 8. Command Deduplication

The gateway maintains per-node state:

```
desiredState   — what the backend currently says (ON/OFF)
confirmedState — what the hardware last ACKed (ON/OFF)
pendingCmdId   — ID of command waiting for ACK
```

A command is sent **only when**:
1. `desiredState ≠ confirmedState` AND no command is pending → new command
2. A command is pending AND ACK has not arrived within `ACK_TIMEOUT_MS` → retry

After `MAX_RETRIES` failed retries, the pending command is abandoned and a fresh command will be issued on the next poll if the state still differs.

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| "No serial ports found" | ESP32 not plugged in or driver missing | Install CP2102/CH340 driver |
| "Could not auto-detect ESP32" | Generic USB hub hiding VID | Set `SERIAL_PORT=COMx` in `.env` |
| "Upload rejected" | Backend validation failed | Check moisture value is 0–100, master=2, node=3 or 4 |
| "Cloud poll error: ECONNREFUSED" | Backend not running locally | Check `CLOUD_URL` in `.env` |
| Commands sent but no ACK | ESP32/Master 2 not forwarding | Open Arduino Serial Monitor at 115200 on ESP32 to check |
| Same command sent every poll | ACK not arriving | Check Master 2 → Node → ACK path in firmware serial logs |
| "Stale ACK" warnings | cmdId mismatch | Normal if gateway retried — stale ACKs are safely ignored |

---

## 10. Safety Behaviour

- Cloud unavailable → **no** command issued
- Serial disconnected → **no** command issued
- Invalid packet → discarded, never crashes
- No ACK after retries → gives up, retries on next state change
- Default pump state: **OFF** (hardware never auto-activates)
