/**
 * master2.ino
 *
 * CropConnect — Master 2 Firmware (ESP8266)
 *
 * ROLE: Pure ESP-NOW router / forwarder
 *
 * ROUTING TABLE:
 *   From Node 3/4 (SENSOR_DATA)  → forward to ESP32
 *   From ESP32    (COMMAND)       → route to Node 3 or Node 4
 *   From Node 3/4 (ACK)          → forward to ESP32
 *
 * DOES NOT:
 *   • Connect to Wi-Fi / Internet
 *   • Run any ML model
 *   • Make any irrigation decision
 *   • Control any relay directly
 *
 * KNOWN MACS (hardcoded):
 *   This device (Master 2): EC:64:C9:CE:01:3E  ← printed on startup
 *   ESP32:                  D0:EF:76:47:22:24  ← uplink peer
 *
 * TODO — FILL IN BEFORE FLASHING:
 *   NODE3_MAC[] and NODE4_MAC[] below with the actual ESP8266 MACs
 *   of Node 3 and Node 4. Run the "Print MAC" sketch on each node
 *   to discover them:
 *       #include <ESP8266WiFi.h>
 *       void setup() { Serial.begin(115200); WiFi.mode(WIFI_STA);
 *                       Serial.println(WiFi.macAddress()); }
 *       void loop() {}
 *
 * ARDUINO IDE SETUP:
 *   Board        : Generic ESP8266 Module  (or NodeMCU 1.0, Wemos D1 Mini, etc.)
 *   Upload Speed : 115200
 *   Board Package: ESP8266 by ESP8266 Community ≥ 3.1.0
 */

#include <espnow.h>
#include <ESP8266WiFi.h>
#include "espnow_packet.h"

// ── Peer MACs ─────────────────────────────────────────────────

// ESP32 uplink
static const uint8_t ESP32_MAC[6]  = { 0xD0, 0xEF, 0x76, 0x47, 0x22, 0x24 };

// Node 3 MAC
static uint8_t NODE3_MAC[6] = { 0xC8, 0x2B, 0x96, 0x09, 0x1A, 0x0B };
// Node 4 MAC
static uint8_t NODE4_MAC[6] = { 0xEC, 0x64, 0xC9, 0xCE, 0x12, 0x71 };

// ── Helpers ────────────────────────────────────────────────────
static bool macIsZero(const uint8_t *mac) {
  for (int i = 0; i < 6; i++) if (mac[i] != 0) return false;
  return true;
}

