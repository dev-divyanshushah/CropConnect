# Legacy ESP32 Cloud Setup Guide — Retired

This document describes the previous four-node ESP-NOW/ESP32 architecture. It is **not the current setup** and must not be followed for the active project.

The current hardware uses one Master ESP8266 and two Sensor ESP8266 boards. The master hosts a local Wi-Fi access point for the nodes and uploads sensor readings directly to the CropConnect backend. The firmware is software-only and contains no actuator command support.

Use the current guide instead:
- [Hardware integration](HARDWARE_INTEGRATION.md)
- [Firmware setup](firmware/README.md)
- [Master firmware](firmware/master1/master1.ino)
- [Sensor Node 1 firmware](firmware/node1/node1.ino)
- [Sensor Node 2 firmware](firmware/node2/node2.ino)

The old ESP32 gateway sketch is intentionally disabled so the previous command-routing path cannot be compiled accidentally.
