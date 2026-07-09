# Backend, Dataset, and Model Audit

## Runtime Decision

`app.py` is now the main Flask inference API. The old Streamlit application is
preserved as `legacy_streamlit_app.py` and is not used by the deployed frontend.

## Model Status

| Model | Status | Audit result |
|---|---|---|
| Heart | Enabled | Retrained audited pipeline with 13 expected features. |
| Diabetes | Enabled for screening | Retrained without target leakage using 16 survey features. Moderate performance means clinician validation is still required. |
| Liver | Enabled for screening | Retrained using all 10 mapped liver features. Very high internal metrics require independent external validation. |
| Blood | Disabled | Removed because the old artifact expected report metadata and was not a blood-vitals model. |
| Report detector | Not served by diagnosis API | Predicts `Test Results` from structured report metadata; it is not an OCR text classifier. |

## Dataset Findings

- `Diabetes.csv` contains both `Diabetes_012` and `Diabetes_binary`. Related
  labels must never be used as features for one another.
- `Diabetes.csv` has 250,000 rows and 81,101 duplicate rows. The corrected
  trainer removes duplicates before splitting.
- `heart_dataset.csv` matches the heart model's 13-feature contract.
- `heart_dataset.csv` has 1,000 rows with a 580/420 class split.
- Liver dataset uses verbose column names and Latin-1 encoding. The trainer now
  maps those names to the intended clinical features.
- Liver dataset has 30,691 rows, 11,323 duplicate rows, and a 21,917/8,774
  class split.
- Report detector dataset contains only 100 records, which is too small for a
  dependable medical classifier.
- No valid blood-vitals training dataset was found.
- Dataset provenance, licensing, patient consent, and clinical validation are
  not documented.

## Artifact Findings

- Zero-byte artifacts exist: `diabetes_model_keras.h5`,
  `heart_model_keras.h5`, `liver_model_keras.h5`, and `imputer.pkl`.
- Existing sklearn artifacts were created with sklearn 1.7.2. Runtime should use
  the same version until all models are retrained.
- Large pickle files should be treated as trusted build artifacts only. Never
  load user-uploaded pickle/joblib files.

## Backend Findings Fixed

- Removed dummy healthy predictions.
- Added strict required-field and numeric validation.
- Added model readiness and audit status endpoints.
- Added request-size limit and optional API-key protection.
- Direct `python app.py` now runs through Waitress instead of Flask's development server.
- Selected pipelines compare logistic regression and histogram gradient boosting
  using macro F1; detailed results are saved in `models/training_metrics.json`.
- Restricted CORS to configured frontend origins.
- Firebase credentials are environment-only in the main backend.
- Added protected Firebase latest-reading endpoint.

## Required Before Medical Use

- Retrain diabetes and liver models with corrected scripts.
- Obtain a real blood-vitals dataset and create a dedicated trainer.
- Add sensitivity, specificity, recall, calibration, subgroup, and external
  validation reports.
- Rotate the Firebase service-account key currently present in the workspace.
- Add authenticated backend authorization using Firebase ID-token verification.
- Have all medical outputs reviewed by qualified clinicians.
