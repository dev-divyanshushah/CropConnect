# CropConnect — Hardware Integration

Complete architecture, data flow, and integration reference for the
ESP32 + ESP-NOW hardware extension to CropConnect.

---

## 1. Physical Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     CropConnect Cloud                         │
│  https://cropconnect-backend-p0bo.onrender.com               │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  backend/server.js  (Node.js)                        │   │
│  │  POST /api/sensor-data   ←  receives moisture        │   │
│  │  GET  /api/status        →  returns irrigationOn     │   │
│  └───────────────────────┬──────────────────────────────┘   │
│                          │ HTTP (internal)                   │
│  ┌───────────────────────▼──────────────────────────────┐   │
│  │  ml/api/main.py  (FastAPI + XGBoost)                 │   │
│  │  POST /predict  →  predicted_soil_moisture           │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼───────────────────────────────────┐
│  Laptop                                                       │
│  hardware-gateway/gateway.js  (Node.js)                      │
│                                                              │
│  • Uploads sensor data → POST /api/sensor-data               │
│  • Polls irrigation commands ← GET /api/status               │
│  • Deduplicates commands (sends only on state change)        │
│  • Matches ACKs by cmdId                                     │
└──────────────────────────┬───────────────────────────────────┘
                           │ USB Serial 115200 baud
┌──────────────────────────▼───────────────────────────────────┐
│  ESP32  (D0:EF:76:47:22:24)                                  │
│  firmware/esp32_gateway/esp32_gateway.ino                    │
│                                                              │
│  • Serial → "COMMAND,3,ON,42" → ESP-NOW PKT_COMMAND         │
│  • ESP-NOW PKT_SENSOR_DATA → Serial "SENSOR,3,32.50"        │
│  • ESP-NOW PKT_ACK         → Serial "ACK,3,ON,42"           │
└──────────────────────────┬───────────────────────────────────┘
                           │ ESP-NOW (2.4 GHz)
┌──────────────────────────▼───────────────────────────────────┐
│  Master 2 / ESP8266  (EC:64:C9:CE:01:3E)                    │
│  firmware/master2/master2.ino                                │
│                                                              │
│  Pure router — no relay, no ML, no internet                  │
│  • SENSOR_DATA from Node 3/4  →  forward to ESP32           │
│  • COMMAND from ESP32          →  route to Node 3 or 4      │
│  • ACK from Node 3/4          →  forward to ESP32           │
└──────────┬───────────────────────────────┬───────────────────┘
           │ ESP-NOW                       │ ESP-NOW
┌──────────▼──────────┐         ┌──────────▼──────────┐
│  Node 3 (ESP8266)  │         │  Node 4 (ESP8266)  │
│  firmware/node3/   │         │  firmware/node4/   │
│                    │         │                    │
│  • Read moisture   │         │  • Read moisture   │
│  • Send to Master  │         │  • Send to Master  │
│  • Recv COMMAND    │         │  • Recv COMMAND    │
│  • Actuate relay   │         │  • Actuate relay   │
│  • Send ACK        │         │  • Send ACK        │
└────────────────────┘         └────────────────────┘
```

---

## 2. Known MAC Addresses

| Device | MAC | Status |
|--------|-----|--------|
| ESP32 | `D0:EF:76:47:22:24` | Confirmed |
| Master 2 | `EC:64:C9:CE:01:3E` | Confirmed |
| Node 3 | TBD | Flash node3.ino to read from Serial Monitor |
| Node 4 | TBD | Flash node4.ino to read from Serial Monitor |

---

## 3. Serial Protocol (Laptop ↔ ESP32)

```
Direction       Format                              Example
──────────────  ──────────────────────────────────  ─────────────────
ESP32→Laptop    SENSOR,<node>,<moisture>\n          SENSOR,3,32.50
ESP32→Laptop    ACK,<node>,<ON|OFF>,<cmdId>\n       ACK,3,ON,42
ESP32→Laptop    LOG,<message>\n                     LOG,Master2 ready
Laptop→ESP32    COMMAND,<node>,<ON|OFF>,<cmdId>\n   COMMAND,3,ON,42
```

- All fields comma-separated, line terminated with `\n`
- `<node>`: 3 or 4
- `<moisture>`: float, 0.00–100.00
- `<state>`: `ON` or `OFF`
- `<cmdId>`: integer 0–255, wraps around

---

## 4. ESP-NOW Packet Structure

```c
typedef struct __attribute__((packed)) {
  uint8_t packetType;  // 0=SENSOR_DATA, 1=COMMAND, 2=ACK
  uint8_t nodeId;      // 3 or 4
  uint8_t commandId;   // 0–255 sequence number
  uint8_t pumpState;   // 0=OFF, 1=ON
  float   moisture;    // 0.0–100.0 %
} espnow_packet_t;     // 8 bytes total
```

| Field | SENSOR_DATA | COMMAND | ACK |
|-------|------------|---------|-----|
| `packetType` | 0 | 1 | 2 |
| `nodeId` | 3 or 4 | 3 or 4 | 3 or 4 |
| `commandId` | 0 | seq | same seq echoed |
| `pumpState` | 0 | 0=OFF / 1=ON | echoed |
| `moisture` | actual % | 0.0 | 0.0 |

---

## 5. Complete Data Flow

### Upward (sensor → cloud)

```
Node 3/4 reads moisture every 30s
   ↓  ESP-NOW PKT_SENSOR_DATA
Master 2 receives → forwards unchanged
   ↓  ESP-NOW PKT_SENSOR_DATA
