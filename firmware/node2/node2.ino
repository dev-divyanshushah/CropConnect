/*
 * CropConnect Sensor Node 2 — ESP8266
 * Reads the analog soil-moisture sensor on A0 and sends the reading to
 * Master 1 over the master's local Wi-Fi network.
 *
 * SOFTWARE-ONLY: no relay, pump, motor, valve, or actuator code is present.
 *
 * Arduino board: NodeMCU 1.0 (ESP-12E Module)
 * Sensor signal: A0 (check your specific board's A0 input-voltage limit).
 *
 * Upload this sketch to Sensor Node 2. No external Wi-Fi credentials are
 * needed; the node connects to the access point created by Master 1.
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>

#define NODE_ID 2
const char* MASTER_AP_SSID = "CropConnect-Master";
const char* MASTER_AP_PASSWORD = "CropConnect-NodeLink-26";
const char* MASTER_SENSOR_URL = "http://192.168.4.1/sensor";

const unsigned long SEND_INTERVAL_MS = 30000UL;
const unsigned long WIFI_RETRY_MS = 10000UL;

unsigned long lastSendMs = 0;
unsigned long lastWiFiAttemptMs = 0;
bool firstReading = true;

float readSoilMoisturePercent() {
  int raw = analogRead(A0);
  // Generic starting scale: low ADC value = wetter, high ADC value = drier.
  // Calibrate this mapping for your sensor and soil before relying on it.
  float percent = 100.0f - (static_cast<float>(raw) * 100.0f / 1023.0f);
  return constrain(percent, 0.0f, 100.0f);
}

void connectToMaster() {
  Serial.printf("[NODE %d] Connecting to master's AP: %s\n", NODE_ID, MASTER_AP_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(MASTER_AP_SSID, MASTER_AP_PASSWORD);
  lastWiFiAttemptMs = millis();
}

bool sendReading(float moisture) {
  WiFiClient client;
  HTTPClient http;
  http.setTimeout(5000);

  if (!http.begin(client, MASTER_SENSOR_URL)) {
    Serial.println("[NODE] Could not start request to Master 1.");
    return false;
  }

  http.addHeader("Content-Type", "application/x-www-form-urlencoded");
  String body = String("node=") + NODE_ID + "&moisture=" + String(moisture, 2);
  int statusCode = http.POST(body);
  String response = http.getString();
  http.end();

  if (statusCode >= 200 && statusCode < 300) {
    Serial.printf("[NODE %d] Sent %.1f%% to Master 1 (HTTP %d)\n",
                  NODE_ID, moisture, statusCode);
    return true;
  }

  Serial.printf("[NODE %d] Send failed, HTTP %d\n", NODE_ID, statusCode);
  if (response.length()) Serial.println(response);
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf("\n=== CropConnect Sensor Node %d ===\n", NODE_ID);
  Serial.println("Read-only moisture sensor; actuator commands are not supported.");
  pinMode(A0, INPUT);
  connectToMaster();
}

void loop() {
  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWiFiAttemptMs >= WIFI_RETRY_MS) connectToMaster();
    delay(10);
    return;
  }

  if (firstReading || now - lastSendMs >= SEND_INTERVAL_MS) {
    firstReading = false;
    lastSendMs = now;

    float moisture = readSoilMoisturePercent();
    Serial.printf("[NODE %d] ADC=%d | moisture=%.1f%%\n",
                  NODE_ID, analogRead(A0), moisture);
    sendReading(moisture);
  }

  delay(10);
}
