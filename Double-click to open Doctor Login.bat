@echo off
setlocal
cd /d "%~dp0"

echo Starting MediConnect...

if not exist "node_modules" (
  echo Installing project dependencies for the first time...
  call npm install
  if errorlevel 1 (
    echo.
    echo Installation failed. Please install Node.js and try again.
    pause
    exit /b 1
  )
)

if not exist "node_modules\mysql2" (
  echo Installing the MySQL dependency...
  call npm install
  if errorlevel 1 (
    echo.
    echo MySQL dependency installation failed.
    pause
    exit /b 1
  )
)

start "MediConnect Server" /D "%~dp0" cmd /k npm start
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000/login.html?redirect=provider-dashboard.html"

echo.
echo Doctor login page opened in your browser.
echo Keep the server window open while using the website.
echo.
pause
