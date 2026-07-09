# Sanjeevni-AI Web App

Fast Firebase-hosted replacement for the legacy Streamlit UI.

## Features

- Next.js, React, TypeScript, and Tailwind CSS
- Firebase Realtime Database listener for Raspberry Pi 5 sensor data
- Public browser-local OCR using Tesseract.js
- Responsive live-vitals dashboard
- Rule-based critical-threshold screening
- Optional secure prediction API integration
- Static export for Firebase Hosting

## Configure Firebase

1. In Firebase Console, open **Project settings > Your apps**.
2. Create or select a Web app and copy its configuration.
3. Copy `.env.example` to `.env.local`.
4. Fill the `NEXT_PUBLIC_FIREBASE_*` values.
5. Set `NEXT_PUBLIC_IOT_FIREBASE_PATH` to the path written by Raspberry Pi.

Current Raspberry Pi readings are available at `/devices/ai-power-structural-health-m-s/readings`. The frontend also supports this recommended payload format:

```json
{
  "patient_id": "P001",
  "device_id": "RPI5-001",
  "timestamp": "2026-06-12T20:30:00Z",
  "sensor_data": {
    "heart_rate": 78,
    "spo2": 98,
    "temperature": 36.8,
    "glucose": 110,
    "blood_pressure": {
      "systolic": 120,
      "diastolic": 80
    }
  }
}
```

The `database.rules.json` allows only `sharmamrakshat889@gmail.com` to read `/devices` and `/iot`, while blocking all browser writes. Raspberry Pi should write using Firebase Admin credentials, which bypass Realtime Database rules.

Do not deploy database rules without reviewing them. The normal frontend deployment only publishes Firebase Hosting and does not alter your existing database rules.

## Run Locally

```powershell
cd web-app
npm install
npm run dev
```

Open `http://localhost:3100`. The backend runs separately on `http://localhost:5100`.

## Deploy to Firebase Hosting

From the repository root:

```powershell
cd web-app
npm run build
cd ..
npx firebase-tools deploy --only hosting
```

## Prediction Accuracy

Firebase Hosting improves frontend speed, not model accuracy. For real disease prediction, deploy the validated Python models behind an authenticated HTTPS inference API and set:

```env
NEXT_PUBLIC_API_BASE_URL=https://your-secure-api.example
```

Never place model credentials or Firebase Admin service-account keys in frontend environment variables.

## Local Backend

From the repository root, run `start_backend.bat`. The Waitress API will be
available at `http://127.0.0.1:5100`. Training metrics are available at
`http://127.0.0.1:5100/training-metrics`.
