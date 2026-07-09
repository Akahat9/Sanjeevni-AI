"""Train audited tabular pipelines and select the best candidate by macro F1."""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
DATASETS = ROOT / "Datasets"
MODELS = Path(__file__).resolve().parent / "models"
MODELS.mkdir(exist_ok=True)
RANDOM_STATE = 42


def candidates():
    return {
        "logistic_regression": Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("classifier", LogisticRegression(max_iter=1500, class_weight="balanced", random_state=RANDOM_STATE)),
        ]),
        "hist_gradient_boosting": Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("classifier", HistGradientBoostingClassifier(
                max_iter=180, learning_rate=0.08, max_leaf_nodes=31,
                class_weight="balanced", random_state=RANDOM_STATE,
            )),
        ]),
    }


def metrics(model, x_test, y_test):
    prediction = model.predict(x_test)
    probability = model.predict_proba(x_test)[:, 1]
    return {
        "accuracy": float(accuracy_score(y_test, prediction)),
        "precision": float(precision_score(y_test, prediction, zero_division=0)),
        "recall": float(recall_score(y_test, prediction, zero_division=0)),
        "macro_f1": float(f1_score(y_test, prediction, average="macro")),
        "roc_auc": float(roc_auc_score(y_test, probability)),
    }


def train(name: str, frame: pd.DataFrame, target: str, features: list[str]):
    frame = frame.drop_duplicates().replace([np.inf, -np.inf], np.nan)
    frame = frame.dropna(subset=[target])
    x = frame[features].apply(pd.to_numeric, errors="coerce")
    y = frame[target].astype(int)
    x_train, x_test, y_train, y_test = train_test_split(
        x, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y
    )
    results = {}
    trained = {}
    for candidate_name, model in candidates().items():
        model.fit(x_train, y_train)
        results[candidate_name] = metrics(model, x_test, y_test)
        trained[candidate_name] = model
        print(name, candidate_name, results[candidate_name])
    selected = max(results, key=lambda candidate: results[candidate]["macro_f1"])
    joblib.dump(trained[selected], MODELS / f"{name}_model_pipeline.pkl")
    joblib.dump(features, MODELS / f"{name}_features.pkl")
    return {
        "selected_model": selected,
        "rows_after_deduplication": len(frame),
        "features": features,
        "class_counts": {str(key): int(value) for key, value in y.value_counts().items()},
        "candidates": results,
    }


def liver_frame():
    frame = pd.read_csv(DATASETS / "Liver Patient Dataset (LPD)_train.csv", encoding="latin1")
    frame.rename(columns={
        "Age of the patient": "Age",
        "Gender of the patient": "Gender",
        "\xa0Alkphos Alkaline Phosphotase": "Alkaline_Phosphotase",
        "\xa0Sgpt Alamine Aminotransferase": "Alamine_Aminotransferase",
        "Sgot Aspartate Aminotransferase": "Aspartate_Aminotransferase",
        "Total Bilirubin": "Total_Bilirubin",
        "Direct Bilirubin": "Direct_Bilirubin",
        "Total Protiens": "Total_Protiens",
        "\xa0ALB Albumin": "Albumin",
        "A/G Ratio Albumin and Globulin Ratio": "Albumin_and_Globulin_Ratio",
    }, inplace=True)
    frame["Gender"] = frame["Gender"].map({"Male": 1, "Female": 0})
    frame["Result"] = frame["Result"].map({1: 1, 2: 0})
    return frame


def main():
    heart_features = ["age", "sex", "cp", "trestbps", "chol", "fbs", "restecg", "thalach", "exang", "oldpeak", "slope", "ca", "thal"]
    diabetes_features = ["HighBP", "HighChol", "CholCheck", "BMI", "Smoker", "Stroke", "HeartDiseaseorAttack", "PhysActivity", "HvyAlcoholConsump", "AnyHealthcare", "NoDocbcCost", "GenHlth", "MentHlth", "Sex", "Age", "Income"]
    liver_features = ["Age", "Gender", "Total_Bilirubin", "Direct_Bilirubin", "Alkaline_Phosphotase", "Alamine_Aminotransferase", "Aspartate_Aminotransferase", "Total_Protiens", "Albumin", "Albumin_and_Globulin_Ratio"]
    audit = {
        "heart": train("heart", pd.read_csv(DATASETS / "heart_dataset.csv"), "target", heart_features),
        "diabetes": train("diabetes", pd.read_csv(DATASETS / "Diabetes.csv"), "Diabetes_binary", diabetes_features),
        "liver": train("liver", liver_frame(), "Result", liver_features),
    }
    (MODELS / "training_metrics.json").write_text(json.dumps(audit, indent=2), encoding="utf-8")
    print("Saved validated pipelines and metrics to", MODELS)


if __name__ == "__main__":
    main()
