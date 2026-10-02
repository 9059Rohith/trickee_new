# Standalone GPS Driver Android Identity Design

**Date:** 2026-08-07

**Status:** Approved for implementation

**Repository:** `gpsdriver`

**Existing application excluded from scope:** `com.trickeeandroid`

## Goal

Make the Android client in this repository a separately installable GPS-driver application. Installing, uninstalling, authenticating, or updating it must not replace, share application-private data with, or modify the existing `com.trickeeandroid` application.

## Selected identity

| Field | Standalone GPS Driver value |
|---|---|
| Product name | Trickee GPS Driver |
| Android application ID | `com.trickee.gpsdriver` |
| Android namespace | `com.trickee.gpsdriver` |
| Kotlin root package | `com.trickee.gpsdriver` |
| React Native project name | `TrickeeGPSDriver` |
| Foreground-service action prefix | `com.trickee.gpsdriver.telemetry` |
| OAuth Android package | `com.trickee.gpsdriver` |

The repository-owned debug keystore is used only for development and pilot APKs. Its current SHA-1 is:

`E0:D0:81:A8:B0:1A:88:50:20:00:BF:93:BD:18:B2:91:97:9A:61:1B`

A production OAuth Android client must later use the SHA-1 fingerprint of the company release or Google Play app-signing certificate. The debug OAuth client is not production release evidence.

## Isolation boundaries

The implementation will change the Gradle `applicationId` and `namespace`, all Kotlin package declarations and imports, the Java/Kotlin directory layout, service intent action strings, launcher labels, and React Native application/display names.

Android application-private storage, Room data, preferences, credentials, notification ownership, process identity, and upgrade history are keyed by application ID. Therefore `com.trickee.gpsdriver` and `com.trickeeandroid` can be installed side by side without sharing or overwriting private state.

The backend remains shared infrastructure. Isolation at the backend continues to come from authenticated human/device identities, vehicle assignments, and trip IDs—not from the Android package name.

## OAuth design

Google authentication uses two distinct OAuth clients in the company GCP project:

1. A Web application client used as the Android Credential Manager server client ID and backend ID-token audience.
2. An Android client restricted to package `com.trickee.gpsdriver` and the exact signing-certificate SHA-1.

No OAuth client for `com.trickeeandroid` will be created, edited, or reused for the standalone app. Client secrets are not embedded in Android or committed to this repository. The Web client ID is public build configuration; the backend receives the same audience through Secret Manager.

## Implementation sequence

1. Add a repository identity contract test that resolves the built manifest/application ID and fails while it is still `com.trickeeandroid`.
2. Rename Gradle identity, Kotlin packages/directories/imports, service actions, and application labels.
3. Build and run Android unit tests, manifest processing, lint/static reference scans, and a debug APK assembly.
4. Verify the generated APK reports package `com.trickee.gpsdriver` and the expected signing fingerprint.
5. Create the matching Web and Android OAuth clients, then inject the Web client ID into both Android and backend deployment configuration.
6. Install the pilot APK alongside the existing application and record physical-device evidence that both packages coexist.

## Failure handling

- Any remaining `com.trickeeandroid` reference in executable Android source, Gradle identity, or service action configuration fails the identity gate.
- A signing fingerprint mismatch blocks OAuth client creation or login certification; it is not bypassed.
- A generated APK with an unexpected application ID is rejected before installation or cloud deployment.
- Existing OAuth clients and the existing application are treated as read-only external resources.

## Acceptance criteria

- Gradle and the packaged APK identify the app as `com.trickee.gpsdriver`.
- No executable Android source or manifest component resolves to `com.trickeeandroid`.
- Kotlin unit tests and debug APK assembly complete successfully.
- The APK signature SHA-1 is recorded and matches the OAuth Android client configuration.
- `adb` can list both `com.trickeeandroid` and `com.trickee.gpsdriver` after side-by-side installation on a physical pilot device.
- Google sign-in returns a token whose audience matches the standalone app's configured Web client ID and is accepted by the deployed backend.
- No existing `com.trickeeandroid` source tree, OAuth client, installation, or cloud resource is modified by this change.

## Explicit non-goals

- Migrating data from `com.trickeeandroid` into the GPS Driver app.
- Reusing the existing application's OAuth Android client.
- Claiming production Play Store readiness from a debug certificate.
- Claiming the two-device trip gate complete without physical-device evidence.
