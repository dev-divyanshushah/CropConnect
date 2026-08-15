# CropConnect ML Feature Plan & Architecture Audit

This document analyzes the gap between the existing ML dataset and the actual CropConnect system to define a practical, realistic feature set for a production-ready soil-moisture forecasting model.

## 1. Evaluation of Existing Dataset Compatibility

The currently processed dataset (`processed_soil_moisture.csv`) contains the following columns:
`time`, `clay_content`, `sand_content`, `silt_content`, `sm_aux`, `sm_tgt`

*   **Can it support our system?** Yes, but strictly as a subset.
*   **What is missing from the dataset?** The dataset entirely lacks local weather data (`temperature`, `rain_mm`) and `cropType`—all of which our backend *currently* tracks. Therefore, we cannot train a model to react to weather/crop types using this specific dataset. 
*   **What is missing from our system?** We do not have `sm_aux`.
*   **Conclusion:** The dataset *is* compatible for training a time-series structural model based purely on moisture history and soil type, provided we drop `sm_aux`.

## 2. Recommended Feature Plan

### A. Features We Should USE (Smallest Practical Set)
1.  **`sm_tgt_lag1`** (Moisture 1 day ago)
2.  **`sm_tgt_lag3`** (Moisture 3 days ago)
3.  **`sm_tgt_lag7`** (Moisture 7 days ago)
4.  **`sm_tgt_roll7_mean`** (7-day average moisture trend)
5.  **`clay_content`** (Static)
6.  **`sand_content`** (Static)
7.  **`silt_content`** (Static)
8.  **`month`** (Temporal)
9.  **`day_of_year`** (Temporal)

### B. Features We Should REMOVE
*   **`sm_aux`**: Absolutely must be removed. The CropConnect backend and ESP8266 hardware do not provide this satellite/precipitation index, and faking it ruins prediction integrity.

### C. Features We Need to Derive/Collect in Backend
To provide the features in section A, the Node.js backend must be explicitly modified to:
1.  **Map Soil Type:** Convert `farmSettings.soilType` (e.g., "Loamy", "Clay") into estimated percentages for `clay_content`, `sand_content`, and `silt_content` via a hardcoded dictionary.
2.  **Maintain Historical Lags:** The backend cannot just store current moisture. We must build a lightweight, in-memory queue per node that stores the daily average moisture for the last 7 days. This allows us to pass genuine lag values to the ML API.

### D. Model Status: Should we Discard/Retrain?
**YES.** The currently saved `soil_moisture_model.joblib` must be discarded. It was explicitly trained using `sm_aux` as a core structural node in its decision trees. XGBoost cannot function accurately in production if an entire required feature column is permanently missing or zeroed out. We must retrain the model exclusively on the feature set defined in Section A.

### E. Additional Data Needed Before Retraining
*   **For the immediate next step:** No new data is strictly required. We can retrain the model immediately using the existing `processed_soil_moisture.csv` by explicitly dropping the `sm_aux` column before training.
*   **For future v2.0 AI:** To make the model truly intelligent regarding *rain forecasts* and *temperature*, we would need to find a new dataset that actually pairs soil moisture time-series with historical weather data.

### F. Minimum Architecture for Real-Time Inference
To make this work seamlessly in production without inventing values:
1.  **Node.js Memory Queue:** A simple array `history: []` attached to each node object in `server.js` that updates its daily average at midnight.
2.  **Node.js Config Mapper:** A mapping function translating the frontend's soil type selection into physical percentages.
3.  **Retrained XGBoost API:** An updated FastAPI service that accepts a 9-feature payload (excluding `sm_aux`).
4.  **No MongoDB Reliance for Real-Time:** By keeping the 7-day queue in Node.js memory (and saving it to the JSON snapshot), we ensure predictions remain lightning-fast and don't break if the MongoDB connection drops.
