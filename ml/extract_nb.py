import json
import os

filepath = r'c:\Users\Aditya Pathak\OneDrive\Desktop\clg iot 2sen]\ml\datasets\farm-yield-analysis-prediction-with-ml-models.ipynb'

with open(filepath, 'r', encoding='utf-8') as f:
    nb = json.load(f)

for i, cell in enumerate(nb.get('cells', [])):
    if cell['cell_type'] == 'code':
        source = ''.join(cell.get('source', []))
        print(f"--- Cell {i} ---")
        print(source[:500])
