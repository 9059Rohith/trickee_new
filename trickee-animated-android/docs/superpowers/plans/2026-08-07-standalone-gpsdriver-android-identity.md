# Standalone GPS Driver Android Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the copied Android client into the independently installable `com.trickee.gpsdriver` application without changing or reusing the existing `com.trickeeandroid` application identity.

**Architecture:** Perform a complete identity cut at the Android application, namespace, Kotlin package, React Native component, launcher label, service-action, and OAuth boundaries. Preserve the existing FastAPI/GCP backend contract, but create a new Android OAuth restriction and use a Web OAuth client ID as the shared Android/backend token audience. Prove isolation using a failing unit contract first, then the built APK manifest and signing certificate.

**Tech Stack:** React Native 0.80.3, Kotlin, Android Gradle Plugin, JUnit 4, Android SDK `apkanalyzer`/`apksigner`, PowerShell, Google Auth Platform.

## Global Constraints

- Product name is `Trickee GPS Driver`.
- Android application ID, namespace, and Kotlin root package are `com.trickee.gpsdriver`.
- React Native project/component name is `TrickeeGPSDriver`.
- Foreground-service actions use the `com.trickee.gpsdriver.telemetry` prefix.
- The existing `com.trickeeandroid` installation, source repository, OAuth clients, and private data are read-only and outside this change.
- Development OAuth restriction uses SHA-1 `E0:D0:81:A8:B0:1A:88:50:20:00:BF:93:BD:18:B2:91:97:9A:61:1B`.
- A release or Play-distributed build requires its own company release/Play signing SHA-1; debug evidence does not certify production signing.
- Client secrets are never embedded in Android, printed, or committed.
- Existing dirty worktree changes are preserved; each commit stages only files listed in its task.

---

## File Structure

- `mobile/android/app/src/main/java/com/trickee/gpsdriver/**`: relocated Kotlin application and telemetry implementation under the standalone namespace.
- `mobile/android/app/src/test/java/com/trickee/gpsdriver/**`: relocated JVM tests plus the application identity contract.
- `mobile/android/app/src/androidTest/java/com/trickee/gpsdriver/**`: relocated Room instrumentation test.
- `mobile/android/app/build.gradle`: authoritative namespace and application ID.
- `mobile/android/app/src/main/AndroidManifest.xml`: standalone launcher and application labels; component names remain namespace-relative.
- `mobile/android/settings.gradle`: standalone Android project name.
- `mobile/app.json`, `mobile/package.json`, `mobile/package-lock.json`: aligned React Native component/package name and user-visible name.
- `scripts/verify-android-identity.ps1`: executable APK package/signature verification gate.
- `scripts/start-local.ps1`: launches only `com.trickee.gpsdriver`.
- `DEVELOPER_HANDOFF.md`: current standalone build/OAuth instructions while retaining historical evidence as historical.

### Task 1: Failing application identity contract and complete namespace cut

**Files:**
- Create, then relocate: `mobile/android/app/src/test/java/com/trickeeandroid/AppIdentityTest.kt` to `mobile/android/app/src/test/java/com/trickee/gpsdriver/AppIdentityTest.kt`
- Move: `mobile/android/app/src/main/java/com/trickeeandroid/**` to `mobile/android/app/src/main/java/com/trickee/gpsdriver/**`
- Move: `mobile/android/app/src/test/java/com/trickeeandroid/telemetry/**` to `mobile/android/app/src/test/java/com/trickee/gpsdriver/telemetry/**`
- Move: `mobile/android/app/src/androidTest/java/com/trickeeandroid/**` to `mobile/android/app/src/androidTest/java/com/trickee/gpsdriver/**`
- Modify: `mobile/android/app/build.gradle`
- Modify: `mobile/android/app/src/main/AndroidManifest.xml`
- Modify: `mobile/android/settings.gradle`
- Modify: `mobile/app.json`
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`

**Interfaces:**
- Consumes: current `BuildConfig.APPLICATION_ID`, `TripCollectorService.ACTION_START`, and `TripCollectorService.ACTION_STOP`.
- Produces: package `com.trickee.gpsdriver`; actions `com.trickee.gpsdriver.telemetry.START` and `com.trickee.gpsdriver.telemetry.STOP`; React component `TrickeeGPSDriver`.

- [ ] **Step 1: Write the failing identity test in the current namespace**

```kotlin
package com.trickeeandroid

