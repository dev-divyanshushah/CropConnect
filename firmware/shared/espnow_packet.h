/**
 * espnow_packet.h
 *
 * CropConnect — Shared ESP-NOW packet structure.
 * Include this file in ALL four firmware sketches:
 *   esp32_gateway.ino, master2.ino, node3.ino, node4.ino
 *
 * The struct is exactly 8 bytes. All devices must compile with
 * identical struct layout (no compiler padding issues — all fields
 * are explicitly byte-sized or 4-byte float).
 *
 *  packetType  nodeId  commandId  pumpState  moisture(4B)
 *  ──────────  ──────  ─────────  ─────────  ────────────
 *     1 byte   1 byte    1 byte     1 byte      4 bytes
 *
 * Total: 8 bytes per packet.
 */

#ifndef ESPNOW_PACKET_H
#define ESPNOW_PACKET_H

#include <stdint.h>

// ── Packet type constants ──────────────────────────────────────
#define PKT_SENSOR_DATA  0   // Node  → Master 2 → ESP32  (sensor reading)
#define PKT_COMMAND      1   // ESP32 → Master 2 → Node   (irrigation command)
#define PKT_ACK          2   // Node  → Master 2 → ESP32  (command acknowledged)

// ── Pump state constants ──────────────────────────────────────
#define PUMP_OFF  0
#define PUMP_ON   1

// ── Shared packet struct ───────────────────────────────────────
// Must be identical across all firmware files.
// Do NOT add fields without updating all four firmware files.
typedef struct __attribute__((packed)) {
  uint8_t packetType;  // PKT_SENSOR_DATA | PKT_COMMAND | PKT_ACK
  uint8_t nodeId;      // 3 or 4
  uint8_t commandId;   // Sequence number 0–255 (wraps). Ties COMMAND to ACK.
                       // Set to 0 for SENSOR_DATA packets.
  uint8_t pumpState;   // PUMP_OFF | PUMP_ON
                       // Valid for COMMAND and ACK packets.
                       // Set to 0 for SENSOR_DATA packets.
  float   moisture;    // Soil moisture 0.0–100.0 %
                       // Valid for SENSOR_DATA packets only.
                       // Set to 0.0 for COMMAND and ACK packets.
} espnow_packet_t;

#endif // ESPNOW_PACKET_H
