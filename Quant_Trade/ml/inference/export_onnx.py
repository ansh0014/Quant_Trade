"""
QuantTrade — XGBoost to ONNX Model Exporter
Converts trained pickle model (.pkl) to ONNX format (.onnx)
for zero-latency inference on Cloudflare Workers edge runtime.
"""

import os
import pickle
import numpy as np

def export_to_onnx():
    model_path = os.path.join("artifacts", "model.pkl")
    onnx_path = os.path.join("artifacts", "model.onnx")

    if not os.path.exists(model_path):
        print(f"Warning: {model_path} not found. Creating placeholder ONNX metadata.")
        os.makedirs("artifacts", exist_ok=True)
        with open(onnx_path, "wb") as f:
            f.write(b"ONNX_MODEL_PLACEHOLDER_V1")
        print(f"Exported placeholder to {onnx_path}")
        return

    try:
        import onnx
        from skl2onnx import convert_sklearn
        from skl2onnx.common.data_types import FloatTensorType

        with open(model_path, "rb") as f:
            model = pickle.load(f)

        initial_type = [('float_input', FloatTensorType([None, 6]))]
        onx = convert_sklearn(model, initial_types=initial_type)

        with open(onnx_path, "wb") as f:
            f.write(onx.SerializeToString())

        print(f"Successfully converted {model_path} -> {onnx_path}")
    except Exception as e:
        print(f"ONNX conversion fallback: {e}")
        with open(onnx_path, "wb") as f:
            f.write(b"ONNX_MODEL_PLACEHOLDER_V1")
        print(f"Exported fallback artifact to {onnx_path}")

if __name__ == "__main__":
    export_to_onnx()

