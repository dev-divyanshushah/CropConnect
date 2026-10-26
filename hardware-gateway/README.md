# Hardware Gateway — Retired

The former laptop/ESP32 serial gateway is **not used** in the current CropConnect architecture. The Master ESP8266 now receives readings from the two sensor nodes and uploads them directly to the cloud backend.

The previous gateway polled `/api/status` and sent legacy `COMMAND` messages to an ESP32. That behavior has been disabled to enforce the current software-only design.

Use the firmware in:

- `firmware/master1/master1.ino`
- `firmware/node1/node1.ino`
- `firmware/node2/node2.ino`

No gateway process needs to run on the laptop.
