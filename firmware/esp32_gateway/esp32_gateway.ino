/**
 * esp32_gateway.ino
 *
 * CropConnect — ESP32 Gateway Firmware
 *
 * ROLE: Pure bridge between ESP-NOW (Master 2) and USB Serial (Laptop)
 *
 * DOES:
 *   • Receive espnow_packet_t from Master 2 via ESP-NOW
 *     – SENSOR_DATA → print "SENSOR,<node>,<moisture>\n" to Serial
 *     – ACK         → print "ACK,<node>,<ON|OFF>,<cmdId>\n" to Serial
 *   • Receive "COMMAND,<node>,<ON|OFF>,<cmdId>\n" from Serial (laptop)
 *     → build espnow_packet_t (PKT_COMMAND) → send to Master 2 via ESP-NOW
 *
 * DOES NOT:
 *   • Connect to Wi-Fi / Internet
 *   • Run any ML model
 *   • Make any irrigation decision
 *   • Talk directly to the cloud backend
 *
 * HARDWARE WIRING:
 *   ESP32 USB-C / Micro-USB → Laptop (power + data)
 *   No other wiring needed on the ESP32 for this role.
 *
 * ARDUINO IDE SETUP:
 *   Board        : ESP32 Dev Module (or your specific ESP32 board)
 *   Upload Speed : 921600
 *   Board Package: esp32 by Espressif Systems ≥ 2.0.0
 *   
 *   IMPORTANT: This sketch uses esp_now_register_recv_cb() with the
 *   new callback signature introduced in ESP32 Arduino Core 3.x.
 *   If you are using Core 2.x, see the note in onDataRecv() below.
 *
 * PEER MAC:
 *   Master 2 MAC:  EC:64:C9:CE:01:3E  ← already hardcoded below
 *   ESP32 own MAC: D0:EF:76:47:22:24  ← printed on startup to Serial
 */

#include <esp_now.h>
#include <WiFi.h>

// Copy espnow_packet.h into the same sketch folder, or use the
// Arduino library path. Both approaches work.
// If placed in the same .ino folder, Arduino IDE includes it automatically.
// Otherwise: #include "../shared/espnow_packet.h"
#include "espnow_packet.h"

// ── Serial baud rate ──────────────────────────────────────────
// Must match BAUD_RATE in hardware-gateway/.env (default 115200)
#define SERIAL_BAUD 115200

// ── Master 2 MAC address ─────────────────────────────────────
// MAC: EC:64:C9:CE:01:3E
static const uint8_t MASTER2_MAC[6] = { 0xEC, 0x64, 0xC9, 0xCE, 0x01, 0x3E };

// ── Serial line buffer ────────────────────────────────────────
#define MAX_LINE_LEN 80
static char  s_lineBuf[MAX_LINE_LEN];
static uint8_t s_lineLen = 0;

// ─────────────────────────────────────────────────────────────
// ESP-NOW SEND CALLBACK
// Called after esp_now_send(). Used only for error logging.
// ─────────────────────────────────────────────────────────────
void onDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
  if (status != ESP_NOW_SEND_SUCCESS) {
    Serial.println("LOG,ESP-NOW send to Master 2 FAILED");
  }
}

// ─────────────────────────────────────────────────────────────
// ESP-NOW RECEIVE CALLBACK
// Called when Master 2 sends a packet to this ESP32.
//
// NOTE on ESP32 Arduino Core versions:
//   Core 3.x signature: (const esp_now_recv_info_t *recv_info, ...)
//   Core 2.x signature: (const uint8_t *mac, ...)
// The #if below handles both automatically.
// ─────────────────────────────────────────────────────────────
#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onDataRecv(const esp_now_recv_info_t *recv_info, const uint8_t *data, int len) {
#else
void onDataRecv(const uint8_t *mac, const uint8_t *data, int len) {
#endif

  if (len != (int)sizeof(espnow_packet_t)) {
    char msg[64];
    snprintf(msg, sizeof(msg), "LOG,Bad packet size from Master 2: %d (expected %d)", len, (int)sizeof(espnow_packet_t));
    Serial.println(msg);
    return;
  }

  espnow_packet_t pkt;
  memcpy(&pkt, data, sizeof(espnow_packet_t));

  if (pkt.packetType == PKT_SENSOR_DATA) {
    // ── Forward sensor data to laptop ──────────────────────
    // Format: SENSOR,<nodeId>,<moisture>
    // Moisture is formatted to 2 decimal places.
    char msg[48];
    snprintf(msg, sizeof(msg), "SENSOR,%u,%.2f", (unsigned)pkt.nodeId, pkt.moisture);
    Serial.println(msg);
    Serial.flush();

  } else if (pkt.packetType == PKT_ACK) {
    // ── Forward ACK to laptop ──────────────────────────────
    // Format: ACK,<nodeId>,<ON|OFF>,<commandId>
    const char *stateStr = (pkt.pumpState == PUMP_ON) ? "ON" : "OFF";
    char msg[48];
    snprintf(msg, sizeof(msg), "ACK,%u,%s,%u",
             (unsigned)pkt.nodeId, stateStr, (unsigned)pkt.commandId);
    Serial.println(msg);
    Serial.flush();

  } else {
    char msg[64];
    snprintf(msg, sizeof(msg), "LOG,Unknown packetType %u from Master 2", (unsigned)pkt.packetType);
    Serial.println(msg);
  }
}

