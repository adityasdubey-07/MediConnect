@echo off
setlocal
cd /d "%~dp0"

echo Migrating existing local MediConnect data to MySQL...
node migrate-local-data-to-mysql.js

if errorlevel 1 (
  echo.
  echo Migration failed. Make sure XAMPP MySQL is running and the database schema is installed.
  pause
  exit /b 1
)

echo.
echo Migration completed successfully.
pause
endlocal
