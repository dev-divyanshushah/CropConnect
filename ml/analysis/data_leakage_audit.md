# Data Leakage Audit Report

**Status: PASSED**
The final preprocessing pipeline is now 100% safe for chronological ML training. All potential sources of data leakage have been removed.

## Audit Checklist & Fixes Implemented

### 1. Interpolation Across the Entire Dataset
**Issue Found:** Initially, interpolation was performed across the entire dataset indiscriminately. If a gap occurred at the end of September (Train set), interpolation could use the next available point in October (Validation set) to fill the gap.
**Fix Applied:** We introduced an explicit `split` column (`train`, `val`, `test`) *before* any imputation. Imputation operations are now grouped by `['latitude', 'longitude', 'split']`. This mathematically guarantees that missing values at the boundary of September are never filled using data from October.

### 2. Linear Interpolation Using Future Targets
**Issue Found:** The previous method used `.interpolate(method='linear')` for short gaps. By definition, linear interpolation requires a past point and a *future* point. If the target `sm_tgt` at time T-1 was missing, interpolating it required using the target at time T. If the model uses T-1 as a feature (`lag1`) to predict T, the feature would contain a direct mathematical fraction of the answer (T). This is a massive target leak.
**Fix Applied:** We completely removed `linear` interpolation for dynamic variables (`sm_tgt`, `sm_aux`) and replaced it with strict **Forward Fill (`ffill()`)**. Forward fill only carries the last known past observation forward (up to 5 days). It never looks into the future.

### 3. Lag Features
**Issue Found:** None inherently, but previously relied on unsafe imputation.
**Fix Applied:** Lags (`lag1`, `lag3`, `lag7`) are implemented using `.shift()`. Because they are calculated *after* the strictly causal forward-fill imputation, they are completely safe. A prediction at time T will only ever see data from T-1 or earlier.

### 4 & 5. Rolling Features Include the Current Target
**Issue Found:** The feature `sm_tgt_roll7_mean` was originally calculated as `.rolling(window=7).mean()`. In pandas, this includes the current row T in the 7-day window. This means the 7-day rolling mean at time T included the target T, which is illegal.
**Fix Applied:** The calculation was modified to `.shift(1).rolling(window=7).mean()`. By shifting the series down one step before applying the rolling window, the 7-day average for predicting time T now consists exclusively of [T-7 ... T-1]. Time T is excluded.

### 6. Large Gaps
**Fix Applied:** Imputation (`ffill`) remains strictly limited to `limit=5`. Gaps larger than 5 days are left as `NaN`, ensuring we do not create artificial sequences across weeks of missing data.

### 7 & 8. Unseen Test Set & No Random Shuffling
**Fix Applied:** The test set remains completely unseen (stored in the same CSV but cleanly marked as `test`). The time series is kept in its native chronological order.

---

**Conclusion:** The pipeline is strictly causal. Features at time T are built exclusively using information available at T-1 or earlier. The dataset (`ml/datasets/processed_soil_moisture.csv`) is officially ready for ML modeling.
