[CmdletBinding()]
param(
    [string]$BuildRoot = (Join-Path $env:LOCALAPPDATA 'Trickee\gpsdriver-public-android-build'),
    [string]$WorkingBuildRoot,
    [string]$SigningPropertiesFile,
    [string]$ExpectedUploadSha1 = '1F:B5:89:39:0D:03:53:49:80:A2:90:B1:80:CE:13:B0:8F:48:07:9A',
    [string]$GoogleWebClientId = '1044486768873-7sq9luvpsmkppgod40p5qdtbkbaq6m7q.apps.googleusercontent.com',
    [string]$ApiOrigin = 'https://trickee-pilot-api-pylmkxap6a-el.a.run.app',
    [string]$WebSocketOrigin = 'https://trickee-pilot-websocket-pylmkxap6a-el.a.run.app'
)

$ErrorActionPreference = 'Stop'

function Get-Sha256Hex {
    param([Parameter(Mandatory)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '')
    }
    finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$git = (Get-Command git.exe -ErrorAction Stop).Source
$sourceSha = (& $git -C $repositoryRoot rev-parse HEAD).Trim()
$trackedChanges = @(& $git -C $repositoryRoot status --porcelain --untracked-files=no)
if ($trackedChanges.Count -ne 0) {
    throw 'Public release build requires a clean tracked Git tree.'
}
$androidRoot = Join-Path $repositoryRoot 'mobile\android'
$gradleWrapper = Join-Path $androidRoot 'gradlew.bat'
$publicApplicationId = 'com.trickee.gpsdriverapp'
$normalizedExpectedUploadSha1 = $ExpectedUploadSha1.Trim().ToUpperInvariant()

if (-not $WorkingBuildRoot) {
    $WorkingBuildRoot = Join-Path (Split-Path -Parent $repositoryRoot) '.gpsdriver-public-android-build'
}

if (-not (Test-Path -LiteralPath $gradleWrapper)) {
    throw "Gradle wrapper not found: $gradleWrapper"
}

& (Join-Path $PSScriptRoot 'verify-public-release-config.ps1')

$resolvedBuildRoot = [System.IO.Path]::GetFullPath($BuildRoot)
$resolvedWorkingBuildRoot = [System.IO.Path]::GetFullPath($WorkingBuildRoot)
if ([System.IO.Path]::GetPathRoot($resolvedWorkingBuildRoot) -ne [System.IO.Path]::GetPathRoot($repositoryRoot)) {
    throw 'The Android working build root must be on the same drive as the React Native checkout.'
}
$gradleArguments = @(
    ('-PTRICKEE_ANDROID_BUILD_ROOT="{0}"' -f $resolvedWorkingBuildRoot)
    ('-PTRICKEE_GOOGLE_WEB_CLIENT_ID="{0}"' -f $GoogleWebClientId)
    ('-PTRICKEE_API_ORIGIN="{0}"' -f $ApiOrigin)
    ('-PTRICKEE_WEBSOCKET_ORIGIN="{0}"' -f $WebSocketOrigin)
)
if ($SigningPropertiesFile) {
    if (-not (Test-Path -LiteralPath $SigningPropertiesFile -PathType Leaf)) {
        throw "Signing properties file not found: $SigningPropertiesFile"
    }
    $resolvedSigningPropertiesFile = (Resolve-Path -LiteralPath $SigningPropertiesFile).Path
    $gradleArguments += ('-PTRICKEE_RELEASE_PROPERTIES_FILE="{0}"' -f $resolvedSigningPropertiesFile)
}
$gradleCommand = (
    '"{0}" -p "{1}" bundleRelease assembleRelease {2} --console=plain'
) -f $gradleWrapper, $androidRoot, ($gradleArguments -join ' ')

& cmd.exe /d /s /c $gradleCommand
if ($LASTEXITCODE -ne 0) {
    throw "GPS Driver Gradle release build failed with exit code $LASTEXITCODE."
}

$generatedAab = Join-Path $resolvedWorkingBuildRoot 'app\outputs\bundle\release\app-release.aab'
$generatedApk = Join-Path $resolvedWorkingBuildRoot 'app\outputs\apk\release\app-release.apk'
$manifestRoot = Join-Path $resolvedWorkingBuildRoot 'app\intermediates\merged_manifest\release'
$mergedManifest = Get-ChildItem -LiteralPath $manifestRoot -Recurse -Filter AndroidManifest.xml -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
$buildConfig = Join-Path $resolvedWorkingBuildRoot 'app\generated\source\buildConfig\release\com\trickee\gpsdriver\BuildConfig.java'

if (-not (Test-Path -LiteralPath $generatedAab)) {
    throw "Expected AAB was not generated: $generatedAab"
}
if (-not (Test-Path -LiteralPath $generatedApk)) {
    throw "Expected APK was not generated: $generatedApk"
}
if (-not $mergedManifest -or -not (Test-Path -LiteralPath $mergedManifest)) {
    throw "Expected merged release manifest was not generated under: $manifestRoot"
}
if (-not (Test-Path -LiteralPath $buildConfig)) {
    throw "Expected release BuildConfig was not generated: $buildConfig"
}

[xml]$manifest = Get-Content -LiteralPath $mergedManifest -Raw
$androidNamespace = 'http://schemas.android.com/apk/res/android'
$actualApplicationId = $manifest.manifest.package
$versionCode = $manifest.manifest.GetAttribute('versionCode', $androidNamespace)
$versionName = $manifest.manifest.GetAttribute('versionName', $androidNamespace)
$usesSdk = $manifest.manifest.'uses-sdk'
$targetSdk = $usesSdk.GetAttribute('targetSdkVersion', $androidNamespace)
$permissions = @($manifest.manifest.'uses-permission' | ForEach-Object {
    $_.GetAttribute('name', $androidNamespace)
})

if ($actualApplicationId -ne $publicApplicationId) {
    throw "Wrong package in release manifest. Expected $publicApplicationId, found $actualApplicationId."
}
if ($targetSdk -ne '36') {
    throw "Wrong target SDK in release manifest. Expected 36, found $targetSdk."
}
if ($versionCode -ne '7' -or $versionName -ne '1.0.6') {
    throw "Wrong release version. Expected 1.0.6 (7), found $versionName ($versionCode)."
}
$requiredPermissions = @(
    'android.permission.INTERNET',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_LOCATION',
    'android.permission.WAKE_LOCK',
    'android.permission.POST_NOTIFICATIONS'
)
$missingPermissions = @($requiredPermissions | Where-Object { $permissions -notcontains $_ })
if ($missingPermissions.Count -gt 0) {
    throw "GPS Driver release is missing required permissions: $($missingPermissions -join ', ')."
}
$forbiddenPermissions = @(
    'android.permission.ACCESS_BACKGROUND_LOCATION',
    'android.permission.RECORD_AUDIO',
    'com.google.android.gms.permission.AD_ID'
)
$presentForbiddenPermissions = @($forbiddenPermissions | Where-Object { $permissions -contains $_ })
if ($presentForbiddenPermissions.Count -gt 0) {
    throw "GPS Driver release unexpectedly requests forbidden permissions: $($presentForbiddenPermissions -join ', ')."
}

$buildConfigText = Get-Content -LiteralPath $buildConfig -Raw
$escapedGoogleWebClientId = [regex]::Escape($GoogleWebClientId)
if ($buildConfigText -notmatch ('GOOGLE_WEB_CLIENT_ID\s*=\s*"{0}"' -f $escapedGoogleWebClientId)) {
    throw "Release Google web client ID does not match the configured OAuth audience: $GoogleWebClientId"
}
if ($buildConfigText -notmatch 'API_ORIGIN\s*=\s*"https://') {
    throw 'Release API origin is missing or is not HTTPS.'
}
if ($buildConfigText -notmatch 'WEBSOCKET_ORIGIN\s*=\s*"https://') {
    throw 'Release WebSocket origin is missing or is not HTTPS.'
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$bundleArchive = [System.IO.Compression.ZipFile]::OpenRead($generatedAab)
try {
    $hasBundleManifest = $null -ne ($bundleArchive.Entries | Where-Object {
        $_.FullName -eq 'base/manifest/AndroidManifest.xml'
    } | Select-Object -First 1)
    $hasSignatureFile = $null -ne ($bundleArchive.Entries | Where-Object {
        $_.FullName -match '^META-INF/[^/]+\.SF$'
    } | Select-Object -First 1)
    $hasSignatureBlock = $null -ne ($bundleArchive.Entries | Where-Object {
        $_.FullName -match '^META-INF/[^/]+\.(RSA|DSA|EC)$'
    } | Select-Object -First 1)
    if (-not $hasBundleManifest) {
        throw 'Generated AAB does not contain the base manifest.'
    }
    if (-not ($hasSignatureFile -and $hasSignatureBlock)) {
        throw 'Generated AAB does not contain an Android upload signature.'
    }
}
finally {
    $bundleArchive.Dispose()
}

$jarsigner = Join-Path $env:JAVA_HOME 'bin\jarsigner.exe'
if (-not (Test-Path -LiteralPath $jarsigner)) {
    $jarsigner = (Get-Command jarsigner.exe -ErrorAction Stop).Source
}
& $jarsigner -verify $generatedAab | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Generated AAB failed JAR signature verification.'
}

$keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
if (-not (Test-Path -LiteralPath $keytool)) {
    $keytool = (Get-Command keytool.exe -ErrorAction Stop).Source
}
$certificateText = (& $keytool -printcert -jarfile $generatedAab 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0 -or $certificateText -notmatch 'SHA1:\s*([0-9A-F:]+)') {
    throw 'Unable to read the AAB signing-certificate SHA-1.'
}
$actualUploadSha1 = $Matches[1].ToUpperInvariant()
if ($actualUploadSha1 -ne $normalizedExpectedUploadSha1) {
    throw "Wrong upload certificate. Expected $normalizedExpectedUploadSha1, found $actualUploadSha1."
}

$androidSdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
if (-not $androidSdkRoot) {
    $androidSdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}
$buildToolsRoot = Join-Path $androidSdkRoot 'build-tools'
$buildTools = Get-Item -LiteralPath (Join-Path $buildToolsRoot '36.0.0') -ErrorAction Stop
$apkSigner = Join-Path $buildTools.FullName 'apksigner.bat'
$aapt = Join-Path $buildTools.FullName 'aapt.exe'
if (-not (Test-Path -LiteralPath $apkSigner) -or -not (Test-Path -LiteralPath $aapt)) {
    throw "Android APK verification tools were not found under: $($buildTools.FullName)"
}
$apkSignatureText = (& $apkSigner verify --verbose --print-certs $generatedApk 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0 -or $apkSignatureText -notmatch '(?:Signer #1|V2 Signer):? certificate SHA-1 digest:\s*([0-9a-fA-F]+)') {
    throw 'Generated APK failed Android signature verification.'
}
$actualApkSha1 = (($Matches[1].ToUpperInvariant() -split '(..)' | Where-Object { $_ }) -join ':')
if ($actualApkSha1 -ne $normalizedExpectedUploadSha1) {
    throw "Wrong APK upload certificate. Expected $normalizedExpectedUploadSha1, found $actualApkSha1."
}
$apkBadging = (& $aapt dump badging $generatedApk 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0 -or $apkBadging -notmatch "package: name='$([regex]::Escape($publicApplicationId))' versionCode='$versionCode' versionName='$([regex]::Escape($versionName))'") {
    throw 'Generated APK package or version identity is wrong.'
}
if ($apkBadging -notmatch "targetSdkVersion:'36'" -or $apkBadging -notmatch "launchable-activity: name='com\.trickee\.gpsdriver\.MainActivity'") {
    throw 'Generated APK target SDK or launcher activity is wrong.'
}

$releaseDirectory = Join-Path $resolvedBuildRoot 'release'
New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
$releaseAab = Join-Path $releaseDirectory "Trickee-GPS-Driver-public-$versionName-$versionCode.aab"
$releaseApk = Join-Path $releaseDirectory "Trickee-GPS-Driver-public-$versionName-$versionCode.apk"
Copy-Item -LiteralPath $generatedAab -Destination $releaseAab -Force
Copy-Item -LiteralPath $generatedApk -Destination $releaseApk -Force
$aabSha256 = Get-Sha256Hex -Path $releaseAab
$apkSha256 = Get-Sha256Hex -Path $releaseApk

$releaseMetadata = [ordered]@{
    ApplicationId = $actualApplicationId
    VersionName = $versionName
    VersionCode = [int]$versionCode
    TargetSdk = [int]$targetSdk
    UploadSha1 = $actualUploadSha1
    SourceGitSha = $sourceSha
    Aab = $releaseAab
    AabSha256 = $aabSha256
    Apk = $releaseApk
    ApkSha256 = $apkSha256
    SignatureVerified = $true
}
$metadataPath = Join-Path $releaseDirectory "Trickee-GPS-Driver-public-$versionName-$versionCode.metadata.json"
$releaseMetadata | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding utf8
$releaseMetadata['Metadata'] = $metadataPath
[pscustomobject]$releaseMetadata | Format-List
