# Soil Moisture Dataset Analysis & ML Plan

## 1. Dataset Overview
We analyzed the newly selected `ml/datasets/updated_data.csv`.

**Basic Statistics:**
*   **Rows**: 321,584
*   **Columns**: 8 (`time`, `latitude`, `longitude`, `clay_content`, `sand_content`, `silt_content`, `sm_aux`, `sm_tgt`)
*   **Data Types**: `time` is correctly parsed as `datetime64`. All other columns are `float64`.
*   **Missing Values**: 0 explicitly missing (no NaNs in the CSV).
*   **Duplicates**: 0 duplicate rows.
*   **Unique Locations**: 1,166 unique locations (derived from unique Latitude/Longitude pairs).
*   **Outliers/Abnormal Values**: `sm_aux` has a minimum value of -0.038 (which might be an artifact if it represents moisture/precipitation, but could be valid if it's a normalized index). `sm_tgt` ranges properly from 0.01 to 0.60.

## 2. Time-Series Structure Analysis
*   **Time Formatting**: The `time` column is correctly formatted as a standard timestamp.
*   **Time Range**: Exactly one year, from `2013-01-01` to `2013-12-31`.
*   **Sampling Frequency**: The most common difference between timestamps is **1 day** (Daily frequency).
*   **Evenly Spaced & Gaps**: The time series is **NOT evenly spaced**. There are significant gaps in the timeline for individual locations.
*   **Observations per Location**: On average, a location has ~258 days of data out of the 365 days in the year.
*   **Insufficient Data**: Because a full year has 365 days, missing ~100 days per location means there are frequent gaps. This is the most critical issue we must address during preprocessing.

## 3. Feature Analysis
*   `time`: The chronological index (daily). Can be used to engineer seasonal features (e.g., month, day of year).
*   `latitude`, `longitude`: Spatial coordinates. These uniquely identify the 1,166 different spatial grids/farms.
*   `clay_content`, `sand_content`, `silt_content`: Static soil physical properties (sum to ~100%). These dictate water retention capacity.
*   `sm_aux`: An auxiliary time-varying feature (e.g., satellite observation, precipitation index, or temperature proxy).
*   `sm_tgt`: **The Primary Target Variable**. This represents the actual ground-truth soil moisture we want to predict.

## 4. Predicting Future Soil Moisture
**Features for Prediction:**
To predict future `sm_tgt`, we should use:
1.  **Historical Lags**: Past values of `sm_tgt` (e.g., yesterday's moisture, last week's moisture).
2.  **Historical Drivers**: Past values of `sm_aux`.
3.  **Static Properties**: `clay_content`, `sand_content`, `silt_content` (since clay retains water much longer than sand).
4.  **Spatial Context**: `latitude`, `longitude`.
5.  **Temporal Context**: `month`, `day_of_year` (captures seasonality).

**Chronological Splitting (Crucial to prevent data leakage):**
Because we cannot look into the future, we **must not randomly shuffle** the rows. The split must be time-based across all locations simultaneously.
*   *Train*: Jan 1, 2013 → Sep 30, 2013
*   *Validation*: Oct 1, 2013 → Oct 31, 2013
*   *Test*: Nov 1, 2013 → Dec 31, 2013

## 5. Forecasting Setup
Given the **daily** sampling frequency, a reasonable sequence length (lookback window) is **7 to 14 days**.
*   **Mechanism**: We feed the model the last 7 days of data `[T-7, T-6, ..., T-1, T]`.
*   **Prediction**: The model outputs the predicted soil moisture for tomorrow `[T+1]`.

## 6. Model Suitability Evaluation
*   **LSTM / GRU**: Highly suitable for finding complex patterns in time-series sequences. **However**, RNNs require perfectly sequential, unbroken time steps. Because our dataset has missing days (gaps), we *must* mathematically impute the missing days before passing data to an LSTM/GRU.
*   **XGBoost / Gradient Boosting**: Extremely suitable as a robust baseline. By manually engineering lag features (e.g., `sm_tgt_lag_1`, `sm_tgt_lag_7`), XGBoost can often outperform Deep Learning on tabular data and is highly interpretable. XGBoost can also natively handle `NaN` values if we align the dates with gaps.
*   **Random Forest Baseline**: A great starting point for regression, similar to XGBoost but usually less prone to overfitting on smaller subsets.

## 7. Proposed Preprocessing & Training Plan

Based on the findings, here is the exact step-by-step plan to execute when training is approved:

### Phase 1: Data Cleaning & Imputation
1.  **Group and Sort**: Group data by `(latitude, longitude)` and strictly sort by `time`.
2.  **Resample to Daily Grid**: Force a continuous daily index (`1D`) for every location from Jan 1 to Dec 31. This will expose the missing days as `NaN` rows.
3.  **Imputation**: 
    *   *Static features* (`clay`, `sand`, `silt`, `lat`, `lon`): Forward-fill.
    *   *Dynamic features* (`sm_aux`, `sm_tgt`): Use linear interpolation (time-based) up to a maximum gap limit (e.g., 5 days). If a gap is larger than 5 days, we break the sequence to prevent hallucinating too much data.

### Phase 2: Feature Engineering
1.  **Temporal**: Extract `Month` and `DayOfYear` from `time` and encode them cyclically (sine/cosine) to capture annual seasonality.
2.  **Lags (If using XGBoost/RF)**: Create shifted columns for `sm_tgt` and `sm_aux` for delays of 1, 2, 3, and 7 days.
3.  **Scaling**: Apply `StandardScaler` to all continuous features. Fit the scaler **only** on the Training split to prevent data leakage.

### Phase 3: Sequence Generation & Modeling
1.  **Chronological Split**: Split into Train/Val/Test based on the specific cutoff dates mentioned above.
2.  **Baseline Modeling**: Train an XGBoost model using the engineered lag features.
3.  *(Optional/Future)* **Deep Learning**: Create sliding windows of shape `(batch, 7_days, num_features)` and train an LSTM/GRU.
4.  **Evaluation**: Evaluate using Root Mean Squared Error (RMSE) and Mean Absolute Error (MAE) on the held-out Test set.