ESP32 receives → prints "SENSOR,3,32.50\n" to USB Serial
   ↓  USB Serial 115200
Laptop gateway reads line → validates
   ↓  HTTPS POST /api/sensor-data { master:2, node:3, moisture:32.5 }
Cloud backend stores reading → runs ML → computes irrigationOn
```

### Downward (cloud decision → relay)

```
Laptop gateway polls GET /api/status every 5s
   ↓  reads nodes[].irrigationOn for nodes 3 and 4
   
[Deduplication check — only continues if state changed or retry needed]

Laptop sends "COMMAND,3,ON,42\n" via USB Serial
   ↓  USB Serial
ESP32 reads line → builds PKT_COMMAND { nodeId:3, cmdId:42, pumpState:ON }
   ↓  ESP-NOW PKT_COMMAND
Master 2 receives → routes to Node 3 MAC
   ↓  ESP-NOW PKT_COMMAND
Node 3 receives → validates nodeId=3 → actuates relay
   ↓  ESP-NOW PKT_ACK { nodeId:3, cmdId:42, pumpState:ON }
Master 2 receives → forwards to ESP32
   ↓  ESP-NOW PKT_ACK
ESP32 receives → prints "ACK,3,ON,42\n" to USB Serial
   ↓  USB Serial
Laptop gateway: cmdId matches pendingCmdId → confirmedState='ON' → done
```

---

## 6. Cloud JSON

### POST /api/sensor-data
```json
Request:  { "master": 2, "node": 3, "moisture": 32.5 }
Response: { "success": true, "message": "Node 3 data recorded" }
```

### GET /api/status (gateway reads)
```json
{
  "dataMode": "LIVE",
  "nodes": [
    {
      "node": 3, "master": 2,
      "moisture": 32.5,
      "irrigationOn": true,
      "ml": {
        "available": true,
        "predictedMoisturePct": 28.4,
        "model": "XGBoost",
        "historyMode": "EARLY"
      }
    },
    {
      "node": 4, "master": 2,
      "moisture": 55.0,
      "irrigationOn": false,
      "ml": { "available": true, "predictedMoisturePct": 57.1 }
    }
  ]
}
```

---

## 7. Command Deduplication State Machine

```
Per-node gateway state:
  desiredState   — set from cloud on each poll
  confirmedState — set when valid ACK received
  pendingCmdId   — cmdId of outstanding command (null = none)

  Every POLL_INTERVAL_MS:

  If request fails OR dataMode=ERROR:
    → no command issued

  If pendingCmdId != null:
    If elapsed < ACK_TIMEOUT_MS:
      → wait (do nothing)
    Else if retryCount < MAX_RETRIES:
      → retry same cmdId, increment retryCount
    Else:
      → give up, clear pendingCmdId

  If desired == confirmed AND pendingCmdId == null:
    → nothing to do

  If desired != confirmed AND pendingCmdId == null:
    → assign new cmdId
    → send COMMAND,<node>,<state>,<cmdId>
    → set pendingCmdId, reset retryCount
```

---

## 8. Failsafe Behaviour Summary

| Failure | Effect |
|---------|--------|
| Cloud unavailable | No new command issued; pump stays in last confirmed state |
| `dataMode: "ERROR"` | No new command issued |
| Serial disconnected | No command can be sent; gateway retries reconnect every 3s |
| No ACK (timeout) | Gateway retries up to MAX_RETRIES, then gives up |
| Invalid SENSOR packet | Discarded; no upload; no crash |
| Invalid COMMAND on ESP32 | Discarded; LOG message sent to laptop |
| COMMAND for wrong nodeId on Node | Discarded silently |
| ESP-NOW send failure | Logged; no ACK → gateway retries on timeout |

**Default pump state on startup: OFF** (no command is sent until first successful cloud poll confirms a state change is needed).

---

## 9. GPIO — Pending Confirmation

The following GPIO assignments are **not yet set** in the firmware.
All relay actuation code is currently commented out (safe — no accidental actuation).

| Parameter | Node 3 | Node 4 |
|-----------|--------|--------|
| `RELAY_PIN` | **TBD** | **TBD** |
| `MOISTURE_PIN` | **TBD** | **TBD** |
| Relay active level | **TBD** | **TBD** |
| Sensor interface | **TBD** | **TBD** |

Once provided, uncomment the corresponding sections in `firmware/node3/node3.ino` and `firmware/node4/node4.ino`.

---

## 10. Files Created by This Integration

```
hardware-gateway/
  gateway.js          Main laptop gateway
  package.json        Node.js project
  .env.example        Configuration template
  README.md           Setup and troubleshooting guide

firmware/
  shared/
    espnow_packet.h   Shared 8-byte ESP-NOW packet struct
  esp32_gateway/
    esp32_gateway.ino ESP32 serial↔ESP-NOW bridge
    espnow_packet.h   (copy)
  master2/
    master2.ino       Master 2 pure ESP-NOW router
    espnow_packet.h   (copy)
  node3/
    node3.ino         Node 3 sensor + relay firmware (GPIO TBD)
    espnow_packet.h   (copy)
  node4/
    node4.ino         Node 4 sensor + relay firmware (GPIO TBD)
    espnow_packet.h   (copy)

HARDWARE_INTEGRATION.md  (this file)
```

**Files NOT modified:**
- `backend/server.js` — unchanged
- `backend/.env` — unchanged (set MOCK_MODE=false manually)
- `frontend/` — unchanged
- `ml/` — unchanged
- `data/` — unchanged
