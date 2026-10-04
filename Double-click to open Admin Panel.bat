@echo off
setlocal
cd /d "%~dp0"

echo Starting MediConnect Administration...

if not exist "node_modules" (
  echo Installing project dependencies for the first time...
  call npm install
  if errorlevel 1 (
    echo Installation failed. Please install Node.js and try again.
    pause
    exit /b 1
  )
)

start "MediConnect Server" /D "%~dp0" cmd /k npm start
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000/login.html?redirect=admin-panel.html"

echo.
echo Administration login page opened in your browser.
echo Keep the server window open while using the website.
echo.
pause