static String macToStr(const uint8_t *mac) {
  char buf[18];
  snprintf(buf, sizeof(buf), "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(buf);
}

// ─────────────────────────────────────────────────────────────
// ESP-NOW SEND CALLBACK — error logging only
// ─────────────────────────────────────────────────────────────
void onDataSent(uint8_t *mac, uint8_t status) {
  if (status != 0) {
    Serial.print("[MASTER2] ESP-NOW send FAILED to ");
    Serial.println(macToStr(mac));
  }
}

// ─────────────────────────────────────────────────────────────
// ESP-NOW RECEIVE CALLBACK
// ─────────────────────────────────────────────────────────────
void onDataRecv(uint8_t *senderMAC, uint8_t *data, uint8_t len) {
  if (len != sizeof(espnow_packet_t)) {
    Serial.print("[MASTER2] Bad packet size: ");
    Serial.print(len);
    Serial.print(" (expected ");
    Serial.print((int)sizeof(espnow_packet_t));
    Serial.println(")");
    return;
  }

  espnow_packet_t pkt;
  memcpy(&pkt, data, sizeof(espnow_packet_t));

  // ──────────────────────────────────────────────────────────
  // SENSOR_DATA from Node 3 or Node 4 → forward to ESP32
  // ──────────────────────────────────────────────────────────
  if (pkt.packetType == PKT_SENSOR_DATA) {
    Serial.printf("[MASTER2] Sensor from Node %u: %.2f%%\n",
                  (unsigned)pkt.nodeId, pkt.moisture);
    Serial.println("[MASTER2] Forwarding sensor → ESP32...");

    int result = esp_now_send(const_cast<uint8_t*>(ESP32_MAC),
                              (uint8_t *)&pkt, sizeof(pkt));
    if (result != 0) {
      Serial.print("[MASTER2] WARN: Forward to ESP32 failed, code=");
      Serial.println(result);
    }
    return;
  }

  // ──────────────────────────────────────────────────────────
  // COMMAND from ESP32 → route to correct node
  // ──────────────────────────────────────────────────────────
  if (pkt.packetType == PKT_COMMAND) {
    const char *stateStr = (pkt.pumpState == PUMP_ON) ? "ON" : "OFF";
    Serial.printf("[MASTER2] Command from ESP32: node=%u state=%s cmdId=%u\n",
                  (unsigned)pkt.nodeId, stateStr, (unsigned)pkt.commandId);

    uint8_t *targetMAC = nullptr;
    if      (pkt.nodeId == 3) targetMAC = NODE3_MAC;
    else if (pkt.nodeId == 4) targetMAC = NODE4_MAC;
    else {
      Serial.print("[MASTER2] Unknown nodeId in COMMAND: ");
      Serial.println((int)pkt.nodeId);
      return;
    }

    if (macIsZero(targetMAC)) {
      Serial.printf("[MASTER2] WARN: Node %u MAC not configured — command dropped!\n",
                    (unsigned)pkt.nodeId);
      Serial.println("[MASTER2]       Edit NODE3_MAC/NODE4_MAC in master2.ino and reflash.");
      return;
    }

    Serial.printf("[MASTER2] Forwarding command → Node %u...\n", (unsigned)pkt.nodeId);
    int result = esp_now_send(targetMAC, (uint8_t *)&pkt, sizeof(pkt));
    if (result != 0) {
      Serial.printf("[MASTER2] WARN: Forward to Node %u failed, code=%d\n",
                    (unsigned)pkt.nodeId, result);
    }
    return;
  }

  // ──────────────────────────────────────────────────────────
  // ACK from Node 3 or Node 4 → forward to ESP32
  // ──────────────────────────────────────────────────────────
  if (pkt.packetType == PKT_ACK) {
    const char *stateStr = (pkt.pumpState == PUMP_ON) ? "ON" : "OFF";
    Serial.printf("[MASTER2] ACK from Node %u: state=%s cmdId=%u\n",
                  (unsigned)pkt.nodeId, stateStr, (unsigned)pkt.commandId);
    Serial.println("[MASTER2] Forwarding ACK → ESP32...");

    int result = esp_now_send(const_cast<uint8_t*>(ESP32_MAC),
                              (uint8_t *)&pkt, sizeof(pkt));
    if (result != 0) {
      Serial.print("[MASTER2] WARN: Forward ACK to ESP32 failed, code=");
      Serial.println(result);
    }
    return;
  }

  Serial.print("[MASTER2] Unknown packetType: ");
  Serial.println((int)pkt.packetType);
}

// ─────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n[MASTER2] CropConnect Master 2 starting...");
  Serial.println("[MASTER2] Role: Pure ESP-NOW router (no relay, no ML)");

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  // Print own MAC for verification (should be EC:64:C9:CE:01:3E)
  Serial.print("[MASTER2] Own MAC: ");
  Serial.println(WiFi.macAddress());

  if (esp_now_init() != 0) {
    Serial.println("[MASTER2] FATAL: esp_now_init() failed");
    while (true) { delay(1000); }
  }

  // COMBO role: can both send and receive ESP-NOW packets
  esp_now_set_self_role(ESP_NOW_ROLE_COMBO);
  esp_now_register_recv_cb(onDataRecv);
  esp_now_register_send_cb(onDataSent);

  // Register ESP32 as peer (uplink)
  esp_now_add_peer(const_cast<uint8_t*>(ESP32_MAC), ESP_NOW_ROLE_COMBO, 1, NULL, 0);
  Serial.print("[MASTER2] Registered ESP32 peer: ");
  Serial.println(macToStr(ESP32_MAC));

  // Register Node 3 (if MAC configured)
  if (!macIsZero(NODE3_MAC)) {
    esp_now_add_peer(NODE3_MAC, ESP_NOW_ROLE_COMBO, 1, NULL, 0);
    Serial.print("[MASTER2] Registered Node 3 peer: ");
    Serial.println(macToStr(NODE3_MAC));
  } else {
    Serial.println("[MASTER2] WARNING: Node 3 MAC = 00:00... (not configured)");
    Serial.println("[MASTER2]         Edit NODE3_MAC[] in master2.ino and reflash.");
  }

  // Register Node 4 (if MAC configured)
  if (!macIsZero(NODE4_MAC)) {
    esp_now_add_peer(NODE4_MAC, ESP_NOW_ROLE_COMBO, 1, NULL, 0);
    Serial.print("[MASTER2] Registered Node 4 peer: ");
    Serial.println(macToStr(NODE4_MAC));
  } else {
    Serial.println("[MASTER2] WARNING: Node 4 MAC = 00:00... (not configured)");
    Serial.println("[MASTER2]         Edit NODE4_MAC[] in master2.ino and reflash.");
  }

  Serial.println("[MASTER2] Ready. Waiting for ESP-NOW packets...");
}

// ─────────────────────────────────────────────────────────────
// LOOP — all logic is callback-driven
// ─────────────────────────────────────────────────────────────
void loop() {
  delay(10);  // yield to ESP8266 background tasks
}
