# HRMS Network Connection Test Script
# Run this script to test all network connections

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  HRMS Network Connection Tests" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get local IP address
Write-Host "[1/5] Getting local IP address..." -ForegroundColor Yellow
$ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.254.*"} | Select-Object -First 1).IPAddress
Write-Host "Local IP: $ipAddress" -ForegroundColor Green
Write-Host ""

# Test MongoDB Connection
Write-Host "[2/5] Testing MongoDB (main_db layer :27012, Ecosoul :27013, Thrive :27014 on localhost)..." -ForegroundColor Yellow
foreach ($p in @(27012, 27013, 27014)) {
    try {
        $mongoTest = Test-NetConnection -ComputerName localhost -Port $p -WarningAction SilentlyContinue
        if ($mongoTest.TcpTestSucceeded) {
            Write-Host "✓ MongoDB port $p open" -ForegroundColor Green
        } else {
            Write-Host "✗ MongoDB port $p closed" -ForegroundColor Red
        }
    } catch {
        Write-Host "✗ MongoDB port $p test failed: $_" -ForegroundColor Red
    }
}
Write-Host ""

# Test Backend API
Write-Host "[3/5] Testing Backend API (localhost:5008)..." -ForegroundColor Yellow
try {
    $backendTest = Test-NetConnection -ComputerName localhost -Port 5008 -WarningAction SilentlyContinue
    if ($backendTest.TcpTestSucceeded) {
        Write-Host "✓ Backend port is open" -ForegroundColor Green
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:5008/api/health" -UseBasicParsing -TimeoutSec 5
            Write-Host "✓ Backend API is responding" -ForegroundColor Green
            Write-Host "  Status: $($response.StatusCode)" -ForegroundColor Gray
        } catch {
            Write-Host "✗ Backend API not responding: $_" -ForegroundColor Red
        }
    } else {
        Write-Host "✗ Backend port is closed" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Backend connection test failed: $_" -ForegroundColor Red
}
Write-Host ""

# Test Frontend
Write-Host "[4/5] Testing Frontend (localhost:4000)..." -ForegroundColor Yellow
try {
    $frontendTest = Test-NetConnection -ComputerName localhost -Port 4000 -WarningAction SilentlyContinue
    if ($frontendTest.TcpTestSucceeded) {
        Write-Host "✓ Frontend port is open" -ForegroundColor Green
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:4000" -UseBasicParsing -TimeoutSec 5
            Write-Host "✓ Frontend is responding" -ForegroundColor Green
            Write-Host "  Status: $($response.StatusCode)" -ForegroundColor Gray
        } catch {
            Write-Host "✗ Frontend not responding: $_" -ForegroundColor Red
        }
    } else {
        Write-Host "✗ Frontend port is closed" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Frontend connection test failed: $_" -ForegroundColor Red
}
Write-Host ""

# Check PM2 Status
Write-Host "[5/5] Checking PM2 status..." -ForegroundColor Yellow
try {
    $pm2List = pm2 list 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ PM2 is installed and running" -ForegroundColor Green
        if ($pm2List -match "HRMS-backend") {
            Write-Host "✓ HRMS-backend process found" -ForegroundColor Green
        } else {
            Write-Host "✗ HRMS-backend process not found" -ForegroundColor Red
        }
    } else {
        Write-Host "✗ PM2 is not installed or not working" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ PM2 check failed: $_" -ForegroundColor Red
}
Write-Host ""

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Network Test Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Local IP Address: $ipAddress" -ForegroundColor White
Write-Host ""
Write-Host "Test URLs:" -ForegroundColor White
Write-Host "  Frontend:  http://localhost:4000" -ForegroundColor Gray
Write-Host "  Backend:   http://localhost:5008/api" -ForegroundColor Gray
Write-Host "  Health:    http://localhost:5008/api/health" -ForegroundColor Gray
Write-Host ""
Write-Host "Network URLs (from other machines):" -ForegroundColor White
Write-Host "  Frontend:  http://$ipAddress:4000" -ForegroundColor Gray
Write-Host "  Backend:   http://$ipAddress:5008/api" -ForegroundColor Gray
Write-Host "  MongoDB:   mongodb://hrms_admin:HRMS2025`$ecurePass!@$ipAddress:27017/hrms_prod?authSource=admin" -ForegroundColor Gray
Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

