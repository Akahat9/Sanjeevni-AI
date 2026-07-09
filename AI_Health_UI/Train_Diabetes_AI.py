# ===========================================================
# AI Health Assistant – Optimized Diabetes Model Trainer (FIXED)
# Author: Akshat Sharma
# ===========================================================

import argparse
import logging
import pandas as pd
import numpy as np
import joblib
from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
import warnings
warnings.filterwarnings("ignore")

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ===========================================================
# CONFIG
# ===========================================================
DATASET_PATH = Path("Datasets/Diabetes.csv")
MODEL_DIR = Path("AI_Health_UI/models")
MODEL_DIR.mkdir(parents=True, exist_ok=True)


# ===========================================================
# TRAIN MODEL
# ===========================================================
def train_large_diabetes_model(dataset_path: Path = DATASET_PATH, model_dir: Path = MODEL_DIR,
                               n_estimators: int = 250, max_depth: int = 14, random_state: int = 42):
    logger.info("📂 Loading dataset...")
    if not dataset_path.exists():
        logger.error(f"Dataset not found at {dataset_path}. Update DATASET_PATH or provide --dataset-path.")
        raise FileNotFoundError(f"Dataset not found at {dataset_path}")
    df = pd.read_csv(dataset_path, low_memory=False)
    df.columns = df.columns.str.strip()
    df.drop_duplicates(inplace=True)

    logger.info(f"✅ Loaded: {df.shape[0]} rows, {df.shape[1]} cols")

    # Use one explicit binary target. Diabetes_012 is a related label and must
    # not be included as an input because that would leak the answer.
    target_col = "Diabetes_binary"
    if target_col not in df.columns:
        raise ValueError(f"Required target column '{target_col}' not found.")
    print(f"🎯 Target: {target_col}")

    # --- Clean duplicates ---
    df = df.loc[:, ~df.columns.duplicated()]

    # --- Replace infinities ---
    df.replace([np.inf, -np.inf], np.nan, inplace=True)

    # --- Do NOT drop rows; impute instead ---
    logger.info("🧹 Cleaning + imputing...")
    df = df.apply(pd.to_numeric, errors='coerce')

    # Split
    X = df.drop(columns=[target_col, "Diabetes_012"], errors="ignore")
    y = df[target_col]

    # Save feature order
    feature_names = list(X.columns)

    # Impute missing values
    imputer = SimpleImputer(strategy="mean")
    X_imputed = imputer.fit_transform(X)

    # Scale
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_imputed)

    # Train-test split
    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=0.2, random_state=42, stratify=y
    )

    logger.info("🚀 Training RandomForest...")
    model = RandomForestClassifier(
        n_estimators=n_estimators,
        max_depth=max_depth,
        random_state=random_state,
        n_jobs=-1
    )
    model.fit(X_train, y_train)

    # Evaluate
    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    logger.info(f"\n🎯 Accuracy: {acc*100:.2f}%")
    logger.info("\n📈 Classification Report:\n" + classification_report(y_test, y_pred))

    # Save artifacts
    # Ensure model directory exists
    model_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, model_dir / "diabetes_model.pkl")
    joblib.dump(imputer, model_dir / "diabetes_imputer.pkl")
    joblib.dump(scaler, model_dir / "diabetes_scaler.pkl")
    joblib.dump(feature_names, model_dir / "diabetes_features.pkl")

    logger.info("\n💾 Saved model + preprocessor in:")
    logger.info(str(model_dir.resolve()))
    logger.info("✅ Training complete!")


# ===========================================================
# MAIN
# ===========================================================
def parse_args():
    p = argparse.ArgumentParser(description="Train Diabetes RandomForest model")
    p.add_argument("--dataset-path", type=str, default=str(DATASET_PATH), help="Path to Diabetes CSV dataset")
    p.add_argument("--output-dir", type=str, default=str(MODEL_DIR), help="Directory to save model artifacts")
    p.add_argument("--n-estimators", type=int, default=250)
    p.add_argument("--max-depth", type=int, default=14)
    p.add_argument("--random-state", type=int, default=42)
    return p.parse_args()

if __name__ == "__main__":
    args = parse_args()
    train_large_diabetes_model(dataset_path=Path(args.dataset_path), model_dir=Path(args.output_dir),
                               n_estimators=args.n_estimators, max_depth=args.max_depth, random_state=args.random_state)
