# 🌾 CropConnect – Smart Irrigation System

A simple Smart Irrigation dashboard for 4 soil moisture sensor nodes across 2 ESP8266 masters.

---

## 📁 Project Structure

```
CROPCONNECT/
├── backend/
│   ├── server.js       ← The server (cloud/API)
│   ├── package.json    ← Node.js dependencies list
│   └── .env            ← Your secret settings (API keys etc.)
└── frontend/
    ├── index.html      ← The website dashboard
    ├── style.css       ← Visual styles
    └── app.js          ← Website logic (polls the backend)
```

---

## 🚀 How to Run (Step by Step)

### Step 1 – Install Node.js
Download and install Node.js from: https://nodejs.org (choose the LTS version)

### Step 2 – Install dependencies
Open a terminal/command prompt inside the `backend/` folder and run:
```
npm install
```

### Step 3 – Set up your settings
Edit the `backend/.env` file and fill in your details:
```
OPENWEATHER_API_KEY=your_key_here    ← Get a free key from openweathermap.org
CITY=Delhi                           ← Your city
STATE=Delhi                          ← Your state
MOISTURE_THRESHOLD=40                ← Soil moisture % below which irrigation starts
MOCK_MODE=true                       ← Use fake data for testing (change to false for real hardware)
PORT=3000
```

### Step 4 – Start the backend server
Inside the `backend/` folder, run:
```
node server.js
```
You should see: `✅ CropConnect server running on http://localhost:3000`

### Step 5 – Open the website
Open `frontend/index.html` in your web browser (just double-click the file).

---

## 🔄 Mock Mode vs Real Mode

| Setting | What it does |
|---------|-------------|
| `MOCK_MODE=true` | Uses fake sensor values (for testing without hardware) |
| `MOCK_MODE=false` | Waits for real data from ESP8266 masters |

---

## 📡 ESP8266 API (for the hardware team)

When real hardware is ready, each ESP8266 master sends data like this:

**Endpoint:** `POST http://YOUR-SERVER-IP:3000/api/sensor-data`

**Data format (JSON):**
```json
{
  "master": 1,
  "node": 1,
  "moisture": 32
}
```

---

## 🌐 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sensor-data` | POST | ESP8266 masters send moisture readings here |
| `/api/status` | GET | Website fetches all node statuses from here |
| `/api/weather` | GET | Website fetches weather forecast from here |

---

## ❓ Troubleshooting

- **Website shows "Cannot connect to server"** → Make sure `node server.js` is running
- **Weather shows "Unavailable"** → Check your `OPENWEATHER_API_KEY` in `.env`
- **No sensor data** → Make sure `MOCK_MODE=true` for testing
