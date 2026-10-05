# Dockerfile for Python ML inference service
FROM python:3.10-slim

WORKDIR /app

# Install system dependencies (compiler, git, build tools)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install python scientific stack and grpc
RUN pip install --no-cache-dir \
    grpcio==1.60.0 \
    grpcio-tools==1.60.0 \
    pandas==2.1.4 \
    numpy==1.26.2 \
    joblib==1.3.2 \
    scikit-learn==1.3.2 \
    xgboost==2.0.3

# Copy the entire python ml stack
COPY . .

# Compile protobuf stubs
RUN python -m grpc_tools.protoc \
    -Iproto \
    --python_out=ml/inference \
    --grpc_python_out=ml/inference \
    proto/prediction.proto

# Set PYTHONPATH
ENV PYTHONPATH=/app

# Default env variables
ENV ML_MODEL_DIR=/app/artifacts
ENV ML_GRPC_PORT=50051
ENV ML_WORKERS=4
ENV ML_RELOAD_INTERVAL=30

EXPOSE 50051 9100

ENTRYPOINT ["python", "ml/inference/server.py"]
