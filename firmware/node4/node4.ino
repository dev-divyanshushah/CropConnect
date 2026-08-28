/**
 * node4.ino
 *
 * CropConnect — Node 4 Firmware (ESP8266)
 *
 * ROLE: Sensor node — reads soil moisture, actuates irrigation relay
 *
 * This file is identical in structure to node3.ino.
 * The only difference is NODE_ID 4.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  !! GPIO CONFIGURATION — NOT YET SET — DO NOT FLASH !!      │
 * │                                                             │
 * │  RELAY_PIN, MOISTURE_PIN, relay logic (active-HIGH/LOW),    │
 * │  and sensor interface (analog/digital) are ALL left as      │
 * │  TODO below.                                                │
 * │                                                             │
 * │  Ask the user for these values before enabling              │
 * │  the hardware actuation code.                               │
 * └─────────────────────────────────────────────────────────────┘
 *
 * ARDUINO IDE SETUP:
 *   Board        : Generic ESP8266 Module (or your actual ESP8266 board)
 *   Upload Speed : 115200
 *   Board Package: ESP8266 by ESP8266 Community ≥ 3.1.0
 *
 * KNOWN MAC:
 *   Master 2 (peer): EC:64:C9:CE:01:3E  ← already hardcoded below
 *   This node's MAC: run the sketch to see it on Serial Monitor
 *                    Copy output into NODE4_MAC[] in master2.ino
 */

#include <espnow.h>
#include <ESP8266WiFi.h>
#include "espnow_packet.h"

// ── Node identity ─────────────────────────────────────────────
#define NODE_ID  4      // ← Only difference from node3.ino

// ─────────────────────────────────────────────────────────────
// GPIO CONFIGURATION
// ─────────────────────────────────────────────────────────────
#define MOISTURE_PIN   A0    // Analog capacitive/resistive sensor
// Node 4 has NO RELAY. Do not add or actuate one.
// ─────────────────────────────────────────────────────────────

// ── Timing ────────────────────────────────────────────────────
#define SEND_INTERVAL_MS  30000UL   // 30 seconds

// ── Master 2 MAC (uplink peer) ────────────────────────────────
// MAC: EC:64:C9:CE:01:3E
static const uint8_t MASTER2_MAC[6] = { 0xEC, 0x64, 0xC9, 0xCE, 0x01, 0x3E };

// ── Internal state ─────────────────────────────────────────────
static bool           s_pumpState  = false;
static unsigned long  s_lastSendMs = 0;

// ─────────────────────────────────────────────────────────────
// READ MOISTURE SENSOR
// ─────────────────────────────────────────────────────────────
static float readMoisture() {
  int raw = analogRead(MOISTURE_PIN);   // 0 (wet) – 1023 (dry)
  // Assuming standard resistive/capacitive analog behavior where higher is drier.
  // Adapt mapping below if the sensor uses a different scale.
  float pct = 100.0f - ((float)raw / 1023.0f * 100.0f);
  return constrain(pct, 0.0f, 100.0f);
}

// ─────────────────────────────────────────────────────────────
// SET PUMP / RELAY
// ─────────────────────────────────────────────────────────────
static void setPump(bool on) {
  // NO RELAY ON NODE 4
  s_pumpState = on; // keep state updated for ACKs but do not actuate physical hardware
  Serial.printf("[NODE %d] Pump state recorded as: %s (NO PHYSICAL RELAY)\n",
                NODE_ID, on ? "ON" : "OFF");
}

// ─────────────────────────────────────────────────────────────
// ESP-NOW SEND CALLBACK
// ─────────────────────────────────────────────────────────────
void onDataSent(uint8_t *mac, uint8_t status) {
  if (status != 0) {
    Serial.printf("[NODE %d] WARNING: ESP-NOW send to Master 2 FAILED\n", NODE_ID);
  }
}