import com.trickeeandroid.telemetry.collector.TripCollectorService
import org.junit.Assert.assertEquals
import org.junit.Test

class AppIdentityTest {
    @Test
    fun applicationIdBelongsToStandaloneGpsDriver() {
        assertEquals("com.trickee.gpsdriver", BuildConfig.APPLICATION_ID)
    }

    @Test
    fun collectorActionsAreScopedToStandaloneGpsDriver() {
        assertEquals("com.trickee.gpsdriver.telemetry.START", TripCollectorService.ACTION_START)
        assertEquals("com.trickee.gpsdriver.telemetry.STOP", TripCollectorService.ACTION_STOP)
    }
}
```

- [ ] **Step 2: Run the contract and verify RED**

Run from `mobile/android`:

```powershell
.\gradlew.bat :app:testDebugUnitTest --tests com.trickeeandroid.AppIdentityTest --offline --no-daemon
```

Expected: tests compile, then fail because the application ID and action strings still begin with `com.trickeeandroid`.

- [ ] **Step 3: Apply the complete identity rename**

Change Gradle to:

```groovy
namespace "com.trickee.gpsdriver"
defaultConfig {
    applicationId "com.trickee.gpsdriver"
}
```

Move all three Android source-set trees to the `com/trickee/gpsdriver` path, replace Kotlin package/import roots with `com.trickee.gpsdriver`, and change the collector constants to:

```kotlin
const val ACTION_START = "com.trickee.gpsdriver.telemetry.START"
const val ACTION_STOP = "com.trickee.gpsdriver.telemetry.STOP"
```

Relocate the identity test and change its package/imports to `com.trickee.gpsdriver`. Set both manifest launcher labels to `Trickee GPS Driver`. Change the React component name in `MainActivity.kt`, `mobile/app.json`, `mobile/package.json`, and both package-lock root entries to `TrickeeGPSDriver`; set `app.json.displayName` to `Trickee GPS Driver`; set `rootProject.name` to `TrickeeGPSDriver`.

- [ ] **Step 4: Run the identity test and verify GREEN**

```powershell
.\gradlew.bat :app:testDebugUnitTest --tests com.trickee.gpsdriver.AppIdentityTest --offline --no-daemon
```

Expected: both identity tests pass.

- [ ] **Step 5: Run all Android JVM tests**

```powershell
.\gradlew.bat :app:testDebugUnitTest --offline --no-daemon
```

Expected: `BUILD SUCCESSFUL` with zero failed tests.

- [ ] **Step 6: Commit only the identity cut**

```powershell
git add -- mobile/android/app/build.gradle mobile/android/app/src/main/AndroidManifest.xml mobile/android/settings.gradle mobile/app.json mobile/package.json mobile/package-lock.json mobile/android/app/src/main/java/com/trickee/gpsdriver mobile/android/app/src/test/java/com/trickee/gpsdriver mobile/android/app/src/androidTest/java/com/trickee/gpsdriver
git add -u -- mobile/android/app/src/main/java/com/trickeeandroid mobile/android/app/src/test/java/com/trickeeandroid mobile/android/app/src/androidTest/java/com/trickeeandroid
git commit -m "refactor(android): isolate gpsdriver application identity"
```

### Task 2: Built APK identity and signature gate

**Files:**
- Create: `scripts/verify-android-identity.ps1`
- Test artifact: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`

