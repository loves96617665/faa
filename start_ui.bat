@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   DaFreeAi Studio UI (Flask)
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 找不到 python，請先安裝 Python 3.10+
  pause
  exit /b 1
)

if exist "venv\Scripts\python.exe" (
  call venv\Scripts\activate.bat
) else (
  echo [setup] 建立 venv...
  python -m venv venv
  if errorlevel 1 (
    echo [WARN] venv 建立失敗，改用系統 python
  ) else (
    call venv\Scripts\activate.bat
  )
)

echo [1/2] 安裝 / 更新依賴（Flask，不含 Gradio/pandas）...
python -m pip install -r requirements.txt -q
if errorlevel 1 (
  echo [ERROR] 依賴安裝失敗
  pause
  exit /b 1
)

echo [2/2] 啟動 Web UI...
echo.
echo   瀏覽器開啟: http://127.0.0.1:7860
echo   按 Ctrl+C 可停止
echo.
python app.py
pause
