import pandas as pd
import numpy as np
import time
import os
import json
import joblib
from sklearn.ensemble import RandomForestRegressor
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

    print("Dropping rows with NaN values...")
    features = [
        'clay_content', 'sand_content', 'silt_content', 'sm_aux', 
        'sm_tgt_lag1', 'sm_tgt_lag3', 'sm_tgt_lag7', 'sm_tgt_roll7_mean',
        'month', 'day_of_year'
    ]
    target = 'sm_tgt'
    
    # We must ensure no NaNs in features or target.
    df = df.dropna(subset=features + [target])

    print("Splitting data based on the 'split' column...")
    train_df = df[df['split'] == 'train']
    val_df = df[df['split'] == 'val']
    test_df = df[df['split'] == 'test']

    X_train, y_train = train_df[features], train_df[target]
    X_val, y_val = val_df[features], val_df[target]
    X_test, y_test = test_df[features], test_df[target]

    print(f"Train size: {len(X_train)}, Val size: {len(X_val)}, Test size: {len(X_test)}")

    results = {}

    # 1. Random Forest Regressor
    print("\nTraining Random Forest...")
    rf = RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42, n_jobs=-1)
    start_time = time.time()
    rf.fit(X_train, y_train)
    rf_train_time = time.time() - start_time

    rf_train_mae, rf_train_rmse, rf_train_r2 = evaluate_model(rf, X_train, y_train)
    rf_val_mae, rf_val_rmse, rf_val_r2 = evaluate_model(rf, X_val, y_val)
    rf_test_mae, rf_test_rmse, rf_test_r2 = evaluate_model(rf, X_test, y_test)

    results['Random Forest'] = {
        'Train Time (s)': rf_train_time,
        'Val MAE': rf_val_mae, 'Val RMSE': rf_val_rmse, 'Val R2': rf_val_r2,
        'Test MAE': rf_test_mae, 'Test RMSE': rf_test_rmse, 'Test R2': rf_test_r2,
        'Model': rf
    }

    # 2. XGBoost Regressor
    print("Training XGBoost...")
    xgb = XGBRegressor(n_estimators=100, max_depth=6, learning_rate=0.1, random_state=42, n_jobs=-1)
    start_time = time.time()
    # Note: early_stopping_rounds parameter has moved in newer xgboost versions to the constructor or fit method.
    # We will just train for 100 estimators to keep it simple and safe.
    xgb.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)
    xgb_train_time = time.time() - start_time

    xgb_train_mae, xgb_train_rmse, xgb_train_r2 = evaluate_model(xgb, X_train, y_train)
    xgb_val_mae, xgb_val_rmse, xgb_val_r2 = evaluate_model(xgb, X_val, y_val)
    xgb_test_mae, xgb_test_rmse, xgb_test_r2 = evaluate_model(xgb, X_test, y_test)

    results['XGBoost'] = {
        'Train Time (s)': xgb_train_time,
        'Val MAE': xgb_val_mae, 'Val RMSE': xgb_val_rmse, 'Val R2': xgb_val_r2,
        'Test MAE': xgb_test_mae, 'Test RMSE': xgb_test_rmse, 'Test R2': xgb_test_r2,
        'Model': xgb
    }

    # Print summary report
    for name, metrics in results.items():
        print(f"\n--- {name} ---")
        for k, v in metrics.items():
            if k != 'Model':
                print(f"{k}: {v:.6f}")

    # Best Model Selection based on Val MAE
    best_model_name = 'XGBoost' if results['XGBoost']['Val MAE'] <= results['Random Forest']['Val MAE'] else 'Random Forest'
    print(f"\nSelected Best Model: {best_model_name}")

    # Create models directory
    models_dir = os.path.join(script_dir, '..', 'models')
    os.makedirs(models_dir, exist_ok=True)

    # Save best model
    best_model = results[best_model_name]['Model']
    model_path = os.path.join(models_dir, 'soil_moisture_model.joblib')
    joblib.dump(best_model, model_path)
    
    # Save metadata
    metadata = {
        "model_type": best_model_name,
        "target": "sm_tgt",
        "features": features,
        "preprocessing_requirements": [
            "Resample to 1D continuous sequence",
            "Forward-fill missing values (limit=5)",
            "Generate lag features: sm_tgt_lag1, sm_tgt_lag3, sm_tgt_lag7",
            "Generate rolling feature: shift(1).rolling(7).mean() for sm_tgt",
            "Extract month and day_of_year from timestamp",
            "Drop rows with NaNs in features or target"
        ],
        "expected_input_format": "tabular array matching the exact feature order",
        "training_date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "validation_metrics": {
            "MAE": results[best_model_name]['Val MAE'],
            "RMSE": results[best_model_name]['Val RMSE'],
            "R2": results[best_model_name]['Val R2']
        },
        "test_metrics": {
            "MAE": results[best_model_name]['Test MAE'],
            "RMSE": results[best_model_name]['Test RMSE'],
            "R2": results[best_model_name]['Test R2']
        }
    }
    
    metadata_path = os.path.join(models_dir, 'model_metadata.json')
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=4)
        
    print(f"Saved model and metadata to {models_dir}")

if __name__ == "__main__":
    main()
