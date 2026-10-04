"""
gRPC inference server for the HFT market-maker ML model.

Serves predictions on port 50051.  The C++ core and Go backend call this
service asynchronously (predictions are cached — the hot path never waits here).

Run from project root:
    PYTHONPATH=. python ml/inference/server.py

Environment variables:
    ML_MODEL_DIR        path to artifact directory (default: artifacts)
    ML_GRPC_PORT        port to listen on          (default: 50051)
    ML_WORKERS          gRPC thread pool size       (default: 4)
    ML_RELOAD_INTERVAL  seconds between metadata-mtime checks (default: 30)

Proto contract (prediction.proto):
    PredictionRequest  { string symbol, repeated double features, int64 timestamp_ns }
    PredictionResponse { string symbol, double price_direction, double predicted_value, int64 timestamp_ns }

Features are sent by C++ in FEATURE_NAMES order.  However, because the C++
side owns the raw order book state, it sends bid/ask/bid_sz/ask_sz (first 4
elements of the features array) and this server runs the streaming pipeline
to compute the full feature vector.  If C++ sends the full pre-computed
feature vector (len >= 16), it is used directly.

Hot-reload (cron-driven):
    When the cron retraining job writes a new model to artifacts/, it updates
    artifacts/metadata.json.  The background watcher thread in this server
    detects the mtime change and calls Predictor.reload() automatically —
    no server restart required.
"""

import logging
import os
import sys
import threading
import time
from concurrent import futures

import grpc

# The pb2 stubs live in the same package directory.
# sys.path manipulation is needed because protoc generates files that import
# each other with bare names.  We add the inference package dir so those
# relative imports resolve without modifying the generated stubs.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import prediction_pb2          # noqa: E402  (generated, must come after path fix)
import prediction_pb2_grpc     # noqa: E402

from ml.inference.predictor import Predictor  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)

_N_FEATURES = 16   # len(FEATURE_NAMES)
_N_RAW      = 4    # bid, ask, bid_sz, ask_sz


# ---------------------------------------------------------------------------
# Background metadata watcher (enables cron-driven hot-reloads)
# ---------------------------------------------------------------------------

class _ModelWatcher(threading.Thread):
    """
    Polls artifacts/metadata.json for mtime changes every `interval` seconds.
    When a change is detected, calls predictor.reload() to hot-swap the model.

    Runs as a daemon thread — it exits automatically when the main process ends.
    """

    def __init__(self, predictor: Predictor, model_dir: str, interval: int) -> None:
        super().__init__(daemon=True, name="ModelWatcher")
        self._predictor = predictor
        self._meta_path = os.path.join(model_dir, "metadata.json")
        self._interval  = interval
        self._last_mtime: float = self._current_mtime()

    def _current_mtime(self) -> float:
        try:
            return os.path.getmtime(self._meta_path)
        except OSError:
            return 0.0

    def run(self) -> None:
        logger.info(
            "ModelWatcher started — polling %s every %ds",
            self._meta_path, self._interval,
        )
        while True:
            time.sleep(self._interval)
            mtime = self._current_mtime()
            if mtime != self._last_mtime:
                logger.info(
                    "metadata.json changed (mtime %.0f → %.0f) — triggering hot-reload",
                    self._last_mtime, mtime,
                )
                success = self._predictor.reload()
                if success:
                    self._last_mtime = mtime
                    logger.info(
                        "hot-reload complete — now serving model version=%s",
                        self._predictor.get_version(),
                    )
                else:
                    logger.warning("hot-reload failed — will retry on next poll cycle")


# ---------------------------------------------------------------------------
# gRPC servicer
# ---------------------------------------------------------------------------

class PredictionService(prediction_pb2_grpc.PredictionServiceServicer):
    """gRPC servicer that wraps the Predictor."""

    def __init__(self, model_dir: str) -> None:
        logger.info("loading predictor from %s", model_dir)
        self.predictor = Predictor(model_dir)
        logger.info("predictor ready")

    def Predict(self, request, context):
        """
        Accept either:
          - 4 features  [bid, ask, bid_sz, ask_sz]  → streaming pipeline computes the rest
          - 16 features  pre-computed full feature vector
        """
        n = len(request.features)
        if n == _N_RAW:
            bid, ask, bid_sz, ask_sz = (float(f) for f in request.features)
            buy_prob, direction = self.predictor.predict(bid, ask, bid_sz, ask_sz)

        elif n >= _N_FEATURES:
            # C++ sent the full feature vector — use it directly (advanced mode).
            if self.predictor.model is None:
                buy_prob, direction = 0.5, 0
            else:
                import pandas as pd
                from ml.feature_engineering.features import FEATURE_NAMES
                feats = [float(f) for f in request.features[:_N_FEATURES]]
                X = pd.DataFrame([feats], columns=FEATURE_NAMES)
                buy_prob  = float(self.predictor.model.predict_proba(X)[0][1])
                direction = 1 if buy_prob > 0.5 else 0

        else:
            context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                f"Expected {_N_RAW} (raw) or {_N_FEATURES} (full) features, got {n}",
            )
            return None

        logger.debug(
            "predict symbol=%s buy_prob=%.4f direction=%d version=%s",
            request.symbol, buy_prob, direction, self.predictor.get_version(),
        )

        return prediction_pb2.PredictionResponse(
            symbol=request.symbol,
            price_direction=float(direction),
            predicted_value=buy_prob,
            timestamp_ns=request.timestamp_ns,
        )

    def HealthCheck(self, request, context):
        """Simple liveness check so the Go client can detect ML degradation."""
        return prediction_pb2.PredictionResponse(
            symbol="health",
            price_direction=0.0,
            predicted_value=1.0,
            timestamp_ns=0,
        )


# ---------------------------------------------------------------------------
# Server entry-point
# ---------------------------------------------------------------------------

def serve() -> None:
    model_dir       = os.getenv("ML_MODEL_DIR",       "artifacts")
    port            = int(os.getenv("ML_GRPC_PORT",   "50051"))
    workers         = int(os.getenv("ML_WORKERS",     "4"))
    reload_interval = int(os.getenv("ML_RELOAD_INTERVAL", "30"))

    # Bootstrap default model files if they don't exist in the targeted directory (e.g. fresh PVC)
    if not os.path.exists(model_dir):
        os.makedirs(model_dir, exist_ok=True)
    
    model_path = os.path.join(model_dir, "model.pkl")
    if not os.path.exists(model_path):
        default_dir = "/app/artifacts"
        if os.path.exists(default_dir) and os.path.abspath(default_dir) != os.path.abspath(model_dir):
            logger.info("Bootstrapping default model files from %s to %s", default_dir, model_dir)
            import shutil
            for filename in ["model.pkl", "pipe.pkl", "metadata.json"]:
                src = os.path.join(default_dir, filename)
                dst = os.path.join(model_dir, filename)
                if os.path.exists(src):
                    shutil.copy2(src, dst)
                    logger.info("Copied %s to %s", filename, dst)

    servicer = PredictionService(model_dir)

    # Start the background watcher so that cron-driven retraining auto-promotes
    # new models into the live server without a restart.
    watcher = _ModelWatcher(servicer.predictor, model_dir, reload_interval)
    watcher.start()

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=workers))
    prediction_pb2_grpc.add_PredictionServiceServicer_to_server(servicer, server)
    server.add_insecure_port(f"[::]:{port}")
    server.start()
    logger.info(
        "inference server listening on :%d (workers=%d  reload_interval=%ds)",
        port, workers, reload_interval,
    )

    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        logger.info("shutting down")
        server.stop(grace=0)


if __name__ == "__main__":
    serve()
