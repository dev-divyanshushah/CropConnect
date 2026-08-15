import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .schemas import PredictionRequest, PredictionResponse
from .model_loader import model_manager

app = FastAPI(title="CropConnect ML API", description="Soil Moisture Forecasting API")

# Configure CORS for future Node.js backend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health_check():
    if model_manager.model is None:
        raise HTTPException(status_code=500, detail="Model is not loaded")
    return {
        "status": "healthy",
        "model_loaded": True
    }

@app.post("/predict", response_model=PredictionResponse)
def predict(request: PredictionRequest):
    if model_manager.model is None:
        raise HTTPException(status_code=500, detail="Model is not loaded")
        
    try:
        # Convert request to dictionary
        req_dict = request.model_dump()
        
        # Order features exactly as expected by the model
        expected_features = model_manager.get_features_order()
        
        # Check for missing features
        missing = [f for f in expected_features if f not in req_dict]
        if missing:
            raise HTTPException(status_code=422, detail=f"Missing features required by the model: {missing}")

        # Construct input array in the correct order
        # Wrap in a pandas DataFrame to suppress XGBoost feature name warnings and guarantee structure
        input_df = pd.DataFrame([[req_dict[f] for f in expected_features]], columns=expected_features)
        
        prediction = model_manager.model.predict(input_df)[0]
        
        return PredictionResponse(
            predicted_soil_moisture=float(prediction),
            model=model_manager.metadata.get("model_type", "Unknown")
        )
    except ValueError as ve:
        raise HTTPException(status_code=422, detail=f"Invalid values: {str(ve)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")
