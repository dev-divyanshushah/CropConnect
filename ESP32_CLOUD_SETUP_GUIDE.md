# ESP32 Head - Cloud Integration Setup Guide

## 🎯 Architecture Overview

```
ESP8266 Nodes (1,2,3,4) 
    ↓ (ESP-NOW)
ESP32 Head
    ↓ (WiFi HTTPS)
Render Backend (cropconnect-backend-p0bo.onrender.com)
    ↓
XGBoost Model (on friend's Render)
    ↓
MongoDB Atlas (512MB)
    ↓ (Decision/Command)
Render Backend → ESP32 Head → ESP8266 Nodes
    ↓
Frontend (Vercel) - Shows data & decisions
```

---

## 🔧 STEP 1: Arduino Setup

### 1.1 Install Board Package
- Go to **Tools → Board → Boards Manager**
- Search for **"esp32"**
- Install **"esp32 by Espressif Systems"** (official)
- Wait for completion

### 1.2 Select Board
- **Tools → Board → esp32 → ESP32 Dev Module** (or ESP32-WROOM-DA)
- **Tools → Port → COM5** (or whatever your port is)

### 1.3 Install ArduinoJson Library
- Go to **Tools → Manage Libraries**
- Search for **"ArduinoJson"**
- Install **"ArduinoJson by Benoit Blanchon"** (v6.x or higher)
- This is needed for flexible JSON parsing

---

## 📝 STEP 2: Update WiFi Credentials

In the sketch, find these lines at the top:

```cpp
const char* ssid = "YOUR_SSID";           // Replace with your WiFi name
const char* password = "YOUR_PASSWORD";   // Replace with your WiFi password
```

**Replace with your actual WiFi details:**
- SSID: Your WiFi network name
- Password: Your WiFi password

**Example:**
```cpp
const char* ssid = "MyRouter_5G";
const char* password = "MyPassword123!";
```

---

## 🔌 STEP 3: Verify Node 2 MAC Address

The sketch has this line:
```cpp
uint8_t node2MAC[] = {0xEC, 0x64, 0xC9, 0xCD, 0xED, 0xCC};
```

**This appears incomplete (5 bytes instead of 6).** 

**To fix:**
1. Flash Node 2 with this test code:
```cpp
void setup() {
  Serial.begin(115200);
  Serial.println(WiFi.macAddress());
}
void loop() {}
```
2. Copy the MAC it prints
3. Replace the Node 2 MAC in the ESP32 sketch

---

## 🌐 STEP 4: Backend API Configuration

### 4.1 Check Your Render Backend

**You need to know:**

1. **What JSON format does your backend expect?**
   - Current sketch sends:
   ```json
   {
     "nodeName": "Node 1",
     "nodeId": 1,
     "sensorValue": 512,
     "temperature": 28.5,
     "humidity": 65.2,
     "packetCount": 42,
     "timestamp": 123456
   }
   ```
   - If different, update the `jsonDoc[]` section in `sendToCloud()` function

2. **What's the correct endpoint path?**
   - Current: `/api/predict`
   - Check if this is correct or adjust the line:
   ```cpp
   const char* predictEndpoint = "/api/predict";
   ```

3. **What format does the backend return?**
   - Current sketch expects:
   ```json
   {
     "prediction": 1,
     "decision": "activate_pump",
     "confidence": 0.95
   }
   ```
   - If different, update the `parseCloudResponse()` function

### 4.2 How to Check Your Backend

**Option A: Check Render Logs**
1. Go to https://render.com
2. Select your backend service
3. Click **"Logs"** tab
4. Look for recent POST requests and their responses

**Option B: Use Postman or cURL**
```bash
curl -X POST https://cropconnect-backend-p0bo.onrender.com/api/predict \
  -H "Content-Type: application/json" \
  -d '{
    "nodeName": "Node 1",
    "sensorValue": 512,
    "temperature": 28.5,
    "humidity": 65.2
  }'
```

This will show you exactly what the backend returns.

---

## 💾 STEP 5: MongoDB Storage Optimization (512MB Limit)

**Your current approach sends data immediately per node.** To optimize storage:

### Option A: Batch Data (Recommended)
Instead of sending each node immediately, batch all 4 nodes every 30 seconds:

**Replace in loop():**
```cpp
if (now - lastCloudSendMs >= 30000) {  // Every 30 seconds
  sendBatchToCloud();
  lastCloudSendMs = now;
}
```

**Then create `sendBatchToCloud()` that sends all nodes in one request:**
```json
{
  "timestamp": 123456,
  "nodes": [
    {"nodeName": "Node 1", "sensorValue": 512, "temperature": 28.5},
    {"nodeName": "Node 2", "sensorValue": 600, "temperature": 29.1},
    {"nodeName": "Node 3", "sensorValue": 450, "temperature": 27.8},
    {"nodeName": "Node 4", "sensorValue": 700, "temperature": 30.2}
  ]
}
```

