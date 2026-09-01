[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $repositoryRoot 'mobile\android'
$debugKeystore = Join-Path $androidRoot 'app\debug.keystore'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("gpsdriver-signing-test-{0}" -f [guid]::NewGuid())
$propertiesFile = Join-Path $temporaryRoot 'signing.properties'

try {
    New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
    $keystorePath = $debugKeystore.Replace('\', '/')
    @(
        "storeFile=$keystorePath"
        'storePassword=android'
        'keyAlias=androiddebugkey'
        'keyPassword=android'
    ) | Set-Content -LiteralPath $propertiesFile -Encoding ascii

    $output = & (Join-Path $androidRoot 'gradlew.bat') `
        -p $androidRoot `
        ':app:signingReport' `
        "-PTRICKEE_RELEASE_PROPERTIES_FILE=$propertiesFile" `
        '--console=plain' 2>&1 | Out-String

    if ($LASTEXITCODE -ne 0) {
        throw "Gradle signing report failed:`n$output"
    }
    if ($output -notmatch '(?s)Variant:\s+release.*?Config:\s+release.*?Alias:\s+androiddebugkey') {
        throw "Release signing did not load the external properties file:`n$output"
    }

    Write-Output 'External release signing properties verified.'
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        $resolvedTemporaryRoot = (Resolve-Path -LiteralPath $temporaryRoot).Path
        $resolvedSystemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
        if (-not $resolvedTemporaryRoot.StartsWith($resolvedSystemTemp + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Unsafe temporary cleanup target: $resolvedTemporaryRoot"
        }
        Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
    }
}
