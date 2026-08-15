# Live ML Feature Gap Analysis

This document details the discrepancy between the features required by the production XGBoost model and the data currently available from the CropConnect hardware/backend.

## 1. ESP8266 Data Ingestion & Storage

### What ESP8266 Sends
Currently, the ESP8266 microcontrollers send data to the backend via `POST /api/sensor-data` using the following exact payload:
```json
{
  "master": 1,
  "node": 1,
  "moisture": 32
}
```
*It only provides the hardware IDs and the current, real-time soil moisture percentage.*

### What the Backend Stores
The Node.js backend maintains this data in active memory and saves it to a single JSON snapshot (`irrigation_data.json`). The stored object looks like:
```json
{
  "node": 1,
  "master": 1,
  "moisture": 32,
  "updatedAt": "2026-08-15T18:11:22.084Z",
  "override": null
}
```
*Crucially, the active memory only stores the **latest** reading. It does not natively store a rolling 7-day history array of soil moisture needed for time-series forecasting. Historical data is saved to MongoDB (if configured), but the current pipeline does not query MongoDB in real-time to compute lags.*

---

## 2. Feature Gap Table

| FEATURE | REQUIRED BY MODEL | AVAILABLE NOW | SOURCE | HOW TO PROVIDE IT |
| :--- | :---: | :---: | :--- | :--- |
| **`clay_content`** | Yes | No | N/A | Requires manual farm configuration. We could map the existing `farmSettings.soilType` (e.g., "Loamy") to static % values in a config dictionary. |
| **`sand_content`** | Yes | No | N/A | Same as `clay_content`. Map from `soilType`. |
| **`silt_content`** | Yes | No | N/A | Same as `clay_content`. Map from `soilType`. |
| **`sm_aux`** | Yes | No | N/A | This auxiliary satellite/precipitation index is not provided by ESP8266 or the OpenWeather API in the required format. **Recommendation:** Remove this feature in a future retraining step, as it is unavailable. |
| **`sm_tgt_lag1`** | Yes | No | N/A | Cannot be passed from current state. Must be derived from historical sensor readings by either querying MongoDB for yesterday's average, or modifying the backend memory to keep a 7-day rolling cache. |
| **`sm_tgt_lag3`** | Yes | No | N/A | Same as `sm_tgt_lag1`. Requires historical data access. |
| **`sm_tgt_lag7`** | Yes | No | N/A | Same as `sm_tgt_lag1`. Requires historical data access. |
| **`sm_tgt_roll7_mean`**| Yes | No | N/A | Same as `sm_tgt_lag1`. Requires historical data access. |
| **`month`** | Yes | **Yes** | Server Clock | Derived directly from `new Date().getMonth()`. |
| **`day_of_year`** | Yes | **Yes** | Server Clock | Derived using date math from `new Date()`. |

---

## 3. Retraining Recommendations

The XGBoost model was trained on an external dataset that contained features our physical hardware simply does not produce (e.g., `sm_aux`). To make this production-ready, we face two options:

1.  **Modify the Backend (Engineering Heavy):** Update `server.js` to maintain a 7-day trailing average array in memory/JSON, and create a static dictionary mapping `soilType` strings to physical `clay/sand/silt` percentages.
2.  **Retrain the Model (Data Science Heavy):** Drop `sm_aux` entirely. If modifying the backend to hold 7-day lags is too complex, we would also need to drop the lag features and train a much simpler model that predicts solely based on `current_moisture`, `soil_type`, and `weather_forecast_data`.

*(Note: Per current instructions, no implementation changes or model retrainings have been executed yet).*
