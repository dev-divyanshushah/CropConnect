import pandas as pd
import numpy as np
import json

df = pd.read_csv('ml/datasets/updated_data.csv')

# Parse time
# Assuming time might be a string, let's convert to datetime
df['time'] = pd.to_datetime(df['time'], errors='coerce')

# Basic stats
stats = {
    'rows': len(df),
    'cols': len(df.columns),
    'columns': list(df.columns),
    'dtypes': {str(k): str(v) for k, v in df.dtypes.items()},
    'missing': df.isna().sum().to_dict(),
    'duplicates': int(df.duplicated().sum()),
}

# Locations
if 'latitude' in df.columns and 'longitude' in df.columns:
    df['location'] = df['latitude'].astype(str) + '_' + df['longitude'].astype(str)
    locations = df['location'].unique()
    stats['unique_locations'] = len(locations)
    
    # Time series per location analysis
    loc_stats = {}
    time_gaps = []
    frequencies = []
    
    for loc in locations[:100]: # Just sample if there are too many
        loc_df = df[df['location'] == loc].sort_values('time')
        if len(loc_df) > 1:
            diffs = loc_df['time'].diff().dropna()
            freq = diffs.mode().iloc[0] if not diffs.empty else pd.Timedelta(seconds=0)
            frequencies.append(freq)
            # Find gaps (diffs > freq)
            gaps = diffs[diffs > freq]
            time_gaps.append(len(gaps))
            loc_stats[str(loc)] = {'count': len(loc_df)}
            
    stats['time_range'] = [str(df['time'].min()), str(df['time'].max())]
    if frequencies:
        common_freq = pd.Series(frequencies).mode().iloc[0]
        stats['sampling_frequency'] = str(common_freq)
        stats['evenly_spaced'] = all(g == 0 for g in time_gaps)
        stats['max_gaps_in_a_loc'] = max(time_gaps) if time_gaps else 0
    stats['observations_per_location_mean'] = np.mean([v['count'] for v in loc_stats.values()]) if loc_stats else 0
else:
    stats['unique_locations'] = 0

# Feature stats
features = ['time', 'latitude', 'longitude', 'clay_content', 'sand_content', 'silt_content', 'sm_aux', 'sm_tgt']
feat_stats = {}
for f in features:
    if f in df.columns and pd.api.types.is_numeric_dtype(df[f]):
        feat_stats[f] = {
            'mean': float(df[f].mean()),
            'min': float(df[f].min()),
            'max': float(df[f].max()),
            'std': float(df[f].std())
        }

stats['feature_stats'] = feat_stats

with open('ml/updated_analysis.json', 'w') as f:
    json.dump(stats, f, indent=4)
print("Analysis complete.")
