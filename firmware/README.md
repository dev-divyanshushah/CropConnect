# CropConnect Firmware Setup

## Current hardware

- 1 × ESP8266 NodeMCU as **Master 1**
- 2 × ESP8266 NodeMCU as **Sensor Node 1** and **Sensor Node 2**
- Analog soil-moisture sensor connected to A0 on each sensor node

## Upload these sketches

1. `master1/master1.ino` → Master ESP8266
2. `node1/node1.ino` → Sensor Node 1
3. `node2/node2.ino` → Sensor Node 2

Use Arduino IDE with **ESP8266 by ESP8266 Community** installed and select **NodeMCU 1.0 (ESP-12E Module)**. Open Serial Monitor at 115200 baud after uploading.

## Configure Master 1

Open `master1/master1.ino` and replace:

```cpp
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
```

with the internet-connected Wi-Fi or 2.4 GHz phone-hotspot credentials. Never commit real credentials to GitHub.

The master starts a separate local access point:

- SSID: `CropConnect-Master`
- Password: `CropConnect-NodeLink-26`
- Local sensor endpoint: `http://192.168.4.1/sensor`

The sensor-node sketches use the same local AP credentials. They do not need your internet Wi-Fi password or a manually assigned IP address.

## How data moves

1. Each sensor node reads A0 immediately after Wi-Fi connection, then every 30 seconds.
2. It POSTs a form containing `node=1|2` and `moisture=0..100` to the master.
3. The master validates and queues the latest reading for each node.
4. The master POSTs JSON to `https://cropconnect-backend-p0bo.onrender.com/api/sensor-data`.
5. The backend stores/processes the reading and exposes software analysis through `GET /api/status`.
6. The website displays backend nodes 1 and 2.

## Calibration and electrical safety

The default conversion assumes ADC 0 is wet and ADC 1023 is dry. This is a starting scale, not a calibrated measurement. Test your sensor in dry and wet soil and adjust the conversion in both node sketches if necessary. Verify the A0 voltage limit for your exact board before wiring; do not exceed it.

## TLS note

The master uses `BearSSL::WiFiClientSecure::setInsecure()` to simplify HTTPS connectivity on a student prototype. This encrypts transport but does not validate the server certificate, so it is not ideal for a security-sensitive deployment. For production, configure certificate validation.

## Software-only guarantee

These current sketches contain no actuator commands and do not operate pumps, motors, valves, relays, or other physical devices. ML/software decisions are informational only. The legacy ESP32/ESP-NOW firmware and serial gateway have been retired.

## Troubleshooting

- **Node does not connect:** Confirm Master 1 is powered and its `CropConnect-Master` AP starts. Check SSID/password and proximity.
- **No cloud uploads:** Check Master 1's internet Wi-Fi credentials, hotspot internet access, and Serial Monitor HTTP status codes.
- **Dashboard has simulated data:** Set `MOCK_MODE=false` in the deployed backend environment, then redeploy/restart the backend.
- **COM port missing:** Try a data-capable USB cable and another port, then check Windows Device Manager and the correct USB-to-serial driver.
