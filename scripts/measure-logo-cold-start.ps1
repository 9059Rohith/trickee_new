param(
  [int]$Runs = 20,
  [string]$Serial = "emulator-5554"
)

$ErrorActionPreference = "Stop"
$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path -LiteralPath $adb)) { throw "Android SDK adb not found" }
$isEmulator = (& $adb -s $Serial shell getprop ro.kernel.qemu).Trim()
if ($isEmulator -ne "1") { throw "Cold-start reset is restricted to an emulator; $Serial is not one" }

$package = "com.trickee.gpsdriverapp"
$activity = "$package/com.trickee.gpsdriver.MainActivity"
$evidence = Join-Path (Split-Path -Parent $PSScriptRoot) "docs\device-evidence"
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
$rows = New-Object System.Collections.Generic.List[object]

for ($run = 1; $run -le $Runs; $run++) {
  $cleared = (& $adb -s $Serial shell pm clear $package | Out-String).Trim()
  if ($cleared -ne "Success") { throw "Run $run: app reset failed: $cleared" }
  & $adb -s $Serial logcat -c | Out-Null
  $launch = & $adb -s $Serial shell am start -W -n $activity | Out-String
  if ($LASTEXITCODE -ne 0) { throw "Run $run: launch failed: $launch" }
  Start-Sleep -Milliseconds 5500
  $crashes = & $adb -s $Serial logcat -d -s AndroidRuntime:E ReactNativeJS:E | Out-String
  $hasCrash = $crashes -match "FATAL EXCEPTION|ReactNativeJS.*Error:|Unable to load script"
  $total = [regex]::Match($launch, "TotalTime:\s*(\d+)").Groups[1].Value
  $rows.Add([pscustomobject]@{ Run = $run; TotalTimeMs = $total; Crash = $hasCrash })
  if ($run -eq 1 -or $run -eq $Runs) {
    $remote = "/sdcard/trickee-logo-cold-start.png"
    & $adb -s $Serial shell screencap -p $remote | Out-Null
    & $adb -s $Serial pull $remote (Join-Path $evidence "cold-start-$run.png") | Out-Null
  }
  Write-Output "Cold start $run/$Runs — ${total}ms, crash=$hasCrash"
}

$rows | Export-Csv -LiteralPath (Join-Path $evidence "cold-start.csv") -NoTypeInformation
if ($rows.Where({ $_.Crash }).Count -gt 0) { throw "One or more cold starts logged a crash" }
