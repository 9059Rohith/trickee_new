[CmdletBinding()]
param(
    [switch]$RestartServices,
    [switch]$SkipAndroid,
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $repoRoot "backend"
$mobileRoot = Join-Path $repoRoot "mobile"
$python = Join-Path $backendRoot ".venv\Scripts\python.exe"
$logRoot = Join-Path $env:TEMP "trickee-gpsdriver-local"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Stop-PortListener([int]$Port) {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        if ($process) {
            Write-Host "Stopping $($process.ProcessName) PID $($process.Id) on port $Port"
            Stop-Process -Id $process.Id -Force
        }
    }
}

function Start-LoggedProcess(
    [string]$Name,
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory
) {
    $stdout = Join-Path $logRoot "$Name.stdout.log"
    $stderr = Join-Path $logRoot "$Name.stderr.log"
    Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
    $process = Start-Process -FilePath $FilePath `
        -ArgumentList $ArgumentList `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru
    Set-Content -LiteralPath (Join-Path $logRoot "$Name.pid") -Value $process.Id
    Write-Host "Started $Name (PID $($process.Id)); logs: $stdout"
}

function Wait-Health([string]$Url, [int]$Attempts = 40) {
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $Url -TimeoutSec 2
            if ($response.status -eq "ok") { return }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    throw "Service did not become healthy: $Url"
}

if (-not (Test-Path -LiteralPath $python)) {
    throw "Backend virtual environment is missing. Run: py -3.11 -m venv backend\.venv"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is required. Install Node.js 20.19.4 or newer."
}

Push-Location $backendRoot
try {
    & $python -m alembic upgrade head
    if ($LASTEXITCODE -ne 0) { throw "Alembic migration failed" }
    & $python -m scripts.seed_demo
    if ($LASTEXITCODE -ne 0) { throw "Demo seed failed" }
} finally {
    Pop-Location
}

if ($RestartServices) {
    Stop-PortListener 8001
    Stop-PortListener 8081
}

if (-not (Get-NetTCPConnection -State Listen -LocalPort 8001 -ErrorAction SilentlyContinue)) {
    Start-LoggedProcess "backend" $python @(
        "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8001"
    ) $backendRoot
}
Wait-Health "http://127.0.0.1:8001/health"

$nodeModules = Join-Path $mobileRoot "node_modules"
if ($mobileRoot.ToLowerInvariant().Contains("\onedrive\")) {
    # Gradle 8 rejects OneDrive Files On-Demand reparse points as non-regular
    # files. Install dependencies outside the synced tree and expose them via a
    # directory junction so Metro, npm, and Gradle all use real local files.
    $dependencyRoot = Join-Path $env:LOCALAPPDATA "Trickee\gpsdriver-mobile-deps"
    $externalModules = Join-Path $dependencyRoot "node_modules"
    $lockHash = (Get-FileHash -LiteralPath (Join-Path $mobileRoot "package-lock.json") -Algorithm SHA256).Hash
    $stamp = Join-Path $dependencyRoot ".lock-sha256"
    $installedHash = if (Test-Path -LiteralPath $stamp) { (Get-Content -LiteralPath $stamp -Raw).Trim() } else { "" }

    if ($installedHash -ne $lockHash -or -not (Test-Path -LiteralPath $externalModules)) {
        if ($SkipInstall) {
            throw "External mobile dependencies are stale; rerun without -SkipInstall"
        }
        New-Item -ItemType Directory -Force -Path $dependencyRoot | Out-Null
        Copy-Item -LiteralPath (Join-Path $mobileRoot "package.json") -Destination $dependencyRoot -Force
        Copy-Item -LiteralPath (Join-Path $mobileRoot "package-lock.json") -Destination $dependencyRoot -Force
        Push-Location $dependencyRoot
        try {
            & npm ci --ignore-scripts
            if ($LASTEXITCODE -ne 0) { throw "external npm ci failed" }
        } finally {
            Pop-Location
        }
        Set-Content -LiteralPath $stamp -Value $lockHash
    }

    if (Test-Path -LiteralPath $nodeModules) {
        $nodeModulesItem = Get-Item -LiteralPath $nodeModules -Force
        $targetMatches = $nodeModulesItem.LinkType -eq "Junction" -and
            [IO.Path]::GetFullPath([string]$nodeModulesItem.Target) -eq [IO.Path]::GetFullPath($externalModules)
        if (-not $targetMatches) {
            $expectedModules = [IO.Path]::GetFullPath((Join-Path $mobileRoot "node_modules"))
            if ([IO.Path]::GetFullPath($nodeModulesItem.FullName) -ne $expectedModules) {
                throw "Refusing unexpected node_modules path"
            }
            if ($nodeModulesItem.LinkType -eq "Junction") {
                Remove-Item -LiteralPath $nodeModules -Force
            } else {
                Remove-Item -LiteralPath $nodeModules -Recurse -Force
            }
        }
    }
    if (-not (Test-Path -LiteralPath $nodeModules)) {
        New-Item -ItemType Junction -Path $nodeModules -Target $externalModules | Out-Null
    }
} elseif (-not $SkipInstall -and -not (Test-Path -LiteralPath $nodeModules)) {
    Push-Location $mobileRoot
    try {
        & npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
    } finally {
        Pop-Location
    }
}

if (-not (Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue)) {
    Start-LoggedProcess "metro" "cmd.exe" @(
        "/d", "/c", "npm start -- --reset-cache"
    ) $mobileRoot
}

if (-not $SkipAndroid) {
    $adb = Get-Command adb -ErrorAction SilentlyContinue
    if (-not $adb) { throw "adb is required for Android launch" }
    $device = (& adb devices | Select-String "\tdevice$").Line | Select-Object -First 1
    if (-not $device) { throw "No running Android emulator/device was found" }

    Push-Location (Join-Path $mobileRoot "android")
    try {
        & .\gradlew.bat installDebug --no-daemon --no-parallel -PreactNativeArchitectures=x86_64
        if ($LASTEXITCODE -ne 0) { throw "Android installDebug failed" }
    } finally {
        Pop-Location
    }
    & adb shell am force-stop com.trickee.gpsdriverapp
    & adb shell monkey -p com.trickee.gpsdriverapp -c android.intent.category.LAUNCHER 1 | Out-Null
}

Write-Host ""
Write-Host "Trickee GPS Driver local stack is ready"
Write-Host "API:     http://127.0.0.1:8001"
Write-Host "Docs:    http://127.0.0.1:8001/docs"
Write-Host "Metro:   http://127.0.0.1:8081"
Write-Host "Logs:    $logRoot"
Write-Host "Ravi:    driver1@evify.in / Driver@2026 (EV-001)"
Write-Host "Priya:   driver2@evify.in / Driver@2026 (EV-002)"
