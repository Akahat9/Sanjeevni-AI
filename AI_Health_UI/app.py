"""Main AI Health backend API.

The frontend lives in web-app/. This service owns validated model inference and
server-side Firebase access. It intentionally never returns a dummy diagnosis.
"""

from __future__ import annotations

import logging
import math
import os
import hmac
import json
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from collections import defaultdict, deque
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from threading import Lock, Thread
from typing import Any  
from uuid import uuid4


def use_project_venv() -> None:
    """Relaunch local Windows commands with the project's working venv."""
    if os.name != "nt" or os.getenv("AI_HEALTH_SKIP_VENV_RELAUNCH") == "1":
        return
    venv_python = Path(__file__).resolve().parent.parent / "venv" / "Scripts" / "python.exe"
    if not venv_python.exists():
        return
    if Path(sys.executable).resolve() == venv_python.resolve():
        return
    os.execv(str(venv_python), [str(venv_python), *sys.argv])


use_project_venv()

from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR.parent / ".env")
MODELS_DIR = BASE_DIR / "models"
IOT_PATH = os.getenv(
    "IOT_FIREBASE_PATH", "devices/ai-power-structural-health-m-s/readings"
).strip("/")
DEVICE_ROOT_PATH = IOT_PATH.rsplit("/", 1)[0]
DIAGNOSTIC_REQUESTS_PATH = f"{DEVICE_ROOT_PATH}/diagnostic_requests"
DIAGNOSTIC_RESULTS_PATH = f"{DEVICE_ROOT_PATH}/diagnostic_results"
MAX_JSON_BYTES = int(os.getenv("MAX_JSON_BYTES", "65536"))
PREDICTION_RATE_LIMIT = int(os.getenv("PREDICTION_RATE_LIMIT", "30"))
RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
NVIDIA_BASE_URL = os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1").rstrip("/")
NVIDIA_MODEL = os.getenv("NVIDIA_MODEL", "z-ai/glm-5.2")
NVIDIA_FALLBACK_MODELS = [
    model.strip()
    for model in os.getenv(
        "NVIDIA_FALLBACK_MODELS",
        "meta/llama-3.1-8b-instruct,nvidia/nemotron-mini-4b-instruct",
    ).split(",")
    if model.strip()
]
NVIDIA_TIMEOUT_SECONDS = int(os.getenv("NVIDIA_TIMEOUT_SECONDS", "8"))

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("ai-health-api")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_JSON_BYTES
CORS(
    app,
    resources={
        r"/*": {
            "origins": [
                value.strip()
                for value in os.getenv(
                    "ALLOWED_ORIGINS",
                    "https://ai-power-structural-health-m-s.web.app,"
                    "http://localhost:3100,http://127.0.0.1:3100",
                ).split(",")
                if value.strip()
            ]
        }
    },
)

FEATURES = {
    "heart": [
        "age", "sex", "cp", "trestbps", "chol", "fbs", "restecg",
        "thalach", "exang", "oldpeak", "slope", "ca", "thal",
    ],
    "diabetes": [
        "HighBP", "HighChol", "CholCheck", "BMI", "Smoker", "Stroke",
        "HeartDiseaseorAttack", "PhysActivity", "HvyAlcoholConsump",
        "AnyHealthcare", "NoDocbcCost", "GenHlth", "MentHlth", "Sex",
        "Age", "Income",
    ],
    "liver": [
        "Age", "Gender", "Total_Bilirubin", "Direct_Bilirubin",
        "Alkaline_Phosphotase", "Alamine_Aminotransferase",
        "Aspartate_Aminotransferase", "Total_Protiens", "Albumin",
        "Albumin_and_Globulin_Ratio",
    ],
    "blood": [
        "Age", "Gender", "Blood Type", "Medical Condition",
        "Billing Amount", "Diabetes_Label",
    ],
}

