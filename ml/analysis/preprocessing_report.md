# Preprocessing Pipeline Report

## Stage 1: Initial Load
*   **Row count:** 321,584
*   **Unique locations:** 1,166
*   **Duplicate loc+date combinations:** 0
*   **Unique loc+date combinations:** 321,584
*   **Missing target values (`sm_tgt`):** 0

*Transformation Explanation:* 
The raw data `updated_data.csv` was loaded and the `time` column was parsed to datetime objects. The original dataset contains exactly 321,584 observations without any duplicate timestamp-location pairs or natively missing `sm_tgt` values.

## Stage 2: Resampled to Daily Index
*   **Row count:** 417,820
*   **Unique locations:** 1,166
*   **Duplicate loc+date combinations:** 0
*   **Unique loc+date combinations:** 417,820
*   **Missing target values (`sm_tgt`):** 96,236

*Transformation Explanation (Row Count Jump):* 
The row count increased from **321,584** to **417,820**. 
**Why this happened:** The original dataset had missing days (gaps in the timeline) for individual locations. When we grouped by `(latitude, longitude)` and resampled to a strict daily frequency (`1D`), pandas inserted rows to fill the missing days between the first and last recorded dates for each location. 
This introduced **96,236 new rows** containing missing (`NaN`) values for all features, which is absolutely required to make the time series contiguous for calculating valid time-based lags and rolling windows.
*(Note: It did not jump to ~496,000 because we only resampled within each location's specific min and max dates. If a full 1-year Cartesian product with all dates (1166 * 365) or cross-join with missing dates were forced without bounds, it might reach ~425k+, but our method correctly preserves the natural timeline length of each location).*

## Stage 3: After Imputation (limit 5 days)
*   **Row count:** 417,820
*   **Unique locations:** 1,166
*   **Duplicate loc+date combinations:** 0
*   **Unique loc+date combinations:** 417,820
*   **Missing target values (`sm_tgt`):** 19,544

*Transformation Explanation:*
To address the 96,236 missing target values without fabricating data across massive gaps, I applied a gap limit of **5 days**. 
*   **Method Chosen:** **Linear Interpolation** was selected for dynamic variables (`sm_tgt`, `sm_aux`). 
*   **Why:** Soil moisture typically depletes smoothly (evaporation) or spikes quickly (rain). Linear interpolation accurately represents gradual drying. Forward-fill would incorrectly hold moisture levels completely static, assuming zero evaporation over several days, which violates physical reality.
*   *Static features* (`clay_content`, `sand_content`, `silt_content`) were safely forward and backward-filled since they never change per location.
*   *Result:* We successfully imputed most gaps, reducing missing `sm_tgt` values from 96,236 to 19,544. The remaining 19,544 rows represent gaps longer than 5 days, which were intentionally left as `NaN` to prevent hallucinating data.

## Stage 4: After Feature Engineering
*   **Row count:** 417,820
*   **Unique locations:** 1,166
*   **Duplicate loc+date combinations:** 0
*   **Unique loc+date combinations:** 417,820
*   **Missing target values (`sm_tgt`):** 19,544

*Transformation Explanation:*
With a contiguous daily timeline, we successfully generated time-aware predictive features per location:
1.  **Lags:** `sm_tgt_lag1` (yesterday), `sm_tgt_lag3` (3 days ago), `sm_tgt_lag7` (1 week ago).
2.  **Rolling Statistics:** `sm_tgt_roll7_mean` (7-day rolling average of soil moisture to capture recent wet/dry trends).
3.  **Temporal:** `month`, `day_of_year` extracted from the timestamp to allow models to learn annual seasonality.

The final dataset was saved completely intact to `ml/datasets/processed_soil_moisture.csv`.
