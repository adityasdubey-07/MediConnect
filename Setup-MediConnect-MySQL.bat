@echo off
setlocal

set "MYSQL_EXE=C:\xampp\mysql\bin\mysql.exe"
set "SCHEMA_FILE=%~dp0mysql-schema.sql"

if not exist "%MYSQL_EXE%" (
  echo XAMPP MySQL client was not found at:
  echo %MYSQL_EXE%
  echo.
  echo Install XAMPP in C:\xampp or update this file with your XAMPP path.
  pause
  exit /b 1
)

if not exist "%SCHEMA_FILE%" (
  echo mysql-schema.sql was not found in the project folder.
  pause
  exit /b 1
)

echo Make sure MySQL is running in the XAMPP Control Panel.
echo Creating the MediConnect database and tables...
echo.

"%MYSQL_EXE%" -u root --protocol=tcp < "%SCHEMA_FILE%"

if errorlevel 1 (
  echo.
  echo Database setup failed.
  echo If your MySQL root account has a password, edit this file and add:
  echo     -p
  echo after -u root, then run it again.
  pause
  exit /b 1
)

echo.
echo MediConnect database and tables were created successfully.
echo Open phpMyAdmin at http://localhost/phpmyadmin to view them.
pause
endlocal
