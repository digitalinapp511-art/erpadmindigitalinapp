# MongoDB Remote Connection Diagnostic Script
# Run this on the REMOTE device (192.168.50.107) to check configuration

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MongoDB Remote Connection Diagnostic" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get local IP
$localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.254.*"} | Select-Object -First 1).IPAddress
Write-Host "[1/6] Local IP Address: $localIP" -ForegroundColor Yellow

# Check MongoDB Service
Write-Host "[2/6] Checking MongoDB Service..." -ForegroundColor Yellow
$mongoService = Get-Service MongoDB -ErrorAction SilentlyContinue
if ($mongoService) {
    if ($mongoService.Status -eq 'Running') {
        Write-Host "  ✓ MongoDB service is running" -ForegroundColor Green
    } else {
        Write-Host "  ✗ MongoDB service is not running (Status: $($mongoService.Status))" -ForegroundColor Red
        Write-Host "    Run: net start MongoDB" -ForegroundColor Gray
    }
} else {
    Write-Host "  ✗ MongoDB service not found" -ForegroundColor Red
}
Write-Host ""

# Check MongoDB Process
Write-Host "[3/6] Checking MongoDB Process..." -ForegroundColor Yellow
$mongoProcess = Get-Process mongod -ErrorAction SilentlyContinue
if ($mongoProcess) {
    Write-Host "  ✓ MongoDB process is running (PID: $($mongoProcess.Id))" -ForegroundColor Green
} else {
    Write-Host "  ✗ MongoDB process not found" -ForegroundColor Red
}
Write-Host ""

# Check Listening Ports
Write-Host "[4/6] Checking Listening Ports..." -ForegroundColor Yellow
$listening = netstat -ano | findstr :27017
if ($listening) {
    Write-Host "  Port 27017 status:" -ForegroundColor White
    $listening | ForEach-Object {
        if ($_ -match "0\.0\.0\.0:27017") {
            Write-Host "    ✓ Listening on 0.0.0.0:27017 (Network accessible)" -ForegroundColor Green
        } elseif ($_ -match "127\.0\.0\.1:27017") {
            Write-Host "    ✗ Only listening on 127.0.0.1:27017 (Localhost only)" -ForegroundColor Red
            Write-Host "      Need to set bindIp: 0.0.0.0 in mongod.cfg" -ForegroundColor Gray
        } else {
            Write-Host "    $_" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "  ✗ Port 27017 not listening" -ForegroundColor Red
}
Write-Host ""

# Check Firewall Rules
Write-Host "[5/6] Checking Firewall Rules..." -ForegroundColor Yellow
$firewallRules = Get-NetFirewallRule -DisplayName "MongoDB*" -ErrorAction SilentlyContinue
if ($firewallRules) {
    Write-Host "  ✓ Firewall rules found:" -ForegroundColor Green
    $firewallRules | ForEach-Object {
        Write-Host "    - $($_.DisplayName) (Enabled: $($_.Enabled))" -ForegroundColor Gray
    }
} else {
    Write-Host "  ✗ No MongoDB firewall rules found" -ForegroundColor Red
    Write-Host "    Run: New-NetFirewallRule -DisplayName 'MongoDB-27017' -Direction Inbound -Protocol TCP -LocalPort 27017 -Action Allow" -ForegroundColor Gray
}
Write-Host ""

# Test Local Connection
Write-Host "[6/6] Testing Local MongoDB Connection..." -ForegroundColor Yellow
try {
    $testResult = mongosh "mongodb://localhost:27017" --eval "db.adminCommand('ping')" --quiet 2>&1
    if ($LASTEXITCODE -eq 0 -or $testResult -match "ok.*1") {
        Write-Host "  ✓ Local MongoDB connection successful" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Local MongoDB connection failed" -ForegroundColor Red
        Write-Host "    Output: $testResult" -ForegroundColor Gray
    }
} catch {
    Write-Host "  ✗ Could not test local connection (mongosh may not be in PATH)" -ForegroundColor Yellow
}
Write-Host ""

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To allow network connections:" -ForegroundColor White
Write-Host "  1. Set bindIp: 0.0.0.0 in mongod.cfg" -ForegroundColor Gray
Write-Host "  2. Restart MongoDB: net stop MongoDB && net start MongoDB" -ForegroundColor Gray
Write-Host "  3. Allow firewall: New-NetFirewallRule -DisplayName 'MongoDB-27017' -Direction Inbound -Protocol TCP -LocalPort 27017 -Action Allow" -ForegroundColor Gray
Write-Host ""
Write-Host "After configuration, verify with:" -ForegroundColor White
Write-Host "  netstat -ano | findstr :27017" -ForegroundColor Gray
Write-Host "  (Should show 0.0.0.0:27017, not 127.0.0.1:27017)" -ForegroundColor Gray
Write-Host ""

