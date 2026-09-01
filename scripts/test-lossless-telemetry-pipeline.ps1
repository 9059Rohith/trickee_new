[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path (Split-Path -Parent $repositoryRoot) '.deploy\trickee-evify-production\production\trickee-frontend'
$results = [ordered]@{
    backend = 'NOT_RUN'
    alembic = 'NOT_RUN'
    android_identity = 'NOT_RUN'
    android = 'NOT_RUN'
    android_instrumentation = 'NOT_RUN'
    mobile = 'NOT_RUN'
    terraform = 'NOT_RUN'
    public_config = 'NOT_RUN'
    frontend = 'NOT_RUN'
}

function Write-Summary {
    [pscustomobject]$results | ConvertTo-Json -Compress
}

function Invoke-Gate {
    param(
        [Parameter(Mandatory = $true)][string]$Layer,
        [Parameter(Mandatory = $true)][scriptblock]$Command
    )

    try {
        & $Command
        if ($results[$Layer] -eq 'NOT_RUN') {
            $results[$Layer] = 'PASS'
        }
    } catch {
        $results[$Layer] = 'FAIL'
        Write-Summary
        throw
    }
}

function Invoke-NativeGateCommand {
    param([Parameter(Mandatory = $true)][scriptblock]$Command)

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Native command failed with exit code $LASTEXITCODE"
    }
}

try {
    Push-Location $repositoryRoot
    Invoke-Gate 'backend' { Invoke-NativeGateCommand { python -m pytest backend/tests -q } }
    Invoke-Gate 'alembic' { Invoke-NativeGateCommand { python -m pytest backend/tests/test_alembic_roundtrip.py -q } }
    Invoke-Gate 'android_identity' { Invoke-NativeGateCommand { powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-public-release-config.ps1 } }

    Invoke-Gate 'android' {
        Push-Location (Join-Path $repositoryRoot 'mobile\android')
        try {
            Invoke-NativeGateCommand { .\gradlew.bat :app:testDebugUnitTest :app:lintRelease --console=plain }
        } finally {
            Pop-Location
        }
    }

    Invoke-Gate 'android_instrumentation' {
        $adb = Get-Command adb -ErrorAction SilentlyContinue
        $hasDevice = $false
        if ($adb) {
            $hasDevice = @(& $adb.Source devices 2>$null | Select-String -Pattern "\tdevice$").Count -gt 0
        }
        if (-not $hasDevice) {
            $results['android_instrumentation'] = 'SKIPPED_NO_DEVICE'
            return
        }
        Push-Location (Join-Path $repositoryRoot 'mobile\android')
        try {
            Invoke-NativeGateCommand { .\gradlew.bat :app:connectedDebugAndroidTest --console=plain }
        } finally {
            Pop-Location
        }
    }

    Invoke-Gate 'mobile' {
        Push-Location (Join-Path $repositoryRoot 'mobile')
        try {
            Invoke-NativeGateCommand { npm test -- --runInBand }
            Invoke-NativeGateCommand { npm run lint }
        } finally {
            Pop-Location
        }
    }

    Invoke-Gate 'terraform' {
        Push-Location (Join-Path $repositoryRoot 'infra\gcp')
        try {
            Invoke-NativeGateCommand { terraform fmt -check }
            Invoke-NativeGateCommand { terraform validate }
            Invoke-NativeGateCommand { python .\validate_architecture.py }
        } finally {
            Pop-Location
        }
    }

    Invoke-Gate 'public_config' {
        $publicBuild = Get-Content -Raw -LiteralPath (Join-Path $repositoryRoot 'scripts\build-public-release.ps1')
        if ($publicBuild -notmatch "ApiOrigin = 'https://" -or $publicBuild -notmatch "WebSocketOrigin = 'https://") {
            throw 'Public Android API and WebSocket origins must be HTTPS defaults.'
        }
    }

    Invoke-Gate 'frontend' {
        if (-not (Test-Path -LiteralPath (Join-Path $frontendRoot 'package.json'))) {
            throw "Clean deployment frontend clone was not found at $frontendRoot"
        }
        Push-Location $frontendRoot
        try {
            Invoke-NativeGateCommand { node --test tests/public-pages.test.mjs }
            Invoke-NativeGateCommand { npx tsc --noEmit }
            Invoke-NativeGateCommand { npm run lint }
            Invoke-NativeGateCommand { npm run build }
        } finally {
            Pop-Location
        }
    }

    Write-Summary
} finally {
    Pop-Location -ErrorAction SilentlyContinue
}
