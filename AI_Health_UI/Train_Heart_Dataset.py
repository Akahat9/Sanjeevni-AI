# ===========================================================
# AI Health Assistant – Heart Disease Detection Trainer
# Author: Akshat Sharma
# Dataset: healthcare_project/heart_dataset.csv
# Description: Trains and saves a production-ready model
# ===========================================================

import pandas as pd
import numpy as np
import joblib
import logging
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
from pathlib import Path
from sklearn.model_selection import train_test_split, GridSearchCV
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
import seaborn as sns
import matplotlib.pyplot as plt

# -----------------------------------------------------------
# 1. Load Dataset
# -----------------------------------------------------------
df_path = Path("Datasets/heart_dataset.csv")
try:
    df = pd.read_csv(df_path)
except Exception as e:
    raise RuntimeError(f"Could not read CSV at {df_path}: {e}")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

logger.info("Dataset loaded: %s rows, %s cols", *df.shape)
logger.debug("Columns: %s", list(df.columns))

# -----------------------------------------------------------
# 2. Data Cleaning
# -----------------------------------------------------------
df.replace([np.inf, -np.inf, "?"], np.nan, inplace=True)
df.drop_duplicates(inplace=True)
# Only drop rows where target is missing; we'll impute feature missing values
target_col = "target"  # ensure this matches your dataset
if target_col not in df.columns:
    raise ValueError(f"❌ Target column '{target_col}' not found in dataset!")

before = df.shape[0]
df = df[df[target_col].notna()].copy()
after = df.shape[0]
logger.info("Dropped %d rows with missing target", before - after)

# -----------------------------------------------------------
# 3. Define Features and Target
# -----------------------------------------------------------
X = df.drop(columns=[target_col])
y = df[target_col].astype(int)

# Identify numeric and categorical columns for proper preprocessing
numeric_features = X.select_dtypes(include=[np.number]).columns.tolist()
categorical_features = X.select_dtypes(include=["object", "category"]).columns.tolist()
logger.info("Numeric features: %s", numeric_features)
logger.info("Categorical features: %s", categorical_features)

# -----------------------------------------------------------
# 4. Handle Missing Values + Feature Scaling
# -----------------------------------------------------------
# Build preprocessing pipelines
numeric_transformer = Pipeline(steps=[
    ("imputer", SimpleImputer(strategy="mean")),
    ("scaler", StandardScaler())
])

# OneHotEncoder compatibility
try:
    ohe = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
except TypeError:
    ohe = OneHotEncoder(handle_unknown="ignore", sparse=False)

categorical_transformer = Pipeline(steps=[
    ("imputer", SimpleImputer(strategy="most_frequent")),
    ("onehot", ohe)
])

preprocessor = ColumnTransformer(transformers=[
    ("num", numeric_transformer, numeric_features),
    ("cat", categorical_transformer, categorical_features)
], remainder="drop")

# Create final pipeline with classifier
pipeline = Pipeline(steps=[
    ("preprocessor", preprocessor),
    ("clf", RandomForestClassifier(random_state=42))
])

# -----------------------------------------------------------
# 5. Train-Test Split
# -----------------------------------------------------------
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)
logger.info("Data split completed. Train: %s, Test: %s", X_train.shape, X_test.shape)

# -----------------------------------------------------------
# 6. RandomForest + GridSearchCV
# -----------------------------------------------------------
param_grid = {
    "clf__n_estimators": [100, 150],
    "clf__max_depth": [5, 10, 15],
    "clf__min_samples_split": [2, 5],
    "clf__min_samples_leaf": [1, 2],
    "clf__bootstrap": [True]
}

grid = GridSearchCV(pipeline, param_grid, cv=5, n_jobs=-1, verbose=1)
logger.info("Starting GridSearchCV...")
grid.fit(X_train, y_train)

best_pipeline = grid.best_estimator_
logger.info("Best parameters: %s", grid.best_params_)

# -----------------------------------------------------------
# 7. Evaluate Model
# -----------------------------------------------------------
y_pred = best_pipeline.predict(X_test)
acc = accuracy_score(y_test, y_pred)
logger.info("Heart Disease Model Accuracy: %.2f%%", acc * 100)
logger.info("Classification Report:\n%s", classification_report(y_test, y_pred))
logger.info("Confusion Matrix:\n%s", confusion_matrix(y_test, y_pred))

# -----------------------------------------------------------
# 8. Save Model & Preprocessors
# -----------------------------------------------------------
model_dir = Path("AI_Health_UI/models")
model_dir.mkdir(parents=True, exist_ok=True)

joblib.dump(best_pipeline, model_dir / "heart_model_pipeline.pkl")
joblib.dump(preprocessor, model_dir / "heart_preprocessor.pkl")

logger.info("Saved pipeline and preprocessor to %s", model_dir)

# -----------------------------------------------------------
# 9. Visualization (Optional)
# -----------------------------------------------------------
plt.figure(figsize=(8, 6))
sns.heatmap(confusion_matrix(y_test, y_pred), annot=True, fmt='d', cmap="Reds")
plt.title("💓 Confusion Matrix - Heart Disease Detection")
plt.xlabel("Predicted")
plt.ylabel("Actual")
plt.tight_layout()
# save confusion matrix image
cm_path = model_dir / "confusion_matrix_heart.png"
try:
    plt.savefig(cm_path)
    logger.info("Saved confusion matrix image to %s", cm_path)
except Exception as e:
    logger.warning("Could not save confusion matrix image: %s", e)
finally:
    plt.close()

# Feature importance
clf = best_pipeline.named_steps["clf"]
importances = getattr(clf, "feature_importances_", None)
features = df.drop(columns=[target_col]).columns
if importances is None:
    logger.warning("Classifier does not expose feature_importances_. Skipping importance plot.")
else:
    # try to get feature names after preprocessing
    try:
        pre = best_pipeline.named_steps["preprocessor"]
        try:
            feature_names = pre.get_feature_names_out()
        except Exception:
            feature_names = list(features)
    except Exception:
        feature_names = list(features)
    if len(feature_names) != len(importances):
        # fallback to original feature names
        feature_names = list(features)
if importances is not None:
    plt.figure(figsize=(10, max(6, len(feature_names) * 0.3)))
    sns.barplot(x=importances, y=feature_names, palette="mako")
    plt.title("🔥 Feature Importance - Heart Disease Model")
    plt.xlabel("Importance Score")
    plt.ylabel("Feature")
    plt.tight_layout()
    fi_path = model_dir / "feature_importances_heart.png"
    try:
        plt.savefig(fi_path)
        logger.info("Saved feature importances plot to %s", fi_path)
    except Exception as e:
        logger.warning("Could not save feature importances image: %s", e)
    finally:
        plt.close()

logger.info("Training complete. Artifacts saved in %s", model_dir)
