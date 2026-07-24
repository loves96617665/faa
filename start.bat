@echo off
setlocal
cd /d "%~dp0"

if not exist "venv\Scripts\python.exe" (
  echo [setup] creating venv...
  python -m venv venv
  call venv\Scripts\activate.bat
  pip install -r requirements.txt
) else (
  call venv\Scripts\activate.bat
)

if "%~1"=="" (
  echo.
  echo DaFreeAi Studio
  echo.
  echo Web UI:
  echo   start_ui.bat
  echo   python ui_app.py
  echo.
  echo CLI examples:
  echo   start.bat models
  echo   start.bat status
  echo   start.bat login-url
  echo   start.bat generate "a cute cat" --model nano-banana-2-lite --verbose
  echo.
  python main.py models
  goto :eof
)

python main.py %*
