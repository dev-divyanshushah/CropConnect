import pandas as pd
import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import joblib
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

print("Loading test dataset...")
test_df = pd.read_csv('../datasets/test_set.csv')
scaler = joblib.load('../models/scaler.pkl')

features = [
    'latitude', 'longitude', 'clay_content', 'sand_content', 'silt_content',
    'month', 'day_of_year', 'doy_sin', 'doy_cos',
    'sm_tgt_lag_1', 'sm_tgt_lag_2', 'sm_tgt_lag_3', 'sm_tgt_lag_7',
    'sm_aux_lag_1', 'sm_aux_lag_2', 'sm_aux_lag_3', 'sm_aux_lag_7'
]
target = 'sm_tgt'

X_test, y_test = test_df[features], test_df[target]
X_test_scaled = scaler.transform(X_test)

results = {}

# Evaluate Random Forest
print("Evaluating RF...")
if os.path.exists('../models/rf_model.pkl'):
    rf = joblib.load('../models/rf_model.pkl')
    y_pred_rf = rf.predict(X_test_scaled)
    results['Random Forest'] = {
        'MAE': mean_absolute_error(y_test, y_pred_rf),
        'RMSE': np.sqrt(mean_squared_error(y_test, y_pred_rf)),
        'R2': r2_score(y_test, y_pred_rf)
    }

# Evaluate XGBoost
print("Evaluating XGBoost...")
if os.path.exists('../models/xgb_model.pkl'):
    xgb = joblib.load('../models/xgb_model.pkl')
    y_pred_xgb = xgb.predict(X_test_scaled)
    results['XGBoost'] = {
        'MAE': mean_absolute_error(y_test, y_pred_xgb),
        'RMSE': np.sqrt(mean_squared_error(y_test, y_pred_xgb)),
        'R2': r2_score(y_test, y_pred_xgb)
    }

# Evaluate LSTM
print("Evaluating LSTM...")
if os.path.exists('../models/lstm_model.h5'):
    try:
        from tensorflow.keras.models import load_model
        lstm = load_model('../models/lstm_model.h5')
        X_test_lstm = X_test_scaled.reshape((X_test_scaled.shape[0], 1, X_test_scaled.shape[1]))
        y_pred_lstm = lstm.predict(X_test_lstm).flatten()
        results['LSTM'] = {
            'MAE': mean_absolute_error(y_test, y_pred_lstm),
            'RMSE': np.sqrt(mean_squared_error(y_test, y_pred_lstm)),
            'R2': r2_score(y_test, y_pred_lstm)
        }
    except Exception as e:
        print(f"Skipping LSTM evaluation: {e}")

# Determine the best model
best_model_name = max(results.keys(), key=lambda k: results[k]['R2'])

report = f"""# Model Comparison Report

This report compares the models trained on the soil moisture forecasting task.

## Data & Preprocessing Summary
- **Dataset**: `updated_data.csv`
- **Imputation Method**: Linear Interpolation (chosen because it preserves dataset size compared to dropping gaps, and is more realistic for continuous moisture than forward-fill).
- **Target**: `sm_tgt` (Soil Moisture)
- **Features Used**: {', '.join(features)}
- **Scaling**: StandardScaler (fitted exclusively on the training set to prevent data leakage).
- **Chronological Split**: 
  - Train: Jan 1 - Sep 30
  - Validation: Oct 1 - Oct 31
  - Test: Nov 1 - Dec 31
  - *No random shuffling was used.*

## Evaluation Metrics (on Test Set)

| Model | MAE | RMSE | R² |
| :--- | :--- | :--- | :--- |
"""

for model_name, metrics in results.items():
    report += f"| {model_name} | {metrics['MAE']:.4f} | {metrics['RMSE']:.4f} | {metrics['R2']:.4f} |\n"

report += f"""
## Conclusion & Winning Model

Based on the evaluation on the strictly chronological unseen test set:

**The winning model is: {best_model_name}**

*   **Why it performed best**: {best_model_name} achieved the highest R² score ({results[best_model_name]['R2']:.4f}) and the lowest RMSE ({results[best_model_name]['RMSE']:.4f}). Tree-based models like XGBoost and Random Forest often outperform simple deep learning architectures on tabular data with explicitly engineered lag features. While LSTM can natively handle sequences, a basic LSTM network typically requires significantly more tuning and data reshaping to outperform a tuned gradient boosting tree.
*   **Model Save Path**: `ml/models/{'xgb_model.pkl' if best_model_name == 'XGBoost' else 'rf_model.pkl' if best_model_name == 'Random Forest' else 'lstm_model.h5'}`
*   **Required Inputs**: The final model expects a scaled array of 17 features containing the spatial coordinates, time encodings (Month, DayOfYear sin/cos), static soil contents, and the 1, 2, 3, and 7-day lags of both `sm_tgt` and `sm_aux`.

"""

# Write model metadata
import json
metadata = {
    'best_model': best_model_name,
    'input_features': features,
    'target': target,
    'preprocessing': 'Linear Interpolation + StandardScaler',
    'sequence_lags': [1, 2, 3, 7],
    'evaluation_metrics': results[best_model_name]
}

with open('../models/model_metadata.json', 'w') as f:
    json.dump(metadata, f, indent=4)

with open('../analysis/model_comparison.md', 'w', encoding='utf-8') as f:
    f.write(report)

print("Evaluation complete. Report generated at ml/analysis/model_comparison.md")
