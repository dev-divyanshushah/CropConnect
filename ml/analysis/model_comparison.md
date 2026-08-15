# Soil Moisture Forecasting: Model Comparison Report

This document details the evaluation of multiple machine learning models on the strictly causal `processed_soil_moisture.csv` dataset. The goal is to forecast future soil moisture levels (`sm_tgt`) using chronologically constrained training data.

## 1. Feature Set & Splitting Strategy
**Features Used:**
- Target lags: `sm_tgt_lag1`, `sm_tgt_lag3`, `sm_tgt_lag7`
- Rolling stats: `sm_tgt_roll7_mean`
- Soil constants: `clay_content`, `sand_content`, `silt_content`
- Auxiliary data: `sm_aux`
- Time embeddings: `month`, `day_of_year`

**Chronological Split:**
- **Train:** Jan - Sep 2013 (283,527 samples)
- **Validation:** Oct 2013 (34,024 samples)
- **Test:** Nov - Dec 2013 (57,055 samples)

---

## 2. Model Performance

### Baseline: Random Forest Regressor
*   **Training Approach:** 100 trees, max depth of 10 to prevent overfitting. Fits natively on the tabular dataset.
*   **Training Time:** ~10.0 seconds
*   **Validation Metrics:**
    *   MAE: 0.0388
    *   RMSE: 0.0552
    *   R²: 0.6447
*   **Test Metrics:**
    *   MAE: 0.0441
    *   RMSE: 0.0612
    *   R²: 0.5805
*   **Strengths:** Very robust to outliers; requires almost no tuning.
*   **Weaknesses:** Large model size (memory intensive), slower inference compared to gradient boosting.

### Primary Advanced Tabular: XGBoost Regressor
*   **Training Approach:** Gradient boosted decision trees (100 estimators, depth 6, learning rate 0.1). Evaluated against the validation set during training.
*   **Training Time:** ~1.3 seconds
*   **Validation Metrics:**
    *   MAE: 0.0381
    *   RMSE: 0.0547
    *   R²: 0.6505
*   **Test Metrics:**
    *   MAE: 0.0438
    *   RMSE: 0.0608
    *   R²: 0.5865
*   **Strengths:** Faster to train and infer, lighter memory footprint, naturally handles non-linear interactions in time-series tabular formats. Better metrics across the board.
*   **Weaknesses:** Susceptible to slight overfitting if depth/estimators are unbounded (mitigated by explicit hyperparameters).

### Why LSTM Was Not Evaluated
An LSTM (Long Short-Term Memory) network was intentionally skipped. Deep learning sequences require perfectly unbroken continuous timelines or masked zero-padding. Because our dataset has thousands of >5-day gaps (which we purposefully left as `NaN` to prevent hallucinating data), forcing this into a 3D tensor `(batch, time_steps, features)` would require either dropping a massive percentage of valid locations or aggressively zero-padding the data. Both destroy the signal-to-noise ratio. Tabular models like XGBoost handle these discrete structural gaps natively when expressed as engineered lags. Therefore, forcing an LSTM here is structurally inappropriate for the available data.

---

## 3. Final Recommendation & Selection

**Selected Model: XGBoost Regressor**

**Justification:**
XGBoost slightly beat Random Forest across all validation and test metrics (e.g. Validation MAE 0.0381 vs 0.0388) while training almost 10 times faster (~1.3s vs ~10.0s). 
More importantly, XGBoost is vastly superior for deployment on the CropConnect cloud architecture. The final model is highly compressed and operates extremely fast during inference, saving memory overhead when eventually integrated alongside the backend or as a lightweight API microservice.

**Artifacts Saved:**
1.  **Production Model:** `ml/models/soil_moisture_model.joblib`
2.  **Metadata File:** `ml/models/model_metadata.json` (Includes full feature array ordering and preprocessing requirements needed for reproduction during deployment).
