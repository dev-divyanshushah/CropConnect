import requests
import json
import time
import sys

url = "http://127.0.0.1:8000"

def test_api():
    print(f"Testing API at {url}...")
    
    # Wait a moment for server to start if we just launched it
    time.sleep(2)
    
    # 1. Test Health Check
    try:
        health_res = requests.get(f"{url}/health")
        print("\n--- Health Check ---")
        print(f"Status Code: {health_res.status_code}")
        print("Response:", json.dumps(health_res.json(), indent=2))
    except Exception as e:
        print(f"Failed to connect to health endpoint: {e}")
        sys.exit(1)

    # 2. Test Predict
    payload = {
        "clay_content": 30.5,
        "sand_content": 45.2,
        "silt_content": 24.3,
        "sm_tgt_lag1": 0.26,
        "sm_tgt_lag3": 0.27,
        "sm_tgt_lag7": 0.30,
        "sm_tgt_roll7_mean": 0.28,
        "month": 6,
        "day_of_year": 150
    }
    
    print("\n--- Predict Request ---")
    print(f"POST {url}/predict")
    print("Payload:", json.dumps(payload, indent=2))
    
    try:
        predict_res = requests.post(f"{url}/predict", json=payload)
        print("\n--- Predict Response ---")
        print(f"Status Code: {predict_res.status_code}")
        print("Response:", json.dumps(predict_res.json(), indent=2))
    except Exception as e:
        print(f"Failed to connect to predict endpoint: {e}")

if __name__ == "__main__":
    test_api()
