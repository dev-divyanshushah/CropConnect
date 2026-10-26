# CropConnect — Soil Monitoring & ML Insights

CropConnect monitors **two soil-moisture sensor nodes through one ESP8266 master**. The website displays current readings and software-generated ML analysis only. The hardware firmware does not control pumps, motors, valves, relays, or other actuators.

## Architecture

```text
Sensor Node 1 (ESP8266) ─┐
                          ├─ Local Wi-Fi AP on Master 1 (ESP8266)
Sensor Node 2 (ESP8266) ─┘                  |
                                             | HTTPS POST /api/sensor-data
                                             v
                                CropConnect Node.js backend
                                             |
                                      ML/software analysis
                                             |
                                             v
                                    Vercel dashboard
```

The master creates a local Wi-Fi network called `CropConnect-Master` for the two sensor nodes and separately joins the internet-connected Wi-Fi/hotspot to upload readings to the cloud. This avoids relying on changing local IP addresses for the nodes.

## Canonical firmware

Use these sketches in Arduino IDE. Do **not** flash the legacy `master2`, `node3`, `node4`, or `esp32_gateway` sketches.

| Device | Sketch |
|---|---|
| Master ESP8266 | [`firmware/master1/master1.ino`](firmware/master1/master1.ino) |
| Sensor Node 1 ESP8266 | [`firmware/node1/node1.ino`](firmware/node1/node1.ino) |
| Sensor Node 2 ESP8266 | [`firmware/node2/node2.ino`](firmware/node2/node2.ino) |
| Wiring, setup and troubleshooting | [`firmware/README.md`](firmware/README.md) |

### Quick setup

1. In `firmware/master1/master1.ino`, replace `YOUR_WIFI_NAME` and `YOUR_WIFI_PASSWORD` with the internet Wi-Fi or 2.4 GHz phone-hotspot credentials.
2. Upload the Master 1 sketch to the master ESP8266.
3. Upload `firmware/node1/node1.ino` to Sensor Node 1 and `firmware/node2/node2.ino` to Sensor Node 2. The nodes join the master's `CropConnect-Master` access point; they do not need the internet Wi-Fi password.
4. Open each Serial Monitor at **115200 baud**. The master should report its local AP address `192.168.4.1` and its internet Wi-Fi status. Nodes should report readings and successful HTTP responses.
5. Make sure the backend accepts real readings. On the deployed backend, set `MOCK_MODE=false` in its environment when you want production data rather than simulated data.
6. Open the [CropConnect dashboard](https://crop-connect-five.vercel.app/). It reads backend nodes 1 and 2.

## Sensor reading notes

- Both node sketches read the analog sensor on `A0` every 30 seconds.
- The default conversion assumes low ADC values are wetter and high values are drier. Calibrate this mapping against your sensor and soil before using the percentages for any scientific conclusions.
- Check the allowed A0 input voltage for your exact NodeMCU/ESP8266 board before wiring a sensor. Never apply a voltage above the board's limit.
- The master queues the latest reading for each node and retries cloud uploads when internet access returns.

## API contract

Master 1 sends JSON to `POST /api/sensor-data`:

```json
{ "master": 1, "node": 1, "moisture": 32.5 }
```

For Sensor Node 2, `node` is `2`. The backend validates the node/master pairing and the 0–100 moisture range. The website reads `GET /api/status`.

## Software-only safety boundary

The canonical firmware contains **no actuator commands**. ML predictions and any backend irrigation-related fields are informational software outputs only. The old ESP32 serial gateway is retired and disabled so it cannot send legacy commands.

## Backend development

```bash
cd backend
npm install
node server.js
```

Configure environment variables in `backend/.env` as appropriate for local development. Never commit credentials or API keys.
