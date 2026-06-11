@echo off
echo ========================================
echo   HRMS Backend Production Startup
echo ========================================
echo.

REM Check if PM2 is installed
where pm2 >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: PM2 is not installed. Please install it first:
    echo npm install -g pm2
    pause
    exit /b 1
)

REM Navigate to backend directory
cd /d "%~dp0"

REM Create logs directory if it doesn't exist
if not exist "logs" mkdir logs

echo [1/4] Stopping existing PM2 processes...
pm2 delete HRMS-backend 2>nul

echo [2/4] Flushing PM2 logs...
pm2 flush

echo [3/4] Starting backend in production mode...
call npm run prod:backend

echo [4/4] Saving PM2 configuration...
pm2 save

echo.
echo ========================================
echo   Backend started successfully!
echo ========================================
echo.
echo Useful commands:
echo   pm2 list              - View running processes
echo   pm2 logs HRMS-backend - View logs
echo   pm2 monit             - Monitor processes
echo   pm2 restart HRMS-backend - Restart backend
echo.
pause

