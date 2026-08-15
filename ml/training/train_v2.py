import pandas as pd
import numpy as np
import time
import os
import json
import joblib
from xgboost import XGBRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

def evaluate_model(model, X, y):
    preds = model.predict(X)
    mae = mean_absolute_error(y, preds)
    rmse = np.sqrt(mean_squared_error(y, preds))
    r2 = r2_score(y, preds)
    return mae, rmse, r2

def main():
    print("Loading processed data...")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    input_file = os.path.join(script_dir, '..', 'datasets', 'processed_soil_moisture.csv')
    df = pd.read_csv(input_file)

    # EXACT V2 FEATURES
    features = [
        'clay_content', 'sand_content', 'silt_content', 
        'sm_tgt_lag1', 'sm_tgt_lag3', 'sm_tgt_lag7', 'sm_tgt_roll7_mean',
        'month', 'day_of_year'
    ]
    target = 'sm_tgt'
    
    # We must ensure no NaNs in features or target.
    df = df.dropna(subset=features + [target])

    print("Splitting data based on the 'split' column chronologically...")
    train_df = df[df['split'] == 'train']
    val_df = df[df['split'] == 'val']
    test_df = df[df['split'] == 'test']

    X_train, y_train = train_df[features], train_df[target]
    X_val, y_val = val_df[features], val_df[target]
    X_test, y_test = test_df[features], test_df[target]

    print(f"Train size: {len(X_train)}, Val size: {len(X_val)}, Test size: {len(X_test)}")

    print("Training XGBoost V2 (Without sm_aux)...")
    xgb = XGBRegressor(n_estimators=100, max_depth=6, learning_rate=0.1, random_state=42, n_jobs=-1)
    start_time = time.time()
    xgb.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)
    xgb_train_time = time.time() - start_time

    xgb_train_mae, xgb_train_rmse, xgb_train_r2 = evaluate_model(xgb, X_train, y_train)
    xgb_val_mae, xgb_val_rmse, xgb_val_r2 = evaluate_model(xgb, X_val, y_val)
    xgb_test_mae, xgb_test_rmse, xgb_test_r2 = evaluate_model(xgb, X_test, y_test)

    print(f"\n--- XGBoost V2 ---")
    print(f"Train Time (s): {xgb_train_time:.6f}")
    print(f"Val MAE: {xgb_val_mae:.6f} | Val RMSE: {xgb_val_rmse:.6f} | Val R2: {xgb_val_r2:.6f}")
    print(f"Test MAE: {xgb_test_mae:.6f} | Test RMSE: {xgb_test_rmse:.6f} | Test R2: {xgb_test_r2:.6f}")

    models_dir = os.path.join(script_dir, '..', 'models')
    os.makedirs(models_dir, exist_ok=True)

    model_path = os.path.join(models_dir, 'soil_moisture_model_v2.joblib')
    joblib.dump(xgb, model_path)
    
    metadata = {
        "model_type": "XGBoost",
        "target": "sm_tgt",
        "features": features,
        "feature_meanings": {
            "clay_content": "Percentage of clay in soil (0-100)",
            "sand_content": "Percentage of sand in soil (0-100)",
            "silt_content": "Percentage of silt in soil (0-100)",
            "sm_tgt_lag1": "Target moisture average from 1 day prior",
            "sm_tgt_lag3": "Target moisture average from 3 days prior",
            "sm_tgt_lag7": "Target moisture average from 7 days prior",
            "sm_tgt_roll7_mean": "7-day rolling average of moisture strictly prior to current day",
            "month": "Month of the year (1-12)",
            "day_of_year": "Day of the year (1-365)"
        },
        "soil_composition_mapping_strategy": {
            "Loamy": {"clay_content": 20.0, "sand_content": 40.0, "silt_content": 40.0},
            "Clay": {"clay_content": 60.0, "sand_content": 20.0, "silt_content": 20.0},
            "Sandy": {"clay_content": 10.0, "sand_content": 80.0, "silt_content": 10.0}
        },
        "lag_definitions": "Daily averages computed at midnight. lag1 = yesterday's average.",
        "rolling_window_definition": "Mean of the previous 7 daily averages.",
        "train_validation_test_periods": {
            "Train": "January - September 2013",
            "Validation": "October 2013",
            "Test": "November - December 2013"
        },
        "training_date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "validation_metrics": {
            "MAE": xgb_val_mae,
            "RMSE": xgb_val_rmse,
            "R2": xgb_val_r2
        },
        "test_metrics": {
            "MAE": xgb_test_mae,
            "RMSE": xgb_test_rmse,
            "R2": xgb_test_r2
        }
    }
    
    metadata_path = os.path.join(models_dir, 'model_metadata_v2.json')
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=4)
        
    print(f"\nSaved model to {model_path}")
    print(f"Saved metadata to {metadata_path}")

if __name__ == "__main__":
    main()
