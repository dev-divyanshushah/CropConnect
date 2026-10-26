/*
 * CropConnect Master 1 — ESP8266
 * Receives moisture readings from Sensor Nodes 1 and 2 over its own Wi-Fi AP,
 * then forwards them to the CropConnect cloud API.
 *
 * SOFTWARE-ONLY: This firmware has no actuator commands and does not control
 * pumps, motors, valves, relays, or other physical devices.
 *
 * Arduino board: NodeMCU 1.0 (ESP-12E Module)
 * Libraries: ESP8266 board package (ESP8266WebServer, ESP8266HTTPClient,
 *            ESP8266WiFi, BearSSL are included with the board package)
 *
 * Configure WIFI_SSID and WIFI_PASSWORD for the internet-connected Wi-Fi
 * or 2.4 GHz phone hotspot. Nodes connect to this master's local AP instead.
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <stdlib.h>
#include <math.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

const char* NODE_AP_SSID = "CropConnect-Master";
const char* NODE_AP_PASSWORD = "CropConnect-NodeLink-26";
const char* CLOUD_ENDPOINT = "https://cropconnect-backend-p0bo.onrender.com/api/sensor-data";

const unsigned long CLOUD_RETRY_MS = 10000UL;
const unsigned long WIFI_RETRY_MS = 15000UL;

ESP8266WebServer server(80);

struct PendingReading {
  float moisture = 0.0f;
  bool pending = false;
  unsigned long receivedAt = 0;
};

PendingReading readings[2];
unsigned long lastCloudAttemptMs = 0;
unsigned long lastWiFiAttemptMs = 0;

int slotForNode(int nodeId) {
  if (nodeId == 1) return 0;
  if (nodeId == 2) return 1;
  return -1;
}

void handleRoot() {
  server.send(200, "text/plain",
    "CropConnect Master 1 is online. POST node and moisture to /sensor. Software-only.");
}

void handleSensor() {
  if (!server.hasArg("node") || !server.hasArg("moisture")) {
    server.send(400, "application/json",
      "{\"success\":false,\"error\":\"Required fields: node, moisture\"}");
    return;
  }

  int nodeId = server.arg("node").toInt();
  String moistureText = server.arg("moisture");
  char* endPtr = nullptr;
  float moisture = strtof(moistureText.c_str(), &endPtr);
  int slot = slotForNode(nodeId);

  if (slot < 0 || endPtr == moistureText.c_str() || *endPtr != '\0' ||
      !isfinite(moisture) || moisture < 0.0f || moisture > 100.0f) {
    server.send(400, "application/json",
      "{\"success\":false,\"error\":\"node must be 1 or 2 and moisture must be 0-100\"}");
    return;
  }

  readings[slot].moisture = moisture;
  readings[slot].pending = true;
  readings[slot].receivedAt = millis();

  Serial.printf("[MASTER] Node %d reading received: %.1f%%\n", nodeId, moisture);
  server.send(202, "application/json",
    String("{\"success\":true,\"node\":") + nodeId +
    ",\"moisture\":" + String(moisture, 1) +
    ",\"queuedForCloud\":true}");
}

void startNodeAccessPoint() {
  WiFi.softAPConfig(IPAddress(192, 168, 4, 1),
                    IPAddress(192, 168, 4, 1),
                    IPAddress(255, 255, 255, 0));
  bool ok = WiFi.softAP(NODE_AP_SSID, NODE_AP_PASSWORD);
  Serial.printf("[MASTER] Node Wi-Fi AP %s: %s\n",
                NODE_AP_SSID, ok ? "started" : "FAILED");
  Serial.print("[MASTER] Nodes should POST to http://");
  Serial.println(WiFi.softAPIP());
}

void connectInternetWiFi() {
  Serial.printf("[MASTER] Connecting to internet Wi-Fi: %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWiFiAttemptMs = millis();
}

bool uploadReading(int nodeId, float moisture) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[CLOUD] Wi-Fi unavailable; keeping reading queued.");
    return false;
  }

  BearSSL::WiFiClientSecure client;
  // Simplifies HTTPS on the ESP8266; see firmware/README.md for the TLS note.
  client.setInsecure();

  HTTPClient https;
  https.setTimeout(12000);
  if (!https.begin(client, CLOUD_ENDPOINT)) {
    Serial.println("[CLOUD] Could not start HTTPS request.");
    return false;
  }

  https.addHeader("Content-Type", "application/json");
  String body = String("{\"master\":1,\"node\":") + nodeId +
                ",\"moisture\":" + String(moisture, 2) + "}";
  int statusCode = https.POST(body);
  String responseBody = https.getString();
  https.end();

  if (statusCode >= 200 && statusCode < 300) {
    Serial.printf("[CLOUD] Node %d uploaded (%.1f%%), HTTP %d\n",
                  nodeId, moisture, statusCode);
    return true;
  }

  Serial.printf("[CLOUD] Upload failed for Node %d, HTTP %d\n",
                nodeId, statusCode);
  if (responseBody.length()) Serial.println(responseBody);
  return false;
}

void forwardOnePendingReading() {
  unsigned long now = millis();
  if (now - lastCloudAttemptMs < CLOUD_RETRY_MS) return;
  lastCloudAttemptMs = now;

  for (int slot = 0; slot < 2; slot++) {
    if (!readings[slot].pending) continue;
    int nodeId = slot + 1;
    float moisture = readings[slot].moisture;
    if (uploadReading(nodeId, moisture)) {
      // Do not clear a newer reading that arrived while this request ran.
      if (readings[slot].moisture == moisture) readings[slot].pending = false;
    }
    return; // One HTTPS request per retry interval.
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== CropConnect Master 1 ===");
  Serial.println("Software-only sensor gateway; actuator control is disabled.");

  WiFi.persistent(false);
  WiFi.mode(WIFI_AP_STA);
  WiFi.setAutoReconnect(true);

  startNodeAccessPoint();

  server.on("/", HTTP_GET, handleRoot);
  server.on("/sensor", HTTP_POST, handleSensor);
  server.onNotFound([]() {
    server.send(404, "application/json", "{\"success\":false,\"error\":\"Not found\"}");
  });
  server.begin();
  Serial.println("[MASTER] Local sensor server listening on port 80.");

  connectInternetWiFi();
  lastCloudAttemptMs = millis() - CLOUD_RETRY_MS;
}

void loop() {
  server.handleClient();

  unsigned long now = millis();
  if (WiFi.status() != WL_CONNECTED && now - lastWiFiAttemptMs >= WIFI_RETRY_MS) {
    Serial.println("[MASTER] Retrying internet Wi-Fi...");
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    lastWiFiAttemptMs = now;
  }

  if (WiFi.status() == WL_CONNECTED && WiFi.localIP()[0] != 0) {
    static bool printedInternetIP = false;
    if (!printedInternetIP) {
      Serial.print("[MASTER] Internet Wi-Fi connected. IP: ");
      Serial.println(WiFi.localIP());
      printedInternetIP = true;
    }
  }

  forwardOnePendingReading();
  delay(2);
}
