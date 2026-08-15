import pandas as pd
import numpy as np
import os

def report_stats(stage_name, df):
    print(f"--- {stage_name} ---")
    print(f"Row count: {len(df)}")
    
    if 'latitude' in df.columns and 'longitude' in df.columns:
        locs = df[['latitude', 'longitude']].drop_duplicates()
        print(f"Unique locations: {len(locs)}")
    
    if 'time' in df.columns and 'latitude' in df.columns:
        dups = df.duplicated(subset=['time', 'latitude', 'longitude'], keep=False)
        print(f"Duplicate loc+date combinations: {dups.sum()}")
        num_unique = len(df[['time', 'latitude', 'longitude']].drop_duplicates())
        print(f"Unique loc+date combinations: {num_unique}")

    if 'sm_tgt' in df.columns:
        print(f"Missing target values (sm_tgt): {df['sm_tgt'].isna().sum()}")
    print("")

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    input_file = os.path.join(script_dir, '..', 'datasets', 'updated_data.csv')
    
    df = pd.read_csv(input_file)
    report_stats("1. Initial Load", df)

    # 3. Parse the time column as datetime
    df['time'] = pd.to_datetime(df['time'])

    # 4 & 5. Group data by unique location and create daily time index
    # Note: grouping by latitude and longitude, resample to daily frequency
    df.set_index('time', inplace=True)
    
    # We use asfreq() to insert NaN for missing dates
    df_resampled = df.groupby(['latitude', 'longitude']).resample('1D').asfreq()
    
    if 'latitude' in df_resampled.columns:
        df_resampled = df_resampled.drop(columns=['latitude', 'longitude'])
        
    df_resampled = df_resampled.reset_index()
    
    report_stats("2. Resampled to Daily Index", df_resampled)
    
    # 6. Assign Train/Val/Test split to prevent inter-split leakage
    conditions = [
        (df_resampled['time'] < '2013-10-01'),
        (df_resampled['time'] >= '2013-10-01') & (df_resampled['time'] < '2013-11-01'),
        (df_resampled['time'] >= '2013-11-01')
    ]
    df_resampled['split'] = np.select(conditions, ['train', 'val', 'test'], default='unknown')

    # Impute gaps up to 5 days
    print("Method for short gaps: Forward Fill (ffill) for dynamic variables (sm_tgt, sm_aux).")
    print("Why: Linear interpolation causes data leakage (uses future target T to fill T-1). ffill is strictly causal.\n")
    
    # Static features: forward and backward fill
    static_cols = ['clay_content', 'sand_content', 'silt_content']
    df_resampled[static_cols] = df_resampled.groupby(['latitude', 'longitude'])[static_cols].transform(lambda x: x.ffill().bfill())
    
    # Dynamic features: ffill limit 5 grouped by location AND split to prevent boundary leaks
    df_resampled['sm_tgt'] = df_resampled.groupby(['latitude', 'longitude', 'split'])['sm_tgt'].transform(lambda x: x.ffill(limit=5))
    if 'sm_aux' in df_resampled.columns:
        df_resampled['sm_aux'] = df_resampled.groupby(['latitude', 'longitude', 'split'])['sm_aux'].transform(lambda x: x.ffill(limit=5))
        
    report_stats("3. After Imputation (limit 5 days)", df_resampled)
    
    # Phase 2: Feature Engineering
    df_resampled['sm_tgt_lag1'] = df_resampled.groupby(['latitude', 'longitude'])['sm_tgt'].shift(1)
    df_resampled['sm_tgt_lag3'] = df_resampled.groupby(['latitude', 'longitude'])['sm_tgt'].shift(3)
    df_resampled['sm_tgt_lag7'] = df_resampled.groupby(['latitude', 'longitude'])['sm_tgt'].shift(7)
    
    df_resampled['sm_tgt_roll7_mean'] = df_resampled.groupby(['latitude', 'longitude'])['sm_tgt'].transform(
        lambda x: x.shift(1).rolling(window=7, min_periods=1).mean()
    )
    
    df_resampled['month'] = df_resampled['time'].dt.month
    df_resampled['day_of_year'] = df_resampled['time'].dt.dayofyear
    
    report_stats("4. After Feature Engineering", df_resampled)
    
    output_file = os.path.join(script_dir, '..', 'datasets', 'processed_soil_moisture.csv')
    df_resampled.to_csv(output_file, index=False)
    print(f"Saved processed dataset to {output_file}")

if __name__ == "__main__":
    main()
