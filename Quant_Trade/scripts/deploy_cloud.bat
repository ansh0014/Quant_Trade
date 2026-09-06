@echo off
setlocal enabledelayedexpansion

:: ==============================================================================
:: QuantTrade HFT Platform — Cloud Kubernetes One-Click Deployment Script (Windows)
:: ==============================================================================
:: Usage:
::   set REGISTRY=gcr.io/your-project-id
::   set TAG=v1.0.0
::   scripts\deploy_cloud.bat
:: ==============================================================================

if "%REGISTRY%"=="" set REGISTRY=docker.io/quanttrade
if "%TAG%"=="" set TAG=latest
if "%NAMESPACE%"=="" set NAMESPACE=hft
if "%STORAGE_CLASS%"=="" set STORAGE_CLASS=standard

echo ======================================================================
echo QuantTrade HFT Platform — Cloud Kubernetes Deployment (Windows)
echo ======================================================================
echo Registry:     %REGISTRY%
echo Tag:          %TAG%
echo Namespace:    %NAMESPACE%
echo StorageClass: %STORAGE_CLASS%
echo ======================================================================

:: Step 0: Pre-flight checks
echo [Step 0] Checking prerequisites (kubectl, docker)...
where kubectl >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: kubectl command not found. Please install kubectl.
    exit /b 1
)

where docker >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: docker command not found. Please install Docker Desktop.
    exit /b 1
)

:: Step 1: Build & Push Images
echo.
echo [Step 1] Building and Pushing Docker images to Cloud Registry...

echo --> Building backend-go...
docker build -t %REGISTRY%/hft-backend:%TAG% ./backend-go
docker push %REGISTRY%/hft-backend:%TAG%

echo --> Building ml-predictor...
docker build -t %REGISTRY%/ml-predictor:%TAG% ./ml
docker push %REGISTRY%/ml-predictor:%TAG%

echo --> Building hft-frontend...
docker build -t %REGISTRY%/hft-frontend:%TAG% ./frontend
docker push %REGISTRY%/hft-frontend:%TAG%

echo --> Building exchange-sim...
docker build -t %REGISTRY%/exchange-sim:%TAG% ./exchange-sim
docker push %REGISTRY%/exchange-sim:%TAG%

:: Step 2: Apply K8s Manifests
echo.
echo [Step 2] Deploying manifests to Cloud Kubernetes cluster...
kubectl apply -f deployment/k8s/platform-services.yaml
kubectl apply -f deployment/k8s/simulation-cronjob.yaml

:: Step 3: Monitor Rollout
echo.
echo [Step 3] Waiting for rollout completion...
kubectl rollout status deployment/hft-backend-deploy -n %NAMESPACE% --timeout=180s
kubectl rollout status deployment/hft-frontend-deploy -n %NAMESPACE% --timeout=180s

echo.
echo ======================================================================
echo Deployment completed successfully!
echo ======================================================================
kubectl get svc -n %NAMESPACE%

