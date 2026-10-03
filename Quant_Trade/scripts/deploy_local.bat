@echo off
setlocal enabledelayedexpansion

echo =============================================================
echo   QuantTrade HFT Platform - Local Minikube Deploy Script
echo =============================================================
echo.

:: ---------------------------------------------------------------
:: Resolve absolute project root (parent of \scripts\)
:: ---------------------------------------------------------------
pushd "%~dp0.."
set "PROJECT_ROOT=%CD%"
popd
echo   Project root: %PROJECT_ROOT%
echo.

:: ---------------------------------------------------------------
:: STEP 0: Pre-flight checks
:: ---------------------------------------------------------------
echo [0/7] Running pre-flight checks...
where minikube >nul 2>&1 || ( echo   [ERROR] minikube not found. & exit /b 1 )
where kubectl  >nul 2>&1 || ( echo   [ERROR] kubectl not found.  & exit /b 1 )
where docker   >nul 2>&1 || ( echo   [ERROR] docker not found.   & exit /b 1 )
echo   All required tools found. OK
echo.

:: ---------------------------------------------------------------
:: STEP 0b: Delete ANY directory under PROJECT_ROOT whose name
::   contains a control character (e.g. logs + carriage-return).
::   Uses two independent methods so at least one succeeds.
:: ---------------------------------------------------------------
echo   Cleaning corrupted directory names...

:: Method 1 — Python with extended-length path prefix (\\?\) which
::   bypasses Windows filename validation and allows deleting dirs
::   whose names contain control characters like CR (0x0D).
python -c "import os,shutil; r='%PROJECT_ROOT%'; lp='\\\\?\\\\'+r; [shutil.rmtree('\\\\?\\\\'+os.path.join(r,n)) for n in os.listdir(lp) if any(ord(c)<32 for c in n)]" 2>nul

:: Method 2 — CMD wildcard fallback. "for /d" expands the glob
::   natively so it finds logs<CR> even though cmd cannot print it.
pushd "%PROJECT_ROOT%"
for /d %%G in ("logs?*") do ( rd /s /q "%%G" 2>nul )
popd

:: Recreate a clean logs\ so the app can write logs at runtime
if not exist "%PROJECT_ROOT%\logs\" mkdir "%PROJECT_ROOT%\logs"
echo   Done.
echo.

:: ---------------------------------------------------------------
:: STEP 1: Check Minikube is running
:: ---------------------------------------------------------------
echo [1/7] Checking Minikube status...
minikube status --format "{{.Host}}" 2>nul | findstr /i "Running" >nul 2>&1
if errorlevel 1 (
    echo   Minikube is not running. Starting it now...
    minikube start
    minikube start --cpus=4 --memory=8192 --disk-size=20g
    if errorlevel 1 ( echo   [ERROR] Failed to start Minikube. & exit /b 1 )
) else (
    echo   Minikube is already running. OK
    echo   Minikube is already running with sufficient resources (4 CPUs, 8GB RAM). OK
)
echo.

:: ---------------------------------------------------------------
:: STEP 2: Point Docker CLI at Minikube's internal daemon
:: ---------------------------------------------------------------
echo [2/7] Switching Docker context to Minikube daemon...
@FOR /f "tokens=*" %%i IN ('minikube -p minikube docker-env --shell cmd') DO @%%i
echo   Docker context set to Minikube. OK
echo.

:: ---------------------------------------------------------------
:: STEP 3: Build Docker images
:: ---------------------------------------------------------------
echo [3/7] Building Docker images inside Minikube...

echo   Building Go Backend...
docker build -t quant_trade/hft-backend:latest -f "%PROJECT_ROOT%\backend-go\Dockerfile" "%PROJECT_ROOT%"
if errorlevel 1 ( echo   [ERROR] Failed to build hft-backend. & exit /b 1 )

echo   Building ML Predictor...
docker build -t quant_trade/ml-predictor:latest -f "%PROJECT_ROOT%\ml\Dockerfile" "%PROJECT_ROOT%"
if errorlevel 1 ( echo   [ERROR] Failed to build ml-predictor. & exit /b 1 )

echo   Building Frontend...
docker build -t quant_trade/hft-frontend:latest -f "%PROJECT_ROOT%\frontend\Dockerfile" "%PROJECT_ROOT%"
if errorlevel 1 ( echo   [ERROR] Failed to build hft-frontend. & exit /b 1 )

echo   Building C++ Exchange Simulator...
docker build -t quant_trade/exchange-sim:latest -f "%PROJECT_ROOT%\exchange-sim\Dockerfile" "%PROJECT_ROOT%"
if errorlevel 1 ( echo   [ERROR] Failed to build exchange-sim. & exit /b 1 )

echo   All images built successfully. OK
echo.

:: ---------------------------------------------------------------
:: STEP 4: Ensure namespace and apply Kubernetes manifests
:: ---------------------------------------------------------------
echo [4/7] Applying Kubernetes manifests...
kubectl get namespace hft >nul 2>&1 || kubectl create namespace hft

kubectl apply -f "%PROJECT_ROOT%\deployment\k8s\platform-services.yaml"
if errorlevel 1 ( echo   [ERROR] Failed to apply platform-services.yaml. & exit /b 1 )

kubectl apply -f "%PROJECT_ROOT%\deployment\k8s\simulation-cronjob.yaml"
if errorlevel 1 ( echo   [ERROR] Failed to apply simulation-cronjob.yaml. & exit /b 1 )

echo   Manifests applied. OK
echo.

:: ---------------------------------------------------------------
:: STEP 5: Wait for core pods to be ready
:: ---------------------------------------------------------------
echo [5/7] Waiting for core pods to become Ready...
kubectl rollout status deployment/hft-backend-deploy      -n hft --timeout=120s
kubectl rollout status deployment/hft-ml-predictor-deploy -n hft --timeout=120s
kubectl rollout status deployment/hft-frontend-deploy     -n hft --timeout=120s
echo   All core pods are Running. OK
echo.

:: ---------------------------------------------------------------
:: STEP 6: Start the Exchange Simulator
:: ---------------------------------------------------------------
echo [6/7] Starting Exchange Simulator...
kubectl delete pod hft-simulator-test -n hft --ignore-not-found >nul 2>&1
kubectl delete pod --field-selector=status.phase=Completed -n hft --ignore-not-found >nul 2>&1
kubectl delete job --all -n hft --ignore-not-found >nul 2>&1

kubectl run hft-simulator-test ^
  --image=quant_trade/exchange-sim:latest ^
  --image-pull-policy=Never ^
  --namespace=hft ^
  --labels=app=exchange-sim ^
  --restart=Always ^
  --command -- /app/exchange-sim/build/exchange_sim ^
  --synth --duration 82800 --symbol 0 --spread 2 --noise-interval-us 100000 --ws-port 8080
if errorlevel 1 ( echo   [ERROR] Failed to start simulator pod. & exit /b 1 )
echo   Simulator pod created. OK
echo.

:: ---------------------------------------------------------------
:: STEP 7: Status and access instructions
:: ---------------------------------------------------------------
echo [7/7] Current pod status:
echo.
kubectl get pods -n hft
echo.

echo =============================================================
echo   DEPLOYMENT COMPLETE!
echo =============================================================
echo.
echo   Open TWO separate CMD windows and run:
echo.
echo   WINDOW 1: kubectl port-forward svc/hft-frontend-svc -n hft 3000:3000
echo   WINDOW 2: kubectl port-forward svc/hft-backend-svc -n hft 8081:8081
echo.
echo   Then open: http://localhost:3000/dashboard
echo.
echo =============================================================

endlocal
