import os
import json
import joblib

class ModelManager:
    def __init__(self):
        self.model = None
        self.metadata = None
        self._load()

    def _load(self):
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        model_path = os.path.join(base_dir, 'models', 'soil_moisture_model_v2.joblib')
        meta_path = os.path.join(base_dir, 'models', 'model_metadata_v2.json')

        try:
            with open(meta_path, 'r') as f:
                self.metadata = json.load(f)
            self.model = joblib.load(model_path)
            print(f"Loaded model successfully: {self.metadata.get('model_type')}")
        except Exception as e:
            print(f"Error loading model: {e}")
            raise e

    def get_features_order(self):
        return self.metadata.get("features", [])

model_manager = ModelManager()
