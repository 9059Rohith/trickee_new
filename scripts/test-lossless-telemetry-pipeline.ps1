[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path (Split-Path -Parent $repositoryRoot) '.deploy\trickee-evify-production\production\trickee-frontend'
$results = [ordered]@{}

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
        $results[$Layer] = 'PASS'
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

    Invoke-Gate 'android' {
        Push-Location (Join-Path $repositoryRoot 'mobile\android')
        try {
            Invoke-NativeGateCommand { .\gradlew.bat :app:testDebugUnitTest :app:lintRelease --console=plain }
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
    if ((Get-Location).Path -ne $repositoryRoot) {
        Pop-Location -ErrorAction SilentlyContinue
    }
}
