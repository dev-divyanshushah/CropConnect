from pydantic import BaseModel, Field

class PredictionRequest(BaseModel):
    clay_content: float = Field(..., description="Clay content of soil")
    sand_content: float = Field(..., description="Sand content of soil")
    silt_content: float = Field(..., description="Silt content of soil")
    sm_tgt_lag1: float = Field(..., description="Soil moisture 1 day ago")
    sm_tgt_lag3: float = Field(..., description="Soil moisture 3 days ago")
    sm_tgt_lag7: float = Field(..., description="Soil moisture 7 days ago")
    sm_tgt_roll7_mean: float = Field(..., description="7 day rolling mean of soil moisture")
    month: int = Field(..., description="Month of year (1-12)", ge=1, le=12)
    day_of_year: int = Field(..., description="Day of year (1-366)", ge=1, le=366)

class PredictionResponse(BaseModel):
    predicted_soil_moisture: float
    model: str
