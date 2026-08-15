import pandas as pd
import json

df = pd.read_csv('ml/datasets/Crop_recommendation.csv')

stats = {
    'num_rows': int(df.shape[0]),
    'num_cols': int(df.shape[1]),
    'columns': list(df.columns),
    'dtypes': {col: str(dtype) for col, dtype in df.dtypes.items()},
    'missing_values': df.isnull().sum().to_dict(),
    'duplicate_rows': int(df.duplicated().sum()),
    'numerical_stats': df.describe().to_dict(),
    'categorical_uniques': {col: df[col].unique().tolist() for col in df.select_dtypes(include=['object']).columns},
    'target_distribution': df['label'].value_counts().to_dict() if 'label' in df.columns else {}
}

with open('ml/analysis_results.json', 'w') as f:
    json.dump(stats, f, indent=4)
print("Analysis complete.")