**Interfaces:**
- Consumes: APK path, expected application ID, and expected SHA-1.
- Produces: exit code `0` plus `ANDROID_IDENTITY_OK`; any mismatch exits nonzero with the observed value.

- [ ] **Step 1: Add the executable verification script**

The script must resolve `apkanalyzer.bat` from `cmdline-tools/latest/bin` and `apksigner.bat` from the newest SDK build-tools directory. It must call:

```powershell
& $apkAnalyzer manifest application-id $ApkPath
& $apkSigner verify --print-certs $ApkPath
```

It must normalize fingerprint separators/case, compare the application ID to `com.trickee.gpsdriver`, compare the signer SHA-1 to `E0:D0:81:A8:B0:1A:88:50:20:00:BF:93:BD:18:B2:91:97:9A:61:1B`, reject `com.trickeeandroid`, and print only non-secret identity evidence.

- [ ] **Step 2: Compile tests, manifest, and APK**

Run from `mobile/android`:

```powershell
.\gradlew.bat :app:testDebugUnitTest :app:compileDebugAndroidTestKotlin :app:assembleDebug --offline --no-daemon
```

Expected: `BUILD SUCCESSFUL` and `app-debug.apk` exists.

- [ ] **Step 3: Verify the packaged identity and signer**

Run from repository root:

```powershell
.\scripts\verify-android-identity.ps1 -ApkPath .\mobile\android\app\build\outputs\apk\debug\app-debug.apk -ExpectedPackage com.trickee.gpsdriver -ExpectedSha1 E0:D0:81:A8:B0:1A:88:50:20:00:BF:93:BD:18:B2:91:97:9A:61:1B
```

Expected: `ANDROID_IDENTITY_OK`, the standalone package, and the normalized expected SHA-1.

- [ ] **Step 4: Prove the gate rejects the old package**

```powershell
.\scripts\verify-android-identity.ps1 -ApkPath .\mobile\android\app\build\outputs\apk\debug\app-debug.apk -ExpectedPackage com.trickeeandroid -ExpectedSha1 E0:D0:81:A8:B0:1A:88:50:20:00:BF:93:BD:18:B2:91:97:9A:61:1B
if ($LASTEXITCODE -eq 0) { throw 'Identity gate accepted the old package' }
```

Expected: nonzero exit with an application-ID mismatch.

- [ ] **Step 5: Commit the reusable gate**

```powershell
git add -- scripts/verify-android-identity.ps1
git commit -m "test(android): verify standalone APK identity"
```

### Task 3: Local launcher and developer contract

**Files:**
- Modify: `scripts/start-local.ps1`
- Modify: `DEVELOPER_HANDOFF.md`

**Interfaces:**
- Consumes: installed standalone debug APK.
- Produces: local launcher targets only `com.trickee.gpsdriver`; handoff contains exact OAuth/package/signing values.

- [ ] **Step 1: Change local Android launch commands**

Replace the active `adb` package in `scripts/start-local.ps1` with:

```powershell
& adb shell am force-stop com.trickee.gpsdriver
& adb shell monkey -p com.trickee.gpsdriver -c android.intent.category.LAUNCHER 1 | Out-Null
```

- [ ] **Step 2: Update current handoff instructions**

Document `com.trickee.gpsdriver`, `Trickee GPS Driver`, the debug SHA-1, the Web-client-as-server-client-ID contract, and the identity verification command. Keep the prior `com.trickeeandroid` emulator result explicitly labeled historical rather than rewriting past evidence.

- [ ] **Step 3: Verify active references**

```powershell
rg -n "com\.trickeeandroid|TrickeeGPSFirst" mobile scripts/start-local.ps1 DEVELOPER_HANDOFF.md
```

Expected: no match in executable mobile sources or the active launcher. Any handoff match must be explicitly marked as historical or excluded-scope context.

- [ ] **Step 4: Commit documentation and launcher changes**