**Storage saved: ~70% less storage (1 document vs 4)**

### Option B: Backend Data Retention
Set MongoDB to delete old records automatically:

**In MongoDB Atlas:**
1. Go to your collection
2. Click **"Indexes"**
3. Add TTL index on `timestamp` field with 7-day expiry
4. Old data auto-deletes after 7 days

### Option C: Only Store Predictions
Don't store raw sensor data, only:
```json
{
  "nodeName": "Node 1",
  "prediction": 1,
  "decision": "activate_pump",
  "timestamp": 123456
}
```

**Storage saved: ~80% less (prediction only vs raw + prediction)**

---

## ⚙️ STEP 6: Test Before Flashing

1. **Update WiFi credentials** ✓
2. **Verify all MACs** (especially Node 2) ✓
3. **Know your backend JSON format** ✓
4. **Check if Node 2 MAC is 6 bytes** ✓

Then:
1. Plug ESP32 into USB
2. Click **Upload** (or Ctrl+U)
3. Open **Serial Monitor** (Ctrl+Shift+M) at **115200 baud**
4. You should see:
```
===== ESP32 HEAD (Cloud Integration) =====
Head MAC: D0:EF:76:47:22:24
[WiFi] Connecting to YOUR_SSID
[WiFi] Connected! IP: 192.168.x.x
[ESP-NOW] Initialized
[PEER ADDED] Node 1 (EC:64:C9:CE:05:71)
[PEER ADDED] Node 2 (...)
...
[STATUS] Ready - waiting for sensor data...
```

---

## 📊 STEP 7: What Happens When Node Sends Data

**Data Flow:**
1. Node 1 sends: `{sensorValue: 512, temp: 28.5, humidity: 65.2}`
2. ESP32 receives via ESP-NOW
3. ESP32 prints: `[RECEIVED] From Node 1 | Sensor: 512 | Temp: 28.5°C | Humidity: 65.2%`
4. ESP32 immediately POSTs to backend with WiFi:
   ```
   [CLOUD] POST to https://cropconnect-backend-p0bo.onrender.com/api/predict
   [CLOUD] Payload: {"nodeName":"Node 1","nodeId":1,...}
   ```
5. Backend runs XGBoost model
6. Backend returns decision:
   ```
   [CLOUD] Response Code: 200 | Body: {"prediction":1,"decision":"activate_pump"}
   ```
7. ESP32 sends command back to Node 1 via ESP-NOW:
   ```
   [CMD SEND] To Node 1 | Decision: activate_pump
   ```
8. Every 5 seconds, ESP32 prints status:
   ```
   Node 1 | ONLINE (3s ago) | Packets: 5 | Pred: 1 | 28.5°C
   ```

---

## 🔍 Troubleshooting

### "WiFi not connected"
- Check SSID spelling (case-sensitive)
- Check password
- Is ESP32 within range?

### "POST failed, HTTP Error -1"
- Backend might be asleep (Render free tier)
- Check if endpoint URL is correct
- Verify backend is running on Render

### "ESP-NOW not sending to nodes"
- Node MAC addresses must match exactly
- All devices must be on **WiFi Channel 1**
- Check Node receiver code is listening

### "JSON parse error"
- Backend response format doesn't match
- Check what Render backend actually returns
- Adjust `parseCloudResponse()` to match

---

## 📋 Final Checklist Before Flashing

- [ ] WiFi SSID entered
- [ ] WiFi password entered
- [ ] Node 2 MAC verified (6 bytes, not 5)
- [ ] Backend endpoint URL confirmed
- [ ] Backend JSON request format known
- [ ] Backend JSON response format known
- [ ] ArduinoJson library installed
- [ ] Board set to "ESP32 Dev Module"
- [ ] Port selected (COM5)
- [ ] Baud rate for Serial Monitor set to 115200

---

## 📧 What to Tell Your Backend Team

"The ESP32 will POST sensor data like this. What should we send and what will you return?"

**Example POST request:**
```
POST /api/predict
Content-Type: application/json

{
  "nodeName": "Node 1",
  "nodeId": 1,
  "sensorValue": 512,
  "temperature": 28.5,
  "humidity": 65.2,
  "packetCount": 42,
  "timestamp": 123456
}
```

**Expected response for MongoDB storage optimization:**
```
{
  "prediction": 1,
  "decision": "activate_pump",
  "confidence": 0.95
}
```

---

## 🚀 Next Steps After First Flash

1. **Monitor Serial output** - Check for incoming node data
2. **Check Render logs** - See if backend is receiving POST requests
3. **Verify predictions** - Are decisions coming back correctly?
4. **Test ESP-NOW reverse** - Does Node 1 receive the command back?
5. **Monitor MongoDB** - Disk usage, document count
6. **Optimize storage** - Implement batching if needed

Good luck! 🌾
