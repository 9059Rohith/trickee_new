param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Label,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$OutputDirectory,

    [string]$Package = "com.trickee.gpsdriverapp",
    [string]$Activity = "com.trickee.gpsdriver.MainActivity",
    [ValidateRange(1, 20)]
    [int]$LaunchCount = 5,
    [ValidateRange(0, 3600)]
    [int]$MemoryObservationSeconds = 600
)

$ErrorActionPreference = "Stop"
$adb = Get-Command adb -ErrorAction SilentlyContinue
if (-not $adb) {
    $sdkAdb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
    if (-not (Test-Path -LiteralPath $sdkAdb)) {
        throw "adb was not found on PATH or in the standard Android SDK location."
    }
    $adbPath = $sdkAdb
} else {
    $adbPath = $adb.Source
}

$devices = @(& $adbPath devices | Select-Object -Skip 1 | Where-Object { $_ -match "\tdevice$" })
if ($devices.Count -ne 1) {
    throw "Expected exactly one ready ADB target, found $($devices.Count)."
}

$serial = ($devices[0] -split "\t")[0]
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$component = "$Package/$Activity"
$target = [ordered]@{
    label = $Label
    captured_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    serial = $serial
    manufacturer = (& $adbPath -s $serial shell getprop ro.product.manufacturer).Trim()
    model = (& $adbPath -s $serial shell getprop ro.product.model).Trim()
    sdk = (& $adbPath -s $serial shell getprop ro.build.version.sdk).Trim()
    package = $Package
    activity = $Activity
}
$target | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory "$Label-target.json") -Encoding utf8

$launches = for ($index = 1; $index -le $LaunchCount; $index++) {
    & $adbPath -s $serial shell am force-stop $Package | Out-Null
    Start-Sleep -Milliseconds 750
    $raw = (& $adbPath -s $serial shell am start -W -n $component 2>&1) -join "`n"
    $raw | Set-Content -LiteralPath (Join-Path $OutputDirectory "$Label-launch-$index.txt") -Encoding utf8
    [pscustomobject]@{
        label = $Label
        run = $index
        total_time_ms = [int]([regex]::Match($raw, "TotalTime:\s*(\d+)").Groups[1].Value)
        wait_time_ms = [int]([regex]::Match($raw, "WaitTime:\s*(\d+)").Groups[1].Value)
    }
}
$launches | Export-Csv -LiteralPath (Join-Path $OutputDirectory "$Label-launches.csv") -NoTypeInformation

& $adbPath -s $serial shell dumpsys gfxinfo $Package reset | Out-Null
Start-Sleep -Seconds 5
$gfx = (& $adbPath -s $serial shell dumpsys gfxinfo $Package framestats 2>&1) -join "`n"
$gfx | Set-Content -LiteralPath (Join-Path $OutputDirectory "$Label-gfxinfo.txt") -Encoding utf8

$memoryBefore = (& $adbPath -s $serial shell dumpsys meminfo --local $Package 2>&1) -join "`n"
$memoryBefore | Set-Content -LiteralPath (Join-Path $OutputDirectory "$Label-meminfo-before.txt") -Encoding utf8
$remaining = $MemoryObservationSeconds
while ($remaining -gt 0) {
    $slice = [Math]::Min(30, $remaining)
    Start-Sleep -Seconds $slice
    $remaining -= $slice
}
$memoryAfter = (& $adbPath -s $serial shell dumpsys meminfo --local $Package 2>&1) -join "`n"
$memoryAfter | Set-Content -LiteralPath (Join-Path $OutputDirectory "$Label-meminfo-after.txt") -Encoding utf8

$sorted = @($launches.total_time_ms | Sort-Object)
$median = if ($sorted.Count % 2 -eq 1) {
    $sorted[[Math]::Floor($sorted.Count / 2)]
} else {
    ($sorted[$sorted.Count / 2 - 1] + $sorted[$sorted.Count / 2]) / 2
}
[pscustomobject]@{
    label = $Label
    serial = $serial
    model = $target.model
    sdk = $target.sdk
    launch_count = $LaunchCount
    median_total_time_ms = $median
    memory_observation_seconds = $MemoryObservationSeconds
    output_directory = (Resolve-Path $OutputDirectory).Path
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory "$Label-summary.json") -Encoding utf8

Write-Output "Performance capture complete: $Label (median TotalTime ${median}ms)"
