"""
gRPC inference server for the HFT market-maker ML model.

Serves predictions on port 50051 with Prometheus /metrics and /healthz on port 9100.
The C++ core and Go backend call this service asynchronously.
"""

import logging
import os
import sys
import threading
import time
from concurrent import futures

import grpc

# The pb2 stubs live in the same package directory.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import prediction_pb2          # noqa: E402
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
# Prometheus metrics & health check HTTP server (stdlib only, on port 9100)
# ---------------------------------------------------------------------------

class _Metrics:
    BUCKETS = (0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1)

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.requests_ok = 0
        self.requests_err = 0
        self.lat_sum = 0.0
        self.lat_count = 0
        self.lat_buckets = [0] * len(self.BUCKETS)
        self.model_loaded = 0
        self.started = time.time()

    def observe(self, seconds: float, ok: bool) -> None:
        with self._lock:
            if ok:
                self.requests_ok += 1
            else:
                self.requests_err += 1
            self.lat_sum += seconds
            self.lat_count += 1
            for i, le in enumerate(self.BUCKETS):
                if seconds <= le:
                    self.lat_buckets[i] += 1

    def render(self) -> str:
        with self._lock:
            lines = [
                "# TYPE ml_predict_requests_total counter",
                f'ml_predict_requests_total{{status="ok"}} {self.requests_ok}',
                f'ml_predict_requests_total{{status="error"}} {self.requests_err}',
                "# TYPE ml_predict_duration_seconds histogram",
            ]
            for le, c in zip(self.BUCKETS, self.lat_buckets):
                lines.append(f'ml_predict_duration_seconds_bucket{{le="{le}"}} {c}')
            lines += [
                f'ml_predict_duration_seconds_bucket{{le="+Inf"}} {self.lat_count}',
                f"ml_predict_duration_seconds_sum {self.lat_sum}",
                f"ml_predict_duration_seconds_count {self.lat_count}",
                "# TYPE ml_model_loaded gauge",
                f"ml_model_loaded {self.model_loaded}",
                "# TYPE ml_uptime_seconds gauge",
                f"ml_uptime_seconds {time.time() - self.started:.0f}",
            ]
        return "\n".join(lines) + "\n"


METRICS = _Metrics()


def _start_metrics_server(port: int) -> None:
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class _Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path == "/metrics":
                body = METRICS.render().encode()
                ctype = "text/plain; version=0.0.4"
            elif self.path in ("/healthz", "/readyz"):
                body, ctype = b"ok\n", "text/plain"
            else:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):  # silence per-request logs
            pass

    try:
        httpd = ThreadingHTTPServer(("0.0.0.0", port), _Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True, name="MetricsHTTP").start()
        logger.info("metrics & healthz endpoint listening on :%d/metrics", port)
    except Exception as exc:
        logger.warning("Failed to start metrics server on port %d: %s", port, exc)


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
        t0 = time.perf_counter()
        ok = False
        try:
            resp = self._predict(request, context)
            ok = resp is not None
            return resp
        finally:
            METRICS.observe(time.perf_counter() - t0, ok)

    def _predict(self, request, context):
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
    METRICS.model_loaded = 1 if getattr(servicer.predictor, "model", None) is not None else 0
    _start_metrics_server(int(os.getenv("ML_METRICS_PORT", "9100")))

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