MODEL_CONFIG = {
    "heart": {"model": "heart_model_pipeline.pkl", "pipeline": True, "enabled": True},
    "diabetes": {
        "model": "diabetes_model_pipeline.pkl",
        "pipeline": True,
        "enabled": True,
    },
    "liver": {
        "model": "liver_model_pipeline.pkl",
        "pipeline": True,
        "enabled": True,
    },
    "blood": {
        "model": "blood_model.pkl",
        "imputer": "blood_imputer.pkl",
        "scaler": "blood_scaler.pkl",
        "enabled": False,
        "reason": "Artifact is not a blood-vitals model; it was trained from report metadata.",
    },
}

_model_cache: dict[str, dict[str, Any]] = {}
_model_lock = Lock()
_firestore_client = None
_realtime_root = None
_request_times: dict[str, deque[float]] = defaultdict(deque)
_rate_limit_lock = Lock()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def supplied_api_key_is_valid() -> bool:
    expected = os.getenv("API_KEY", "").strip()
    supplied = request.headers.get("X-API-Key", "")
    return bool(expected and supplied and hmac.compare_digest(supplied, expected))


def require_api_key(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        expected = os.getenv("API_KEY", "").strip()
        if not expected:
            return jsonify({"error": "Protected API is not configured"}), 503
        if not supplied_api_key_is_valid():
            return jsonify({"error": "Unauthorized"}), 401
        return view(*args, **kwargs)

    return wrapped


def require_local_or_api_key(view):
    """Allow localhost UI calls; require API key if the backend becomes public."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        if request.remote_addr in {"127.0.0.1", "::1"}:
            return view(*args, **kwargs)
        if supplied_api_key_is_valid():
            return view(*args, **kwargs)
        return jsonify({"error": "Diagnostic requests require local access or a valid API key"}), 401

    return wrapped


def rate_limit(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        client = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown")
        client = client.split(",", 1)[0].strip()
        key = f"{client}:{request.endpoint}"
        now = time.monotonic()
        with _rate_limit_lock:
            timestamps = _request_times[key]
            while timestamps and now - timestamps[0] >= RATE_LIMIT_WINDOW_SECONDS:
                timestamps.popleft()
            if len(timestamps) >= PREDICTION_RATE_LIMIT:
                return jsonify({"error": "Rate limit exceeded. Try again shortly."}), 429
            timestamps.append(now)
        return view(*args, **kwargs)

    return wrapped


def model_status(disease: str) -> dict[str, Any]:
    config = MODEL_CONFIG[disease]
    files = {
        key: MODELS_DIR / name
        for key, name in config.items()
        if key not in {"pipeline", "enabled", "reason"}
    }
    missing = [path.name for path in files.values() if not path.exists() or path.stat().st_size == 0]
    enabled = bool(config.get("enabled", True))
    return {
        "disease": disease,
        "ready": enabled and not missing,
        "enabled": enabled,
        "reason": config.get("reason"),
        "features": FEATURES[disease],
        "files": {key: path.name for key, path in files.items()},
        "missing_or_empty": missing,
        "loaded": disease in _model_cache,
    }


def load_model_bundle(disease: str) -> dict[str, Any]:
    import joblib

    status = model_status(disease)
    if not status["enabled"]:
        raise RuntimeError(status["reason"])
    if not status["ready"]:
        raise RuntimeError(f"Model artifacts unavailable: {', '.join(status['missing_or_empty'])}")
    with _model_lock:
        if disease in _model_cache:
            return _model_cache[disease]
        config = MODEL_CONFIG[disease]
        bundle = {
            "model": joblib.load(MODELS_DIR / config["model"]),
            "pipeline": bool(config.get("pipeline")),
        }
        for artifact in ("imputer", "scaler"):
            if artifact in config:
                bundle[artifact] = joblib.load(MODELS_DIR / config[artifact])
        _model_cache[disease] = bundle
        logger.info("Loaded %s inference artifacts", disease)
        return bundle


def validate_features(disease: str, payload: Any) -> Any:
    import pandas as pd

    if not isinstance(payload, dict):
        raise ValueError("'features' must be a JSON object")
    expected = FEATURES[disease]
    missing = [field for field in expected if field not in payload]
    unexpected = [field for field in payload if field not in expected]
    if missing:
        raise ValueError(f"Missing fields: {', '.join(missing)}")
    if unexpected:
        raise ValueError(f"Unexpected fields: {', '.join(unexpected)}")
    clean = {}
    for field in expected:
        try:
            value = float(payload[field])
        except (TypeError, ValueError) as exc:
            raise ValueError(f"'{field}' must be numeric") from exc
        if not math.isfinite(value):
            raise ValueError(f"'{field}' must be finite")
        clean[field] = value
    return pd.DataFrame([clean], columns=expected)


def run_prediction(disease: str, feature_payload: dict[str, Any]) -> dict[str, Any]:
    import numpy as np

    frame = validate_features(disease, feature_payload)
    bundle = load_model_bundle(disease)
    model = bundle["model"]
    model_input: Any = frame if bundle["pipeline"] else frame.to_numpy(dtype=float)
    if not bundle["pipeline"]:
        if bundle.get("imputer") is not None:
            model_input = bundle["imputer"].transform(model_input)
        if bundle.get("scaler") is not None:
            model_input = bundle["scaler"].transform(model_input)
    prediction = model.predict(model_input)[0]
    probabilities = None
    confidence = None
    if hasattr(model, "predict_proba"):
        probabilities = [float(value) for value in model.predict_proba(model_input)[0]]
        confidence = max(probabilities)
    return {
        "disease": disease,
        "prediction": int(prediction) if isinstance(prediction, (int, np.integer)) else str(prediction),
        "confidence": confidence,
        "probabilities": probabilities,
        "model_file": MODEL_CONFIG[disease]["model"],
        "model_is_dummy": False,
        "generated_at": utc_now(),
    }


def init_firebase() -> bool:
    global _firestore_client, _realtime_root
    try:
        import firebase_admin
        from firebase_admin import credentials, db as realtime_db, firestore
    except ImportError:
        return False
    if _firestore_client is not None or _realtime_root is not None:
        return True
    credential_path = os.getenv("FIREBASE_JSON_PATH", "").strip()
    if not credential_path or not Path(credential_path).exists():
        logger.warning("Firebase disabled: set FIREBASE_JSON_PATH")
        return False
    try:
        if not firebase_admin._apps:
            firebase_admin.initialize_app(
                credentials.Certificate(credential_path),
                {
                    "databaseURL": os.getenv(
                        "FIREBASE_RTD_URL",
                        "https://ai-power-structural-health-m-s-default-rtdb.firebaseio.com",
                    )
                },
            )
        _firestore_client = firestore.client()
        _realtime_root = realtime_db.reference("/")
        return True
    except Exception:
        logger.exception("Firebase initialization failed")
        return False


def latest_child(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    if {"readings", "sensor_data", "heart_rate", "temperature", "spo2"}.intersection(value):
        return value
    children = [(key, child) for key, child in value.items() if isinstance(child, dict)]
    if not children:
        return value
    return max(
        children,
        key=lambda item: str(item[1].get("timestamp") or item[1].get("recorded_at") or item[0]),
    )[1]


@app.get("/")
def index():
    return jsonify(
        {
            "service": "ai-health-api",
            "status": "running",
            "message": "This port serves the backend API. Open the frontend URL for the app.",
            "frontend_local": os.getenv("FRONTEND_URL", "http://localhost:3100"),
            "frontend_public": "https://ai-power-structural-health-m-s.web.app",
            "api": {
                "health": "/api/v1/health",
                "models": "/api/v1/models",
                "training_metrics": "/api/v1/training-metrics",
                "prediction": "/api/v1/predict/<disease>",
            },
        }
    )


@app.get("/health")
@app.get("/api/v1/health")
def health():
    statuses = {name: model_status(name) for name in MODEL_CONFIG}
    enabled_statuses = [item for item in statuses.values() if item["enabled"]]
    return jsonify(
        {
            "status": "healthy" if all(item["ready"] for item in enabled_statuses) else "degraded",
            "service": "ai-health-api",
            "models": statuses,
            "firebase_configured": bool(os.getenv("FIREBASE_JSON_PATH")),
            "timestamp": utc_now(),
        }
    )


@app.get("/models")
@app.get("/api/v1/models")
def models():
    return jsonify({name: model_status(name) for name in MODEL_CONFIG})


@app.get("/training-metrics")
@app.get("/api/v1/training-metrics")
def training_metrics():
    metrics_path = MODELS_DIR / "training_metrics.json"
    if not metrics_path.exists():
        return jsonify({"error": "Training metrics are unavailable"}), 404
    return app.response_class(metrics_path.read_text(encoding="utf-8"), mimetype="application/json")


@app.post("/predict/<disease>")
@app.post("/api/v1/predict/<disease>")
@rate_limit
def predict(disease: str):
    disease = disease.lower()
    if disease not in MODEL_CONFIG:
        return jsonify({"error": "Unsupported disease", "supported": sorted(MODEL_CONFIG)}), 404
    status = model_status(disease)
    if not status["enabled"]:
        return jsonify({"error": "Model disabled by audit", "detail": status["reason"]}), 503
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "A JSON object is required"}), 400
    try:
        result = run_prediction(disease, body.get("features"))
    except ValueError as exc:
        return jsonify({"error": str(exc), "required_features": FEATURES[disease]}), 400
    except Exception:
        logger.exception("Prediction failed for %s", disease)
        return jsonify({"error": "Prediction unavailable"}), 503
    if body.get("patient_id"):
        result["patient_id"] = str(body["patient_id"])
    if body.get("save") is True:
        if not supplied_api_key_is_valid():
            return jsonify({"error": "A valid API key is required to save predictions"}), 401
        if init_firebase() and _firestore_client is not None:
            _firestore_client.collection("predictions").add({**result, "features": body["features"]})
            result["saved"] = True
        else:
            return jsonify({"error": "Firebase is not configured for the backend"}), 503
    else:
        result["saved"] = False
    return jsonify(result)


@app.post("/doctor/chat")
@app.post("/api/v1/doctor/chat")
@rate_limit
def doctor_chat():
    """Proxy AI Doctor requests without exposing the NVIDIA key to browsers."""
    nvidia_api_key = os.getenv("NVIDIA_API_KEY", "").strip()
    if not nvidia_api_key:
        return jsonify({"error": "AI Doctor is not configured"}), 503

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "A JSON object is required"}), 400
    message = str(body.get("message", "")).strip()
    if not message or len(message) > 12000:
        return jsonify({"error": "Message must contain 1 to 12000 characters"}), 400

    emergency_terms = (
        "chest pain", "can't breathe", "cannot breathe", "unconscious",
        "severe bleeding", "suicide", "overdose", "stroke symptoms",
    )
    if any(term in message.lower() for term in emergency_terms):
        return jsonify(
            {
                "answer": (
                    "This may be an emergency. Contact your local emergency service now "
                    "or go to the nearest emergency department. Do not rely on this chat."
                ),
                "emergency": True,
                "model": "local-safety-rule",
            }
        )

    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": (
                "You are Sanjeevni-AI Doctor, an educational health assistant. "
                "Reply in the user's language (Hindi, Hinglish, or English) using clear, "
                "calm language. Explain health reports and general wellness information. "
                "Never claim to diagnose, prescribe, change medication, or replace a "
                "qualified clinician. Clearly state uncertainty and recommend professional "
                "review for abnormal or persistent symptoms. Do not invent reference ranges "
                "or citations. End with a brief educational-use disclaimer."
            ),
        }
    ]
    history = body.get("history", [])
    if isinstance(history, list):
        for item in history[-8:]:
            if not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}:
                continue
            content = str(item.get("content", "")).strip()[:2000]
            if content:
                messages.append({"role": item["role"], "content": content})
    messages.append({"role": "user", "content": message})

    models_to_try = list(dict.fromkeys([NVIDIA_MODEL, *NVIDIA_FALLBACK_MODELS]))
    last_error = "AI Doctor provider did not return a usable response."
    try:
        for model_name in models_to_try:
            provider_payload = json.dumps(
                {
                    "model": model_name,
                    "messages": messages,
                    "temperature": 0.2,
                    "top_p": 0.9,
                    "max_tokens": 1000,
                    "stream": False,
                }
            ).encode("utf-8")
            provider_request = urllib.request.Request(
                f"{NVIDIA_BASE_URL}/chat/completions",
                data=provider_payload,
                headers={
                    "Authorization": f"Bearer {nvidia_api_key}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(
                    provider_request, timeout=NVIDIA_TIMEOUT_SECONDS
                ) as provider_response:
                    provider_data = json.loads(provider_response.read().decode("utf-8"))
                answer = provider_data["choices"][0]["message"]["content"].strip()
                if not answer:
                    raise ValueError("Provider returned an empty answer")
                return jsonify(
                    {
                        "answer": answer,
                        "emergency": False,
                        "model": model_name,
                        "fallback_used": model_name != NVIDIA_MODEL,
                        "disclaimer": "Educational guidance only; not a medical diagnosis.",
                    }
                )
            except urllib.error.HTTPError as exc:
                provider_messages = {
                    401: "NVIDIA API key is invalid or revoked. Generate a new key and restart the backend.",
                    403: f"This NVIDIA API key does not have access to {model_name}.",
                    404: f"The configured NVIDIA model is unavailable: {model_name}.",
                    429: "NVIDIA API rate limit or trial quota has been reached. Try again shortly.",
                    503: f"NVIDIA model is temporarily overloaded: {model_name}.",
                }
                try:
                    provider_body = exc.read().decode("utf-8", "replace")[:500]
                except Exception:
                    provider_body = ""
                last_error = provider_messages.get(
                    exc.code, f"NVIDIA API returned HTTP {exc.code} for {model_name}."
                )
                logger.warning(
                    "NVIDIA model %s returned HTTP %s: %s",
                    model_name,
                    exc.code,
                    provider_body,
                )
                if exc.code in {401, 429}:
                    status = 429 if exc.code == 429 else 502
                    return jsonify({"error": last_error, "provider_status": exc.code}), status
                continue
            except (urllib.error.URLError, TimeoutError) as exc:
                last_error = f"NVIDIA model timed out or could not be reached: {model_name}."
                logger.warning("%s %s", last_error, exc)
                continue
            except (KeyError, ValueError, json.JSONDecodeError) as exc:
                last_error = f"NVIDIA model returned an unreadable response: {model_name}."
                logger.warning("%s %s", last_error, exc)
                continue
        return jsonify({"error": last_error, "tried_models": models_to_try}), 502
    except urllib.error.HTTPError as exc:
        provider_messages = {
            401: "NVIDIA API key is invalid or revoked. Generate a new key and restart the backend.",
            403: "This NVIDIA API key does not have access to GLM-5.2.",
            404: "The configured NVIDIA model is unavailable. Verify NVIDIA_MODEL=z-ai/glm-5.2.",
            429: "NVIDIA API rate limit or trial quota has been reached. Try again shortly.",
        }
        message = provider_messages.get(
            exc.code, f"NVIDIA API returned an unexpected HTTP {exc.code} response."
        )
        logger.warning("NVIDIA API returned HTTP %s", exc.code)
        status = 429 if exc.code == 429 else 502
        return jsonify({"error": message, "provider_status": exc.code}), status
    except (urllib.error.URLError, TimeoutError, KeyError, ValueError, json.JSONDecodeError):
        logger.exception("AI Doctor request failed")
        return jsonify({"error": "AI Doctor could not generate a response"}), 502


@app.post("/diagnostics/request")
@app.post("/api/v1/diagnostics/request")
@rate_limit
@require_local_or_api_key
def create_diagnostic_request():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "A JSON object is required"}), 400
    required = ("name", "age", "blood_group", "weight_kg", "test_type")
    missing = [field for field in required if not str(body.get(field, "")).strip()]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400
    if body.get("consent") is not True:
        return jsonify({"error": "Patient consent is required"}), 400
    try:
        age = int(body["age"])
        weight = float(body["weight_kg"])
        height = float(body["height_cm"]) if body.get("height_cm") else None
        if not 1 <= age <= 120 or not 2 <= weight <= 400:
            raise ValueError
        if height is not None and not 30 <= height <= 250:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "Age, weight, or height is outside the supported range"}), 400
    if not init_firebase() or _realtime_root is None:
        return jsonify(
            {
                "error": (
                    "Firebase Admin is not configured. Set FIREBASE_JSON_PATH to the "
                    "service-account JSON used by the hardware project."
                )
            }
        ), 503

    request_id = uuid4().hex
    record = {
        "request_id": request_id,
        "status": "pending",
        "requested_at": utc_now(),
        "device_id": str(body.get("device_id") or "Biomedical_Monitor_RPi5")[:100],
        "patient": {
            "name": str(body["name"]).strip()[:120],
            "age": age,
            "gender": str(body.get("gender") or "Not specified")[:40],
            "blood_group": str(body["blood_group"]).strip()[:10],
            "weight_kg": weight,
            "height_cm": height,
        },
        "test_type": str(body["test_type"]).strip()[:80],
        "notes": str(body.get("notes") or "").strip()[:500],
        "consent": True,
    }
    try:
        _realtime_root.child(DIAGNOSTIC_REQUESTS_PATH).child(request_id).set(record)
        return jsonify(
            {
                "request_id": request_id,
                "status": "pending",
                "firebase_path": f"/{DIAGNOSTIC_REQUESTS_PATH}/{request_id}",
            }
        ), 202
    except Exception:
        logger.exception("Could not create diagnostic request")
        return jsonify({"error": "Could not send diagnostic request to Firebase"}), 502


@app.get("/diagnostics/<request_id>")
@app.get("/api/v1/diagnostics/<request_id>")
@require_local_or_api_key
def diagnostic_status(request_id: str):
    if not request_id.isalnum() or len(request_id) > 64:
        return jsonify({"error": "Invalid diagnostic request ID"}), 400
    if not init_firebase() or _realtime_root is None:
        return jsonify({"error": "Firebase Admin is not configured"}), 503
    try:
        request_record = _realtime_root.child(DIAGNOSTIC_REQUESTS_PATH).child(request_id).get()
        if not request_record:
            return jsonify({"error": "Diagnostic request not found"}), 404
        result = _realtime_root.child(DIAGNOSTIC_RESULTS_PATH).child(request_id).get()
        status = "completed" if result else str(request_record.get("status") or "pending")
        return jsonify({"request_id": request_id, "status": status, "request": request_record, "result": result})
    except Exception:
        logger.exception("Could not read diagnostic status")
        return jsonify({"error": "Could not read diagnostic result from Firebase"}), 502


@app.get("/iot/latest")
@app.get("/api/v1/iot/latest")
@require_api_key
def iot_latest():
    if not init_firebase() or _realtime_root is None:
        return jsonify({"error": "Firebase is not configured for the backend"}), 503
    path = request.args.get("path", IOT_PATH).strip("/")
    if not path.startswith(("devices/", "iot/")):
        return jsonify({"error": "Only devices/ and iot/ paths are allowed"}), 400
    try:
        payload = latest_child(_realtime_root.child(path).get())
        if not payload:
            return jsonify({"error": "No readings found", "path": path}), 404
        return jsonify({"path": path, "reading": payload})
    except Exception:
        logger.exception("Could not read IoT path %s", path)
        return jsonify({"error": "Could not read Firebase data"}), 502


@app.errorhandler(413)
def payload_too_large(_error):
    return jsonify({"error": f"Request exceeds {MAX_JSON_BYTES} bytes"}), 413


@app.errorhandler(404)
def not_found(_error):
    return jsonify({"error": "Endpoint not found"}), 404


@app.after_request
def security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    response.headers["Cache-Control"] = "no-store"
    if request.is_secure:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


def start_frontend() -> subprocess.Popen:
    """Start the Next.js UI when this file is used as the local entrypoint."""
    project_dir = BASE_DIR.parent
    frontend_dir = project_dir / "web-app"
    package_json = frontend_dir / "package.json"
    if not package_json.exists():
        raise RuntimeError(f"Frontend was not found at {frontend_dir}")

    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        raise RuntimeError("Node.js/npm is required to start the frontend")

    if not (frontend_dir / "node_modules").exists():
        logger.info("Installing frontend dependencies (first run only)...")
        subprocess.run([npm, "install"], cwd=frontend_dir, check=True)

    frontend_port = int(os.getenv("FRONTEND_PORT", "3100"))
    backend_port = int(os.getenv("PORT", os.getenv("FLASK_PORT", "5100")))
    env = os.environ.copy()
    env["PORT"] = str(frontend_port)
    env.setdefault("NEXT_PUBLIC_API_BASE_URL", f"http://127.0.0.1:{backend_port}")

    command = [npm, "run", "dev", "--", "-p", str(frontend_port)]
    process_options: dict[str, Any] = {"cwd": frontend_dir, "env": env}
    if os.name == "nt":
        process_options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        process_options["start_new_session"] = True
    logger.info("Starting frontend at http://localhost:%s", frontend_port)
    return subprocess.Popen(command, **process_options)


def stop_frontend(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    logger.info("Stopping frontend...")
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                check=False,
                capture_output=True,
            )
        else:
            os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        process.kill()


def open_frontend_when_ready(process: subprocess.Popen, url: str) -> None:
    """Open the browser after Next.js is accepting connections."""
    for _ in range(60):
        if process.poll() is not None:
            logger.error("Frontend exited before it became ready (code %s)", process.returncode)
            return
        try:
            with urllib.request.urlopen(url, timeout=1):
                webbrowser.open(url)
                return
        except Exception:
            time.sleep(1)
    logger.warning("Frontend did not become ready at %s within 60 seconds", url)


if __name__ == "__main__":
    from waitress import serve

    frontend_process = None
    try:
        if os.getenv("AI_HEALTH_BACKEND_ONLY") != "1":
            frontend_process = start_frontend()
            frontend_url = f"http://localhost:{int(os.getenv('FRONTEND_PORT', '3100'))}"
            if os.getenv("AI_HEALTH_OPEN_BROWSER", "1") == "1":
                Thread(
                    target=open_frontend_when_ready,
                    args=(frontend_process, frontend_url),
                    daemon=True,
                ).start()

        backend_port = int(os.getenv("PORT", os.getenv("FLASK_PORT", "5100")))
        logger.info("Starting backend API at http://localhost:%s", backend_port)
        logger.info("Press Ctrl+C to stop the frontend and backend")
        serve(
            app,
            host=os.getenv("FLASK_HOST", "127.0.0.1"),
            port=backend_port,
            threads=int(os.getenv("WAITRESS_THREADS", "4")),
        )
    except KeyboardInterrupt:
        logger.info("Local server stopped")
    except Exception as exc:
        logger.error("Startup failed: %s", exc)
        raise
    finally:
        if frontend_process is not None:
            stop_frontend(frontend_process)
