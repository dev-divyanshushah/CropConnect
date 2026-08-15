# Backend to ML API Integration (V2)

This document outlines how the existing Node.js CropConnect backend communicates with the standalone Python FastAPI ML service.

## 1. Node.js -> FastAPI Communication Architecture
The prediction flow works in the following sequence:
```
ESP8266 (Real-time Moisture) 
  ↓
Node.js (Sensor Validation & Storage)
  ↓
[PENDING NEXT PHASE] Historical Feature Cache (7-day Lags & Rolling Means)
  ↓
V2 ML API (`POST /predict`)
  ↓
XGBoost V2 Model
  ↓
Prediction merged into `/api/status`
```

*   **Environment Variable:** The backend relies on `ML_API_URL` defined in `.env` (defaults to `http://localhost:8000`).
*   **Timeout & Stability:** The `fetch` calls strictly use a short timeout (2-3 seconds). If the ML API hangs or is offline, Node.js catches the error and seamlessly falls back to the default rule-based logic without crashing the server event loop.

## 2. Request & Response Formats

### Request Format (`POST /predict`)
The V2 ML API requires exactly 9 features. `sm_aux` has been completely removed to align with actual hardware capabilities. The backend maps `farmSettings.soilType` to physical percentages (clay/sand/silt). 

**IMPORTANT:** The Node.js backend does NOT use placeholders. If the required historical lag features are unavailable in the Node.js memory state, the backend gracefully skips calling the ML API entirely. Historical feature collection is the **next implementation phase**.

```json
{
  "clay_content": 20.0,
  "sand_content": 40.0,
  "silt_content": 40.0,
  "sm_tgt_lag1": 0.28,
  "sm_tgt_lag3": 0.28,
  "sm_tgt_lag7": 0.28,
  "sm_tgt_roll7_mean": 0.28,
  "month": 8,
  "day_of_year": 227
}
```

### Response Format (`/api/status` Injection)
When the ML API provides a prediction (once history cache is implemented), the Node server embeds it directly into the existing `nodes` array response structure, ensuring the frontend's contract is unbroken. 

```json
{
  "node": 1,
  "master": 1,
  "moisture": 28,
  "status": "DRY",
  "irrigationOn": true,
  "ml": {
    "available": true,
    "predicted_soil_moisture": 0.316,
    "model": "XGBoost"
  }
}
```

## 3. Fallback Behavior
The entire architecture is decoupled. If the ML API goes down, or if the backend lacks the required historical features:
1.  Node.js logs a clear warning or identifies missing state.
2.  The `ml` block gracefully switches to `{ "available": false, "error": "..." }`.
3.  The core irrigation threshold logic (`moisture < 65`) continues independently, ensuring crops never die due to AI unavailability.

## 4. Local Startup Order
To run the full stack locally:
1.  **Start ML API:** `cd ml && python -m uvicorn api.main:app --host 0.0.0.0 --port 8000`
2.  **Start Node Backend:** `cd backend && npm run dev`
