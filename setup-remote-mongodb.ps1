# MongoDB Network Setup Script
# Run this script on the REMOTE device (192.168.50.107) as Administrator
# This will configure MongoDB to accept network connections

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MongoDB Network Setup Script" -ForegroundColor Cyan
Write-Host "  For Remote Device: 192.168.50.107" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "⚠️  This script requires Administrator privileges!" -ForegroundColor Red
    Write-Host "   Please run PowerShell as Administrator and try again." -ForegroundColor Yellow
    pause
    exit 1
}

# Step 1: Check MongoDB Service
Write-Host "[1/5] Checking MongoDB Service..." -ForegroundColor Yellow
$mongoService = Get-Service MongoDB -ErrorAction SilentlyContinue
if ($mongoService) {
    Write-Host "  ✓ MongoDB service found" -ForegroundColor Green
} else {
    Write-Host "  ✗ MongoDB service not found" -ForegroundColor Red
    Write-Host "    Please install MongoDB first" -ForegroundColor Yellow
    pause
    exit 1
}

# Step 2: Find MongoDB config file
Write-Host "[2/5] Locating MongoDB configuration..." -ForegroundColor Yellow
$configPaths = @(
    "C:\mongodb\mongod.cfg",
    "C:\Program Files\MongoDB\Server\*\bin\mongod.cfg",
    "C:\data\mongod.cfg"
)

$configFile = $null
foreach ($path in $configPaths) {
    $resolved = Resolve-Path $path -ErrorAction SilentlyContinue
    if ($resolved) {
        $configFile = $resolved[0].Path
        break
    }
}

if (-not $configFile) {
    # Create default config location
    $configDir = "C:\mongodb"
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }
    $configFile = Join-Path $configDir "mongod.cfg"
    Write-Host "  ℹ Creating new config file: $configFile" -ForegroundColor Yellow
}

Write-Host "  Config file: $configFile" -ForegroundColor White

# Step 3: Update or create config file
Write-Host "[3/5] Updating MongoDB configuration..." -ForegroundColor Yellow

$configContent = @"
storage:
  dbPath: C:\data\db
systemLog:
  destination: file
  path: C:\data\log\mongod.log
  logAppend: true
net:
  port: 27017
  bindIp: 0.0.0.0
security:
  authorization: disabled
"@

# Backup existing config if it exists
if (Test-Path $configFile) {
    $backupFile = "$configFile.backup.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $configFile $backupFile
    Write-Host "  ✓ Backed up existing config to: $backupFile" -ForegroundColor Green
}

# Write new config
Set-Content -Path $configFile -Value $configContent -Force
Write-Host "  ✓ Configuration updated (bindIp: 0.0.0.0)" -ForegroundColor Green

# Step 4: Configure Firewall
Write-Host "[4/5] Configuring Windows Firewall..." -ForegroundColor Yellow
try {
    $existingRule = Get-NetFirewallRule -DisplayName "MongoDB-27017" -ErrorAction SilentlyContinue
    if ($existingRule) {
        Write-Host "  ℹ Firewall rule already exists" -ForegroundColor Yellow
    } else {
        New-NetFirewallRule -DisplayName "MongoDB-27017" -Direction Inbound -Protocol TCP -LocalPort 27017 -Action Allow | Out-Null
        Write-Host "  ✓ Firewall rule created" -ForegroundColor Green
    }
} catch {
    Write-Host "  ✗ Failed to create firewall rule: $_" -ForegroundColor Red
    Write-Host "    You may need to create it manually" -ForegroundColor Yellow
}

# Step 5: Restart MongoDB
Write-Host "[5/5] Restarting MongoDB service..." -ForegroundColor Yellow
try {
    Stop-Service MongoDB -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    
    # Reinstall with new config
    $mongodPath = (Get-Command mongod -ErrorAction SilentlyContinue).Source
    if ($mongodPath) {
        & $mongodPath --config $configFile --install | Out-Null
    }
    
    Start-Service MongoDB
    Start-Sleep -Seconds 3
    
    if ((Get-Service MongoDB).Status -eq 'Running') {
        Write-Host "  ✓ MongoDB service restarted successfully" -ForegroundColor Green
    } else {
        Write-Host "  ✗ MongoDB service failed to start" -ForegroundColor Red
    }
} catch {
    Write-Host "  ✗ Error restarting MongoDB: $_" -ForegroundColor Red
}

# Verify configuration
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Checking listening ports..." -ForegroundColor Yellow
$listening = netstat -ano | findstr :27017
if ($listening -match "0\.0\.0\.0:27017") {
    Write-Host "  ✓ MongoDB is listening on 0.0.0.0:27017 (Network accessible)" -ForegroundColor Green
} elseif ($listening -match "127\.0\.0\.1:27017") {
    Write-Host "  ✗ MongoDB is only listening on 127.0.0.1:27017 (Localhost only)" -ForegroundColor Red
    Write-Host "    Configuration may not have taken effect. Please restart MongoDB manually." -ForegroundColor Yellow
} else {
    Write-Host "  ✗ Port 27017 not found in listening ports" -ForegroundColor Red
}

Write-Host ""
Write-Host "Testing local connection..." -ForegroundColor Yellow
try {
    $testResult = mongosh "mongodb://localhost:27017" --eval "db.adminCommand('ping')" --quiet 2>&1
    if ($LASTEXITCODE -eq 0 -or $testResult -match "ok.*1") {
        Write-Host "  ✓ Local MongoDB connection successful" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Local connection test failed" -ForegroundColor Red
    }
} catch {
    Write-Host "  ℹ Could not test local connection (mongosh may not be in PATH)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Verify: netstat -ano | findstr :27017" -ForegroundColor Gray
Write-Host "     (Should show 0.0.0.0:27017)" -ForegroundColor Gray
Write-Host "  2. Test from remote device:" -ForegroundColor Gray
Write-Host "     mongosh `"mongodb://192.168.50.107:27017`"" -ForegroundColor Gray
Write-Host "  3. Test from your device:" -ForegroundColor Gray
Write-Host "     npm run test-mongodb" -ForegroundColor Gray
Write-Host ""
pause

