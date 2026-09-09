[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$rootGradle = Get-Content -LiteralPath (Join-Path $repositoryRoot 'mobile\android\build.gradle') -Raw
$appGradle = Get-Content -LiteralPath (Join-Path $repositoryRoot 'mobile\android\app\build.gradle') -Raw
$manifest = Get-Content -LiteralPath (Join-Path $repositoryRoot 'mobile\android\app\src\main\AndroidManifest.xml') -Raw
$wrapperProperties = Get-Content -LiteralPath (Join-Path $repositoryRoot 'mobile\android\gradle\wrapper\gradle-wrapper.properties') -Raw
$publicBuildScriptPath = Join-Path $PSScriptRoot 'build-public-release.ps1'
$publicBuildScript = if (Test-Path -LiteralPath $publicBuildScriptPath) {
    Get-Content -LiteralPath $publicBuildScriptPath -Raw
} else {
    ''
}

$expectations = [ordered]@{
    'compile SDK 36' = $rootGradle -match 'compileSdkVersion\s*=\s*36'
    'target SDK 36' = $rootGradle -match 'targetSdkVersion\s*=\s*36'
    'build tools 36.0.0' = $rootGradle -match 'buildToolsVersion\s*=\s*"36\.0\.0"'
    'public package' = $appGradle -match 'applicationId\s+"com\.trickee\.gpsdriverapp"'
    'version code 15' = $appGradle -match 'versionCode\s+15(?:\s|$)'
    'version name 1.0.14' = $appGradle -match 'versionName\s+"1\.0\.14"'
    'wrapper timeout 120 seconds' = $wrapperProperties -match '(?m)^networkTimeout=120000\s*$'
    'release fails closed without signing' = $appGradle -match 'GPS Driver release builds require the registered upload key'
    'release fails closed without Firebase unless explicitly waived' = $appGradle -match 'GPS Driver release builds require all TRICKEE_FIREBASE'
    'verified public build script' = $publicBuildScript -match 'SignatureVerified'
    'release verifies configured OAuth audience' = $publicBuildScript -match 'Release Google web client ID does not match'
    'replacement upload certificate' = $publicBuildScript -match '1F:B5:89:39:0D:03:53:49:80:A2:90:B1:80:CE:13:B0:8F:48:07:9A'
    'fine location permission' = $manifest -match 'android\.permission\.ACCESS_FINE_LOCATION'
    'coarse location permission' = $manifest -match 'android\.permission\.ACCESS_COARSE_LOCATION'
    'foreground location service permission' = $manifest -match 'android\.permission\.FOREGROUND_SERVICE_LOCATION'
    'Internet permission' = $manifest -match 'android\.permission\.INTERNET'
    'notification permission' = $manifest -match 'android\.permission\.POST_NOTIFICATIONS'
    'wake-lock permission' = $manifest -match 'android\.permission\.WAKE_LOCK'
    'no background location permission' = $manifest -notmatch 'android\.permission\.ACCESS_BACKGROUND_LOCATION'
    'no microphone permission' = $manifest -notmatch 'android\.permission\.RECORD_AUDIO'
    'no advertising ID permission' = $manifest -notmatch 'com\.google\.android\.gms\.permission\.AD_ID'
}

$failed = @($expectations.GetEnumerator() | Where-Object { -not $_.Value })
if ($failed.Count -gt 0) {
    $names = ($failed | ForEach-Object Key) -join ', '
    throw "GPS Driver public release configuration is incomplete: $names"
}

Write-Output 'GPS Driver release configuration verified: com.trickee.gpsdriverapp, 1.0.14 (15), target SDK 36.'
