import app as backend


def test_root_explains_backend_and_frontend_urls():
    response = backend.app.test_client().get("/")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "running"
    assert data["frontend_local"] == "http://localhost:3100"
    assert data["api"]["health"] == "/api/v1/health"


def test_health_reports_models_without_loading_them():
    client = backend.app.test_client()
    response = client.get("/health")
    assert response.status_code == 200
    data = response.get_json()
    assert data["service"] == "ai-health-api"
    assert set(data["models"]) == {"heart", "diabetes", "liver", "blood"}
    assert data["status"] == "healthy"
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_audit_disabled_model_does_not_predict():
    client = backend.app.test_client()
    response = client.post("/predict/blood", json={"features": {"WBC": 6}})
    assert response.status_code == 503
    assert response.get_json()["error"] == "Model disabled by audit"


def test_prediction_rejects_unknown_model():
    client = backend.app.test_client()
    response = client.post("/predict/unknown", json={"features": {}})
    assert response.status_code == 404


def test_enabled_models_are_ready():
    client = backend.app.test_client()
    models = client.get("/models").get_json()
    assert models["heart"]["ready"] is True
    assert models["diabetes"]["ready"] is True
    assert models["liver"]["ready"] is True
    assert models["blood"]["enabled"] is False


def test_training_metrics_are_available():
    response = backend.app.test_client().get("/training-metrics")
    assert response.status_code == 200
    assert set(response.get_json()) == {"heart", "diabetes", "liver"}


def test_iot_rejects_unapproved_path_before_firebase_read(monkeypatch):
    monkeypatch.setenv("API_KEY", "test-key")
    monkeypatch.setattr(backend, "init_firebase", lambda: True)
    monkeypatch.setattr(backend, "_realtime_root", object())
    client = backend.app.test_client()
    response = client.get(
        "/iot/latest?path=private/secrets", headers={"X-API-Key": "test-key"}
    )
    assert response.status_code == 400


def test_iot_requires_configured_api_key(monkeypatch):
    monkeypatch.delenv("API_KEY", raising=False)
    response = backend.app.test_client().get("/api/v1/iot/latest")
    assert response.status_code == 503


def test_versioned_routes_are_available():
    client = backend.app.test_client()
    assert client.get("/api/v1/health").status_code == 200
    assert client.get("/api/v1/models").status_code == 200
    assert client.get("/api/v1/training-metrics").status_code == 200


def test_ai_doctor_requires_server_side_nvidia_key(monkeypatch):
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    response = backend.app.test_client().post(
        "/api/v1/doctor/chat", json={"message": "Explain blood pressure"}
    )
    assert response.status_code == 503
    assert response.get_json()["error"] == "AI Doctor is not configured"


def test_ai_doctor_emergency_rule_does_not_call_provider(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "test-only-key")
    response = backend.app.test_client().post(
        "/api/v1/doctor/chat", json={"message": "I have severe chest pain"}
    )
    assert response.status_code == 200
    assert response.get_json()["emergency"] is True
    assert response.get_json()["model"] == "local-safety-rule"
