[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ApkPath,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ExpectedPackage,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ExpectedSha1
)

$ErrorActionPreference = "Stop"

function Normalize-Fingerprint {
    param([Parameter(Mandatory = $true)][string]$Value)

    return ($Value -replace "[^0-9A-Fa-f]", "").ToUpperInvariant()
}

function Format-Fingerprint {
    param([Parameter(Mandatory = $true)][string]$Value)

    $normalized = Normalize-Fingerprint -Value $Value
    return (($normalized -split "(.{2})" | Where-Object { $_ }) -join ":")
}

$resolvedApk = (Resolve-Path -LiteralPath $ApkPath).Path
$sdkRoot = if ($env:ANDROID_SDK_ROOT) {
    $env:ANDROID_SDK_ROOT
} elseif ($env:ANDROID_HOME) {
    $env:ANDROID_HOME
} else {
    Join-Path $env:LOCALAPPDATA "Android\Sdk"
}

$apkAnalyzer = Join-Path $sdkRoot "cmdline-tools\latest\bin\apkanalyzer.bat"
if (-not (Test-Path -LiteralPath $apkAnalyzer)) {
    throw "apkanalyzer.bat was not found under Android SDK: $sdkRoot"
}

$apkSigner = Get-ChildItem -LiteralPath (Join-Path $sdkRoot "build-tools") -Directory |
    Sort-Object { try { [version]$_.Name } catch { [version]"0.0" } } -Descending |
    ForEach-Object { Join-Path $_.FullName "apksigner.bat" } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
if (-not $apkSigner) {
    throw "apksigner.bat was not found under Android SDK: $sdkRoot"
}

$applicationIdOutput = @(& cmd.exe /d /q /c "`"$apkAnalyzer`" manifest application-id `"$resolvedApk`"" 2>&1)
if ($LASTEXITCODE -ne 0) {
    throw "apkanalyzer failed: $($applicationIdOutput -join [Environment]::NewLine)"
}
$observedPackage = ($applicationIdOutput -join "").Trim()

$certificateOutput = @(& cmd.exe /d /q /c "`"$apkSigner`" verify --print-certs `"$resolvedApk`"" 2>&1)
if ($LASTEXITCODE -ne 0) {
    throw "apksigner failed: $($certificateOutput -join [Environment]::NewLine)"
}
$sha1Match = $certificateOutput | Select-String -Pattern "certificate SHA-1 digest:\s*([0-9A-Fa-f:]+)" | Select-Object -First 1
if (-not $sha1Match) {
    throw "apksigner did not report a SHA-1 certificate digest"
}
$observedSha1 = Normalize-Fingerprint -Value $sha1Match.Matches[0].Groups[1].Value
$normalizedExpectedSha1 = Normalize-Fingerprint -Value $ExpectedSha1

if ($observedPackage -eq "com.trickeeandroid") {
    throw "APK still uses the protected existing application ID: $observedPackage"
}
if ($observedPackage -ne $ExpectedPackage) {
    throw "Application ID mismatch. Expected '$ExpectedPackage', observed '$observedPackage'."
}
if ($observedSha1 -ne $normalizedExpectedSha1) {
    throw "Signing SHA-1 mismatch. Expected '$(Format-Fingerprint -Value $normalizedExpectedSha1)', observed '$(Format-Fingerprint -Value $observedSha1)'."
}

Write-Output "PACKAGE=$observedPackage"
Write-Output "SIGNER_SHA1=$(Format-Fingerprint -Value $observedSha1)"
Write-Output "ANDROID_IDENTITY_OK"
