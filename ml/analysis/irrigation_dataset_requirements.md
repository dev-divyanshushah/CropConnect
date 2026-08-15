# Irrigation ML Dataset Requirements

This document outlines the exact data requirements needed to build an intelligent Machine Learning model for the CropConnect system, given the available real-world inputs (soil moisture, temperature, humidity, rain/weather information, crop type, soil type, growth stage, and timestamps).

Our ultimate goal is to support **intelligent irrigation decisions** (e.g., turning valves ON or OFF dynamically based on need, rather than a hardcoded `< 65%` rule).

Below is a comparison of the two primary ML approaches we can take, and the corresponding dataset requirements.

---

## Approach 1: Irrigation ON/OFF Classification

In this approach, the ML model acts as an "expert farmer." It looks at the current environmental conditions and simply outputs a binary decision: **Turn Irrigation ON** or **Leave Irrigation OFF**.

*   **Required Target Column**: `valve_status` or `irrigation_action` (Categorical/Binary: ON / OFF)
*   **Required Features**: 
    *   `soil_moisture` (%)
    *   `temperature` (°C)
    *   `humidity` (%)
    *   `rainfall` (mm or boolean forecast)
    *   `crop_type` (Categorical)
    *   `soil_type` (Categorical)
    *   `growth_stage` (Categorical)
*   **Advantages**:
    *   Extremely simple to integrate. The backend simply passes current conditions to the model and receives a direct ON/OFF command to execute.
    *   Directly mimics human/expert behavior if trained on a high-quality dataset of human-managed irrigation.
*   **Disadvantages**:
    *   "Black Box" decision-making. If the model says "OFF" when the soil is bone dry, it's hard to understand *why*.
    *   Highly dependent on the expertise of the human who generated the training data. If the dataset contains poor irrigation practices, the model will copy them.
*   **Suitability for our project**: Moderate. It's the easiest to implement from an engineering standpoint, but finding a high-quality dataset of expert, timestamped human irrigation decisions across various crops is notoriously difficult.
*   **Type of Dataset to Search For**: An agricultural IoT dataset containing historical sensor logs paired with records of when the irrigation pumps were turned on and off.

---

## Approach 2: Soil Moisture Forecasting (Regression)

In this approach, the ML model predicts the physics of the soil. It looks at the current conditions and predicts **what the soil moisture will be in the near future** (e.g., 6 hours or 24 hours from now).

*   **Required Target Column**: `future_soil_moisture` (Continuous/Float: e.g., moisture % after $X$ hours)
*   **Required Features**:
    *   `timestamp` (Date/Time to capture diurnal cycles)
    *   `current_soil_moisture` (%)
    *   `temperature` (°C)
    *   `humidity` (%)
    *   `expected_rainfall` (mm - crucial for forecasting)
    *   `crop_type` / `growth_stage` (Categorical - impacts transpiration rate)
    *   `soil_type` (Categorical - impacts water retention)
*   **Advantages**:
    *   Much more robust and transparent. The system's logic remains visible (e.g., `if predicted_moisture_6h < threshold AND no_rain_expected: turn_ON()`).
    *   Can prevent over-watering by anticipating rain. If moisture is low *now*, but heavy rain is expected in 3 hours, the model will predict a high future moisture, and the system can safely keep the valve OFF.
    *   Easier to find datasets for. We just need continuous IoT sensor logs; we don't necessarily need logs of human pump interactions.
*   **Disadvantages**:
    *   Slightly more complex to train (requires Time-Series forecasting techniques like LSTMs, ARIMA, or sliding-window XGBoost).
    *   Requires the backend to handle the final logic threshold (the ML model only provides the moisture prediction, not the final valve command).
*   **Suitability for our project**: High. This perfectly aligns with CropConnect's architecture (we already have a weather API for forecasting) and represents a significant upgrade over a simple rule-based threshold.
*   **Type of Dataset to Search For**: A continuous time-series agricultural/IoT dataset logging hourly/daily soil moisture alongside weather conditions.

---

## Precise Dataset Search Specification

To find a dataset that works for either of these approaches, you can use the following search criteria on Kaggle, Google Dataset Search, or UCI Machine Learning Repository.

### Search Keywords
*   "Smart Irrigation Dataset IoT"
*   "Soil Moisture Time Series Dataset"
*   "Agricultural Sensor Data Moisture"
*   "Precision Agriculture IoT Weather"

### Mandatory Dataset Requirements
Do **NOT** download datasets that only contain soil nutrients (N, P, K) or static yearly crop yields. We need a dataset that meets the following criteria:

1.  **Format**: Tabular Time-Series (CSV)
2.  **Granularity**: Hourly or Daily readings (Not seasonal/yearly).
3.  **Must Contain**:
    *   `Soil Moisture` (Target for Approach 2 / Feature for Approach 1)
    *   `Temperature`
    *   `Humidity`
4.  **Highly Desirable**:
    *   `Irrigation / Pump Status` (Mandatory if we want Approach 1)
    *   `Rainfall`
    *   `Crop Type`
    *   `Soil Type`

### Example of an Ideal Row
| Timestamp | Temp (°C) | Humidity (%) | Rainfall (mm) | Soil Type | Crop | Current Moisture (%) | Pump_Status (ON/OFF) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 2023-05-12 14:00 | 28.5 | 45.2 | 0.0 | Loamy | Wheat | **42.5** | **ON** |