```powershell
git add -- scripts/start-local.ps1 DEVELOPER_HANDOFF.md
git commit -m "docs(android): hand off standalone gpsdriver identity"
```

### Task 4: Standalone OAuth clients and deployment input

**Files:**
- No OAuth credential files are created in the repository.
- Verify existing configuration: `mobile/android/app/build.gradle`
- Verify existing backend audience configuration: `infra/gcp/main.tf`, `infra/gcp/variables.tf`

**Interfaces:**
- Consumes: company GCP project `trickee-jaswanth-pilot`, Android package/signature values, and the Web OAuth client ID copied from Google Auth Platform.
- Produces: a standalone Android OAuth restriction and one shared Web client ID supplied to Android build configuration and backend Secret Manager/Terraform input.

- [ ] **Step 1: Create or select the Web OAuth client**

In Google Auth Platform for project `trickee-jaswanth-pilot`, create a Web application client named `Trickee GPS Driver Server`. Credential Manager uses its client ID as the server client ID and backend audience. Do not copy or send its client secret.

- [ ] **Step 2: Create the Android OAuth client**

Create an Android client named `Trickee GPS Driver Debug` with:

```text
Package: com.trickee.gpsdriver
SHA-1: E0:D0:81:A8:B0:1A:88:50:20:00:BF:93:BD:18:B2:91:97:9A:61:1B
```

Do not edit or reuse a `com.trickeeandroid` client.

- [ ] **Step 3: Validate the Web client ID format without exposing secrets**

Place the copied public client ID in the current PowerShell process:

```powershell
$env:TRICKEE_GOOGLE_WEB_CLIENT_ID = Read-Host 'Paste the Web OAuth client ID'
if ($env:TRICKEE_GOOGLE_WEB_CLIENT_ID -notmatch '^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$') { throw 'Invalid Google Web OAuth client ID' }
```

- [ ] **Step 4: Build Android with the exact OAuth audience**

Run from `mobile/android`:

```powershell
.\gradlew.bat :app:assembleDebug -PTRICKEE_GOOGLE_WEB_CLIENT_ID=$env:TRICKEE_GOOGLE_WEB_CLIENT_ID --offline --no-daemon
```

Expected: `BUILD SUCCESSFUL`; no client secret appears in Gradle inputs or generated Android configuration.

- [ ] **Step 5: Resume the reviewed GCP deployment**

Use the same Web client ID as Terraform variable `google_oauth_client_id`, generate fresh database/JWT secret material outside the repository, generate a saved Terraform plan using the already-pushed immutable image digest, and require `0` deletes before apply. Execute the migration job, verify Cloud Run health, then configure the Android API/WebSocket origins from Terraform outputs.

- [ ] **Step 6: Record external evidence honestly**

Record Google sign-in and side-by-side installation only after a physical device shows both package IDs and the backend accepts the ID token. Keep two-device uninterrupted-trip, failover/restore, and 150-device load certification pending until those gates are physically executed.

## Final Verification

Run fresh from repository root:

```powershell
Push-Location mobile\android
.\gradlew.bat :app:testDebugUnitTest :app:compileDebugAndroidTestKotlin :app:assembleDebug --offline --no-daemon
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Pop-Location
.\scripts\verify-android-identity.ps1 -ApkPath .\mobile\android\app\build\outputs\apk\debug\app-debug.apk -ExpectedPackage com.trickee.gpsdriver -ExpectedSha1 E0:D0:81:A8:B0:1A:88:50:20:00:BF:93:BD:18:B2:91:97:9A:61:1B
rg -n "com\.trickeeandroid|TrickeeGPSFirst" mobile scripts/start-local.ps1
if ($LASTEXITCODE -eq 0) { throw 'Old Android identity remains in active files' }
```

The repository portion is complete only if Gradle exits `0`, the APK identity gate prints `ANDROID_IDENTITY_OK`, and the old-identity scan returns no matches. OAuth/deployment and side-by-side device certification remain separate external gates until observed.
