# CropConnect ML API

This is the standalone Python ML inference API for the CropConnect soil-moisture forecasting model.

## Installation

Install the required dependencies from the `ml/` directory:
```bash
pip install -r requirements.txt
```

## Running the API

Start the FastAPI server using Uvicorn. Run this command from the `ml/` directory (where `api/` is located):

```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

## Endpoints

### 1. Health Check (`GET /health`)
Verifies that the API is running and the model has been loaded successfully.

**Test Command:**
```bash
curl http://127.0.0.1:8000/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "model_loaded": true
}
```

### 2. Predict Soil Moisture (`POST /predict`)
Generates a soil moisture forecast for the next day based on historical lags and static soil features.

**Expected Request Format:**
The API expects a JSON body matching the exact features the model was trained on:
```json
{
  "clay_content": 30.5,
  "sand_content": 45.2,
  "silt_content": 24.3,
  "sm_aux": 0.25,
  "sm_tgt_lag1": 0.26,
  "sm_tgt_lag3": 0.27,
  "sm_tgt_lag7": 0.30,
  "sm_tgt_roll7_mean": 0.28,
  "month": 6,
  "day_of_year": 150
}
```

**Test Command:**
```bash
curl -X POST http://127.0.0.1:8000/predict \
     -H "Content-Type: application/json" \
     -d '{"clay_content": 30.5, "sand_content": 45.2, "silt_content": 24.3, "sm_aux": 0.25, "sm_tgt_lag1": 0.26, "sm_tgt_lag3": 0.27, "sm_tgt_lag7": 0.30, "sm_tgt_roll7_mean": 0.28, "month": 6, "day_of_year": 150}'
```

**Expected Response Format:**
```json
{
  "predicted_soil_moisture": 0.257,
  "model": "XGBoost"
}
```