// ─────────────────────────────────────────────────────────────
// ESP-NOW RECEIVE CALLBACK
// ─────────────────────────────────────────────────────────────
void onDataRecv(uint8_t *senderMAC, uint8_t *data, uint8_t len) {
  if (len != sizeof(espnow_packet_t)) {
    Serial.printf("[NODE %d] Bad packet size: %d\n", NODE_ID, (int)len);
    return;
  }

  espnow_packet_t pkt;
  memcpy(&pkt, data, sizeof(espnow_packet_t));

  if (pkt.packetType != PKT_COMMAND) {
    Serial.printf("[NODE %d] Unexpected packetType=%d (ignoring)\n",
                  NODE_ID, (int)pkt.packetType);
    return;
  }

  // Discard commands for other nodes
  if (pkt.nodeId != NODE_ID) {
    Serial.printf("[NODE %d] Command for node %d — discarding\n",
                  NODE_ID, (int)pkt.nodeId);
    return;
  }

  bool newState = (pkt.pumpState == PUMP_ON);
  Serial.printf("[NODE %d] Command: %s (cmdId=%d)\n",
                NODE_ID, newState ? "ON" : "OFF", (int)pkt.commandId);

  // Actuate relay
  setPump(newState);

  // Send ACK to Master 2
  espnow_packet_t ack;
  memset(&ack, 0, sizeof(ack));
  ack.packetType = PKT_ACK;
  ack.nodeId     = NODE_ID;
  ack.commandId  = pkt.commandId;
  ack.pumpState  = pkt.pumpState;
  ack.moisture   = 0.0f;

  int result = esp_now_send(const_cast<uint8_t*>(MASTER2_MAC),
                             (uint8_t *)&ack, sizeof(ack));
  if (result == 0) {
    Serial.printf("[NODE %d] ACK sent (cmdId=%d)\n", NODE_ID, (int)pkt.commandId);
  } else {
    Serial.printf("[NODE %d] WARNING: ACK send failed, code=%d\n", NODE_ID, result);
  }
}

// ─────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.printf("\n[NODE %d] CropConnect Node %d starting...\n", NODE_ID, NODE_ID);

  // Node 4 has NO relay hardware
  s_pumpState = false; 

  // Moisture pin is analog (A0) - doesn't need pinMode explicitly on ESP8266, but setting it is fine
  pinMode(MOISTURE_PIN, INPUT);

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  // Print own MAC — copy this into NODE4_MAC[] in master2.ino
  Serial.printf("[NODE %d] MAC: ", NODE_ID);
  Serial.println(WiFi.macAddress());

  if (esp_now_init() != 0) {
    Serial.printf("[NODE %d] FATAL: esp_now_init() failed\n", NODE_ID);
    while (true) { delay(1000); }
  }

  esp_now_set_self_role(ESP_NOW_ROLE_COMBO);
  esp_now_register_recv_cb(onDataRecv);
  esp_now_register_send_cb(onDataSent);

  esp_now_add_peer(const_cast<uint8_t*>(MASTER2_MAC), ESP_NOW_ROLE_COMBO, 1, NULL, 0);

  Serial.printf("[NODE %d] Ready. Node 4 has NO relay, reading analog moisture on A0.\n", NODE_ID);
}

// ─────────────────────────────────────────────────────────────
// LOOP
// ─────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  if (now - s_lastSendMs >= SEND_INTERVAL_MS) {
    s_lastSendMs = now;

    float moisture = readMoisture();

    espnow_packet_t pkt;
    memset(&pkt, 0, sizeof(pkt));
    pkt.packetType = PKT_SENSOR_DATA;
    pkt.nodeId     = NODE_ID;
    pkt.commandId  = 0;
    pkt.pumpState  = s_pumpState ? PUMP_ON : PUMP_OFF;
    pkt.moisture   = moisture;

    Serial.printf("[NODE %d] Sending moisture=%.2f%% to Master 2\n",
                  NODE_ID, moisture);

    int result = esp_now_send(const_cast<uint8_t*>(MASTER2_MAC),
                               (uint8_t *)&pkt, sizeof(pkt));
    if (result != 0) {
      Serial.printf("[NODE %d] WARNING: Send failed, code=%d\n", NODE_ID, result);
    }
  }

  delay(10);
}
