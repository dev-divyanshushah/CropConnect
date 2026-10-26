# CropConnect Hardware Integration — One Master, Two Sensor Nodes

This is the current hardware setup for CropConnect. Use **three ESP8266 boards only**: one master and two soil-moisture sensor nodes. The former ESP32/ESP-NOW/actuator path is retired.

## 1. Architecture

```text
Sensor Node 1 (ESP8266) --HTTP over master's local Wi-Fi--┐
                                                         v
                                                Master 1 (ESP8266)
                                                /               \
                               local AP: 192.168.4.1             internet Wi-Fi
                                                                |
                                                                v
                                              POST /api/sensor-data (HTTPS)
                                                                |
                                                                v
                                                  CropConnect backend + ML
                                                                |
                                                                v
                                                     Website: nodes 1 and 2
```

- Master 1 creates the local access point `CropConnect-Master` with password `CropConnect-NodeLink-26`.
- Both sensor nodes join that access point and submit their moisture readings to `http://192.168.4.1/sensor`.
- Master 1 separately joins the internet-connected Wi-Fi network or phone hotspot and uploads validated readings to the cloud.
- Nodes do not need to know the master's internet-side IP address. Their local destination remains `192.168.4.1`.
- This design uses Wi-Fi HTTP, not ESP-NOW. It does not require an ESP32 board or a laptop serial gateway while running.

## 2. Firmware files

| Physical board | Arduino sketch |
|---|---|
| Master ESP8266 | `firmware/master1/master1.ino` |
| Sensor Node 1 ESP8266 | `firmware/node1/node1.ino` |
| Sensor Node 2 ESP8266 | `firmware/node2/node2.ino` |

The old sketches in `firmware/master2`, `firmware/node3`, `firmware/node4`, and `firmware/esp32_gateway` are retired and deliberately fail to compile with a clear warning. Do not use them for the current setup.

## 3. Arduino IDE setup

1. Install **ESP8266 by ESP8266 Community** from Boards Manager.
2. Select **NodeMCU 1.0 (ESP-12E Module)** for each ESP8266 board.
3. Select the COM port that appears for the connected board.
4. Set Serial Monitor to **115200 baud**.
5. Close Serial Monitor before uploading firmware to that board.

### Master 1

1. Open `firmware/master1/master1.ino`.
2. Replace `YOUR_WIFI_NAME` and `YOUR_WIFI_PASSWORD` with the internet Wi-Fi or phone-hotspot credentials.
3. Upload to the master.
4. Serial Monitor should show the local AP address `192.168.4.1`, then the internet-side IP when it connects. It also prints cloud upload success/failure.

The master runs in AP+station mode. Its local access point remains available to the sensor nodes while it uses the internet connection to reach Render.

### Sensor Node 1 and Sensor Node 2

1. Open `firmware/node1/node1.ino` and upload it to Node 1.
2. Open `firmware/node2/node2.ino` and upload it to Node 2.
3. Both nodes use the master's local SSID and password, which already match the master sketch. Do not put your home Wi-Fi or hotspot password into the node sketches.
4. Each node sends a reading immediately after connecting and then approximately every 30 seconds.

## 4. Sensor wiring and calibration

- Connect the soil sensor's analog output to `A0`, with sensor power and ground connected according to its datasheet.
- Check the maximum input voltage of your exact ESP8266 board. Some NodeMCU boards include an A0 divider; bare ESP8266 modules have a lower ADC input limit. Never assume all boards have the same limit.
- The default code maps ADC 0 to 100% moisture and ADC 1023 to 0%. This is only a starting estimate. Calibrate with your particular sensor in dry and wet soil; resistive and capacitive sensors may have different ranges or polarity.
- Disconnect power before changing wiring.

## 5. Data protocol

### Sensor node → master

HTTP POST to `http://192.168.4.1/sensor` with form fields:

```text
node=1&moisture=32.50
```

Node 2 sends `node=2`. The master validates the node ID and moisture range (0–100), queues the latest reading, and returns HTTP 202.

### Master → cloud

HTTPS POST to:

```text
https://cropconnect-backend-p0bo.onrender.com/api/sensor-data
```

JSON body:

```json
{ "master": 1, "node": 1, "moisture": 32.5 }
```

The master sends at most one queued reading per retry interval. If internet access or the backend is temporarily unavailable, the latest reading remains queued and is retried. The queue is in RAM; a power loss clears pending readings.

## 6. Verification checklist

- [ ] Master reports that `CropConnect-Master` access point started.
- [ ] Master joins the internet Wi-Fi/hotspot.
- [ ] Node 1 connects to `CropConnect-Master` and logs its moisture reading.
- [ ] Node 2 connects to `CropConnect-Master` and logs its moisture reading.
- [ ] Master logs incoming readings for node 1 and node 2.
- [ ] Master logs HTTP 2xx after cloud uploads.
- [ ] The dashboard shows backend nodes 1 and 2 with recent timestamps.
- [ ] Render's backend environment has `MOCK_MODE=false` for a real-data deployment.

## 7. Software-only safety

The current firmware is read-only with respect to physical devices. It contains no pump, motor, valve, relay, command, or actuator control logic. Machine-learning predictions and backend decisions are for display and analysis only. The retired serial gateway is disabled; it must not be used with the previous ESP32 command protocol.

## 8. Troubleshooting

- **Node can't join the master AP:** Verify SSID/password spelling, keep the node within range, restart the master, and confirm the master AP is visible.
- **Master AP works but cloud upload fails:** Verify its internet Wi-Fi credentials and that the hotspot has internet access. Render's free service may need time to wake.
- **Master receives readings but dashboard doesn't change:** Check cloud upload HTTP status, backend logs, and that the frontend deployment contains the updated mapping to nodes 1 and 2.
- **Reading looks inverted or inaccurate:** Calibrate the ADC-to-moisture mapping for the actual sensor and soil.
- **No COM port:** Reconnect USB, try a known data-capable cable, check Device Manager, and install the correct USB-to-serial driver for the board's chip.
