"""
Predictor — loads trained artifacts and serves predictions.

Feature ordering contract (matches FEATURE_NAMES in features.py):
  The C++ prediction_client sends a float array via gRPC where:
    features[0]  = spread
    features[1]  = microprice
    ...
    features[15] = ewma_log_ret_10

  The server passes bid/ask/bid_sz/ask_sz and the Predictor computes
  the full feature vector via StreamingFeaturePipeline before inference.

Hot-reload:
  Call reload() to atomically swap in a freshly trained model from disk
  without restarting the server.  Thread-safe via a simple lock.
"""

import json
import logging
import os
import threading

import joblib
import numpy as np
import pandas as pd

from ml.feature_engineering.features import StreamingFeaturePipeline, FEATURE_NAMES

logger = logging.getLogger(__name__)


class Predictor:
    """
    Wraps the trained model and streaming feature pipeline.

    Load once at server startup; call predict() per tick.
    Thread-safe: a read-write lock guards model/pipeline swaps so that
    in-flight predict() calls finish with the old model while reload()
    installs the new one atomically.
    """

    def __init__(self, model_dir: str = "artifacts") -> None:
        self._model_dir = model_dir
        self._lock = threading.RLock()

        self.model        = None
        self.streaming_pipe = None
        self.feature_names  = FEATURE_NAMES
        self._meta: dict   = {}

        try:
            self._load_from_disk()
        except FileNotFoundError as exc:
            logger.warning("Initial model loading skipped: %s. Serving fallback predictions until model is available.", exc)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load_from_disk(self) -> None:
        """Load model.pkl (and optionally metadata.json) from model_dir."""
        model_path = os.path.join(self._model_dir, "model.pkl")
        pipe_path  = os.path.join(self._model_dir, "pipe.pkl")
        meta_path  = os.path.join(self._model_dir, "metadata.json")

        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"model.pkl not found at {model_path}."
            )

        logger.info("loading model from %s", model_path)
        new_model = joblib.load(model_path)

        if not os.path.exists(pipe_path):
            logger.warning(
                "pipe.pkl not found at %s — using fresh streaming pipeline", pipe_path
            )
        else:
            logger.info("pipe.pkl found at %s", pipe_path)

        new_pipe = StreamingFeaturePipeline()

        # Read metadata for logging / version tracking
        new_meta: dict = {}
        if os.path.exists(meta_path):
            try:
                with open(meta_path) as fh:
                    new_meta = json.load(fh)
            except Exception as exc:
                logger.warning("could not read metadata.json: %s", exc)

        with self._lock:
            self.model          = new_model
            self.streaming_pipe = new_pipe
            self._meta          = new_meta

        version = new_meta.get("model_version", "unknown")
        eval_auc = new_meta.get("eval_auc", "n/a")
        logger.info(
            "model loaded  version=%s  eval_auc=%s", version, eval_auc
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def reload(self) -> bool:
        """
        Hot-swap the model from disk.  Safe to call from a background thread
        while predict() is being called from gRPC worker threads.

        Returns True on success, False if loading failed (old model stays live).
        """
        logger.info("hot-reload triggered for model_dir=%s", self._model_dir)
        try:
            self._load_from_disk()
            return True
        except Exception as exc:
            logger.error("hot-reload failed — keeping current model: %s", exc)
            return False

    def get_version(self) -> str:
        """Return the model_version string from metadata, or 'unknown'."""
        with self._lock:
            return self._meta.get("model_version", "unknown")

    def predict(
        self,
        bid:    float,
        ask:    float,
        bid_sz: float,
        ask_sz: float,
    ) -> tuple[float, int]:
        """
        Compute features for one tick and return (buy_prob, direction).

        buy_prob  — probability of an upward price move (0.0 – 1.0)
        direction — 1 (up) if buy_prob > 0.5, else 0 (down / flat)
        """
        with self._lock:
            if self.streaming_pipe is None:
                self.streaming_pipe = StreamingFeaturePipeline()
            feature_vec = self.streaming_pipe.transform_single(
                bid, ask, bid_sz, ask_sz
            )
            model = self.model

        if model is None:
            tot = bid_sz + ask_sz
            obi = (bid_sz - ask_sz) / tot if tot > 0 else 0.0
            ret_drift = feature_vec[15] if len(feature_vec) > 15 and not np.isnan(feature_vec[15]) else 0.0
            prob = 0.5 + (obi * 0.35) + (ret_drift * 8.0)
            prob = max(0.08, min(0.92, prob))
            direction = 1 if prob > 0.5 else 0
            return float(prob), direction

        # Replace NaN with 0.0 for early ticks where history is insufficient.
        feature_vec = [0.0 if (v != v) else v for v in feature_vec]

        X = pd.DataFrame([feature_vec], columns=self.feature_names)
        buy_prob  = float(model.predict_proba(X)[0][1])
        direction = 1 if buy_prob > 0.5 else 0
        return buy_prob, direction
