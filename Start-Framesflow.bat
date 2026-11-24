@echo off
rem Double-click to start Framesflow Studio (installs dependencies on the first run).
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, one moment...
  call npm install --no-audit --no-fund
)
call npm start
pause