// ─────────────────────────────────────────────────────────────
// PARSE AND EXECUTE SERIAL COMMAND FROM LAPTOP
// Expected format: COMMAND,<node>,<ON|OFF>,<cmdId>\n
// ─────────────────────────────────────────────────────────────
static void handleSerialLine(char *line) {
  // Work on a copy so strtok doesn't destroy original for logging
  char buf[MAX_LINE_LEN];
  strncpy(buf, line, MAX_LINE_LEN - 1);
  buf[MAX_LINE_LEN - 1] = '\0';

  char *tok = strtok(buf, ",");
  if (!tok) return;

  if (strcmp(tok, "COMMAND") != 0) {
    // Not a COMMAND — unknown message type
    Serial.print("LOG,Unknown message from laptop: ");
    Serial.println(line);
    return;
  }

  char *nodeStr  = strtok(NULL, ",");
  char *stateStr = strtok(NULL, ",");
  char *cmdIdStr = strtok(NULL, ",\r\n");

  // Validate field presence
  if (!nodeStr || !stateStr || !cmdIdStr) {
    Serial.println("LOG,Malformed COMMAND (need COMMAND,node,state,cmdId)");
    return;
  }

  int node  = atoi(nodeStr);
  int cmdId = atoi(cmdIdStr);

  // Validate node ID
  if (node != 3 && node != 4) {
    Serial.print("LOG,Invalid node in COMMAND: ");
    Serial.println(nodeStr);
    return;
  }

  // Validate state
  bool stateIsOn;
  if (strcmp(stateStr, "ON") == 0)       stateIsOn = true;
  else if (strcmp(stateStr, "OFF") == 0) stateIsOn = false;
  else {
    Serial.print("LOG,Invalid state in COMMAND: ");
    Serial.println(stateStr);
    return;
  }

  // Validate cmdId range
  if (cmdId < 0 || cmdId > 255) {
    Serial.println("LOG,cmdId out of range (0-255)");
    return;
  }

  // ── Build and send ESP-NOW COMMAND packet to Master 2 ──────
  espnow_packet_t pkt;
  memset(&pkt, 0, sizeof(pkt));
  pkt.packetType = PKT_COMMAND;
  pkt.nodeId     = (uint8_t)node;
  pkt.commandId  = (uint8_t)cmdId;
  pkt.pumpState  = stateIsOn ? PUMP_ON : PUMP_OFF;
  pkt.moisture   = 0.0f;

  esp_err_t result = esp_now_send(MASTER2_MAC, (uint8_t *)&pkt, sizeof(pkt));

  char log[80];
  snprintf(log, sizeof(log), "LOG,COMMAND forwarded to Master2: node=%d state=%s cmdId=%d result=%d",
           node, stateIsOn ? "ON" : "OFF", cmdId, (int)result);
  Serial.println(log);
}

// ─────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(500);

  Serial.println("LOG,CropConnect ESP32 Gateway starting...");

  // Wi-Fi station mode is required for ESP-NOW (no AP, no internet)
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  // Print own MAC so user can note it / verify it matches plan
  Serial.print("LOG,ESP32 MAC: ");
  Serial.println(WiFi.macAddress());  // Should be D0:EF:76:47:22:24

  // Initialise ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println("LOG,FATAL: esp_now_init() failed. Check WiFi mode.");
    while (true) { delay(1000); }  // halt
  }

  // Register callbacks
  esp_now_register_send_cb(onDataSent);
  esp_now_register_recv_cb(onDataRecv);

  // Register Master 2 as the only ESP-NOW peer
  esp_now_peer_info_t peerInfo;
  memset(&peerInfo, 0, sizeof(peerInfo));
  memcpy(peerInfo.peer_addr, MASTER2_MAC, 6);
  peerInfo.channel = 0;       // 0 = same channel as current WiFi
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    Serial.println("LOG,FATAL: Failed to add Master 2 as ESP-NOW peer.");
    while (true) { delay(1000); }  // halt
  }

  Serial.println("LOG,ESP32 Gateway ready. Listening for Master 2 and laptop...");
}

// ─────────────────────────────────────────────────────────────
// LOOP — reads serial line-by-line from laptop
// ─────────────────────────────────────────────────────────────
void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();

    if (c == '\n' || c == '\r') {
      if (s_lineLen > 0) {
        s_lineBuf[s_lineLen] = '\0';
        handleSerialLine(s_lineBuf);
        s_lineLen = 0;
      }
      // ignore bare \r or empty lines
    } else {
      if (s_lineLen < MAX_LINE_LEN - 1) {
        s_lineBuf[s_lineLen++] = c;
      } else {
        // Buffer overflow — discard and reset
        s_lineLen = 0;
        Serial.println("LOG,Serial buffer overflow — line discarded");
      }
    }
  }
  // No other blocking work in loop — all ESP-NOW logic is callback-driven
}
