#!/usr/bin/env bash
# ==============================================================================
# QuantTrade HFT Platform — Cloud Kubernetes One-Click Deployment Script
# ==============================================================================
# Usage:
#   export REGISTRY="gcr.io/your-project-id"   # or docker.io/yourusername, ecr, etc.
#   export TAG="v1.0.0"                        # image tag (default: latest)
#   ./scripts/deploy_cloud.sh
# ==============================================================================

set -euo pipefail

REGISTRY="${REGISTRY:-docker.io/quanttrade}"
TAG="${TAG:-latest}"
NAMESPACE="${NAMESPACE:-hft}"
STORAGE_CLASS="${STORAGE_CLASS:-standard}" # standard, gp2 (EKS), pd-ssd (GKE), do-block-storage

echo "======================================================================"
echo "🚀 QuantTrade HFT Platform — Cloud Kubernetes Deployment"
echo "======================================================================"
echo "Registry:      ${REGISTRY}"
echo "Tag:           ${TAG}"
echo "Namespace:     ${NAMESPACE}"
echo "StorageClass:  ${STORAGE_CLASS}"
echo "======================================================================"

# ------------------------------------------------------------------------------
# Step 0: Pre-flight checks
# ------------------------------------------------------------------------------
echo -e "\n[Step 0] Checking prerequisites (kubectl, docker)..."
command -v kubectl >/dev/null 2>&1 || { echo "❌ kubectl is required but not installed. Aborting."; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ docker is required but not installed. Aborting."; exit 1; }

echo "Checking cluster connectivity..."
kubectl cluster-info >/dev/null 2>&1 || { echo "❌ Cannot connect to Kubernetes cluster. Ensure your cloud kubeconfig is set."; exit 1; }
echo "✅ Prerequisites and cluster connection verified."

# ------------------------------------------------------------------------------
# Step 1: Build & Push Container Images
# ------------------------------------------------------------------------------
echo -e "\n[Step 1] Building and Pushing Docker images to container registry..."

IMAGES=("hft-backend" "ml-predictor" "hft-frontend" "exchange-sim")
DIRS=("backend-go" "ml" "frontend" "exchange-sim")

for i in "${!IMAGES[@]}"; do
  IMG_NAME="${IMAGES[$i]}"
  DIR_NAME="${DIRS[$i]}"
  FULL_IMAGE="${REGISTRY}/${IMG_NAME}:${TAG}"
  
  echo -e "\n--> Building ${IMG_NAME} from ./${DIR_NAME}..."
  docker build -t "${FULL_IMAGE}" "./${DIR_NAME}"
  
  echo "--> Pushing ${FULL_IMAGE} to registry..."
  docker push "${FULL_IMAGE}"
done

echo "✅ All 4 images successfully built and pushed to ${REGISTRY}."

# ------------------------------------------------------------------------------
# Step 2: Generate Cloud K8s Manifests
# ------------------------------------------------------------------------------
echo -e "\n[Step 2] Generating production cloud Kubernetes manifests..."

TMP_DIR="$(mktemp -d)"
PROD_MANIFEST="${TMP_DIR}/cloud-manifest.yaml"

cat <<EOF > "${PROD_MANIFEST}"
apiVersion: v1
kind: Namespace
metadata:
  name: ${NAMESPACE}
  labels:
    app.kubernetes.io/part-of: hft-platform
    environment: production

---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: hft-shared-data-pvc
  namespace: ${NAMESPACE}
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: ${STORAGE_CLASS}
  resources:
    requests:
      storage: 20Gi

---
apiVersion: v1
kind: ConfigMap
metadata:
  name: hft-backend-config
  namespace: ${NAMESPACE}
data:
  prod.yaml: |
    server:
      grpc_port: 9090
      ws_port: 8081
    exchange:
      ws_url: "ws://hft-exchange-sim-svc.${NAMESPACE}.svc.cluster.local:8080/ws/market-data"
      reconnect_delay_s: 1.0
      max_reconnect_delay_s: 10.0
    storage:
      output_dir: "/data/ticks"
      buffer_size: 5000
      flush_interval_s: 5.0
      max_file_ticks: 200000
    ml:
      grpc_addr: "hft-ml-predictor-svc.${NAMESPACE}.svc.cluster.local:50051"
    symbol_map:
      0: "AAPL"
      1: "MSFT"
      2: "TSLA"
      3: "NVDA"
    logging:
      level: "info"
      format: "json"

---
# ML PREDICTOR DEPLOYMENT
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hft-ml-predictor-deploy
  namespace: ${NAMESPACE}
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ml-predictor
  template:
    metadata:
      labels:
        app: ml-predictor
    spec:
      containers:
        - name: ml-predictor
          image: ${REGISTRY}/ml-predictor:${TAG}
          imagePullPolicy: Always
          ports:
            - containerPort: 50051
          env:
            - name: ML_MODEL_DIR
              value: "/data/artifacts"
            - name: ML_GRPC_PORT
              value: "50051"
            - name: ML_WORKERS
              value: "4"
          volumeMounts:
            - name: shared-storage
              mountPath: /data
          resources:
            requests:
              cpu: "1000m"
              memory: "1Gi"
            limits:
              cpu: "2000m"
              memory: "2Gi"
      volumes:
        - name: shared-storage
          persistentVolumeClaim:
            claimName: hft-shared-data-pvc

---
apiVersion: v1
kind: Service
metadata:
  name: hft-ml-predictor-svc
  namespace: ${NAMESPACE}
spec:
  type: ClusterIP
  selector:
    app: ml-predictor
  ports:
    - port: 50051
      targetPort: 50051

---
# INGESTION BACKEND DEPLOYMENT
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hft-backend-deploy
  namespace: ${NAMESPACE}
spec:
  replicas: 2
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
        - name: backend
          image: ${REGISTRY}/hft-backend:${TAG}
          imagePullPolicy: Always
          ports:
            - containerPort: 8081
            - containerPort: 9090
          volumeMounts:
            - name: shared-storage
              mountPath: /data
            - name: config-volume
              mountPath: /app/configs
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "1000m"
              memory: "1Gi"
      volumes:
        - name: shared-storage
          persistentVolumeClaim:
            claimName: hft-shared-data-pvc
        - name: config-volume
          configMap:
            name: hft-backend-config

---
# GO BACKEND PUBLIC LOAD BALANCER / SERVICE
apiVersion: v1
kind: Service
metadata:
  name: hft-backend-svc
  namespace: ${NAMESPACE}
spec:
  type: LoadBalancer
  selector:
    app: backend
  ports:
    - name: ws
      port: 8081
      targetPort: 8081
    - name: grpc
      port: 9090
      targetPort: 9090

---
# NEXT.JS FRONTEND DEPLOYMENT
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hft-frontend-deploy
  namespace: ${NAMESPACE}
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
        - name: frontend
          image: ${REGISTRY}/hft-frontend:${TAG}
          imagePullPolicy: Always
          ports:
            - containerPort: 3000
          env:
            - name: PORT
              value: "3000"
            - name: HOSTNAME
              value: "0.0.0.0"
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"

---
# NEXT.JS FRONTEND LOAD BALANCER
apiVersion: v1
kind: Service
metadata:
  name: hft-frontend-svc
  namespace: ${NAMESPACE}
spec:
  type: LoadBalancer
  selector:
    app: frontend
  ports:
    - name: http
      port: 80
      targetPort: 3000

---
# C++ EXCHANGE SIMULATOR SERVICE & DEPLOYMENT
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hft-exchange-sim-deploy
  namespace: ${NAMESPACE}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: exchange-sim
  template:
    metadata:
      labels:
        app: exchange-sim
    spec:
      containers:
        - name: exchange-sim
          image: ${REGISTRY}/exchange-sim:${TAG}
          imagePullPolicy: Always
          command: ["/app/exchange-sim/build/exchange_sim"]
          args: ["--synth", "--duration", "86400", "--symbol", "0", "--spread", "2", "--noise-interval-us", "50000", "--ws-port", "8080"]
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: "1000m"
              memory: "512Mi"
            limits:
              cpu: "2000m"
              memory: "1Gi"

---
apiVersion: v1
kind: Service
metadata:
  name: hft-exchange-sim-svc
  namespace: ${NAMESPACE}
spec:
  type: ClusterIP
  selector:
    app: exchange-sim
  ports:
    - port: 8080
      targetPort: 8080
EOF

echo "✅ Production manifest generated."

# ------------------------------------------------------------------------------
# Step 3: Apply Manifests to Cloud Cluster
# ------------------------------------------------------------------------------
echo -e "\n[Step 3] Applying resources to Kubernetes cluster..."
kubectl apply -f "${PROD_MANIFEST}"

# ------------------------------------------------------------------------------
# Step 4: Monitor Rollout Status
# ------------------------------------------------------------------------------
echo -e "\n[Step 4] Waiting for deployments rollout..."
kubectl rollout status deployment/hft-ml-predictor-deploy -n "${NAMESPACE}" --timeout=180s
kubectl rollout status deployment/hft-backend-deploy -n "${NAMESPACE}" --timeout=180s
kubectl rollout status deployment/hft-frontend-deploy -n "${NAMESPACE}" --timeout=180s
kubectl rollout status deployment/hft-exchange-sim-deploy -n "${NAMESPACE}" --timeout=180s

echo -e "\n======================================================================"
echo "🎉 DEPLOYMENT SUCCESSFUL!"
echo "======================================================================"
echo "Cluster Services & Load Balancers:"
kubectl get svc -n "${NAMESPACE}"

echo -e "\nAccess your services via public LoadBalancer IPs shown above:"
echo "  Frontend Dashboard: http://<EXTERNAL-IP-FRONTEND>"
echo "  Backend WS Gateway: ws://<EXTERNAL-IP-BACKEND>:8081/ws/market-data"
echo "======================================================================"

rm -rf "${TMP_DIR}"

