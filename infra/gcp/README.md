# Trickee Google Cloud telemetry topology

This Terraform module creates the production shape for 150 vehicles: regional
Cloud SQL for PostgreSQL 16 with private IP, HA and point-in-time recovery;
private TLS Memorystore; separate Cloud Run services for HTTP, WebSocket,
outbox relay and each processor; one-shot migration/archive/retention jobs; a
private versioned archive bucket; Secret Manager; Artifact Registry; and
role-specific service accounts.

The `notification-fcm` service claims due notification-outbox rows and sends
high-priority, data-only FCM messages with Application Default Credentials.
The Android build must receive `TRICKEE_FIREBASE_API_KEY`,
`TRICKEE_FIREBASE_APP_ID`, `TRICKEE_FIREBASE_PROJECT_ID`, and
`TRICKEE_FIREBASE_SENDER_ID` as Gradle properties. Firebase must first be added
to this Google Cloud project and the Android app must be registered for
`com.trickee.gpsdriverapp`; otherwise the app deliberately reports push as
unconfigured instead of crashing.

No credentials, secret values, Terraform state, or service-account keys belong
in this repository. Supply sensitive variables through the company CI secret
store. Use an immutable `image` value containing `@sha256:`.

## Two-stage first deployment

The first deployment cannot reference an image digest until Artifact Registry
exists. Provide all required inputs through a private CI variable source, then
bootstrap only the APIs and registry (the temporary digest is parsed but no
Cloud Run resource is targeted):

```powershell
terraform init -backend-config=bucket=COMPANY_TF_STATE_BUCKET -backend-config=prefix=trickee/production
terraform apply `
  -target=google_project_service.required `
  -target=google_artifact_registry_repository.images `
  -var='image=asia-south1-docker.pkg.dev/PROJECT/trickee/backend@sha256:0000000000000000000000000000000000000000000000000000000000000000'
```

Build and push `backend/Dockerfile`, resolve the registry-reported digest, and
set `image` to that exact `name@sha256:...` value. Then create and review the
complete saved plan before apply:

```powershell
python .\validate_architecture.py
terraform init -backend-config=bucket=COMPANY_TF_STATE_BUCKET -backend-config=prefix=trickee/production
terraform fmt -check
terraform validate
terraform plan -out=trickee.tfplan
terraform apply trickee.tfplan
```

After the full apply, execute `google_cloud_run_v2_job.job["migrate"]` once.
Only then shift traffic to the API and WebSocket outputs. Android release builds
must use `api_url` as `TRICKEE_API_ORIGIN` and `websocket_url` as
`TRICKEE_WEBSOCKET_ORIGIN`.

For a Metro-independent, debug-certificate-signed two-device artifact, build
the `pilot` variant. Pass properties through Gradle's environment convention on
PowerShell so long OAuth IDs are not split into command-line tokens:

```powershell
$env:ORG_GRADLE_PROJECT_TRICKEE_GOOGLE_WEB_CLIENT_ID = "WEB_CLIENT_ID.apps.googleusercontent.com"
$env:ORG_GRADLE_PROJECT_TRICKEE_API_ORIGIN = "https://API_RUN_URL"
$env:ORG_GRADLE_PROJECT_TRICKEE_WEBSOCKET_ORIGIN = "https://WEBSOCKET_RUN_URL"
.\gradlew.bat :app:testPilotUnitTest :app:assemblePilot
```

The pilot APK uses `com.trickee.gpsdriver` and the debug certificate registered
for the Android OAuth client. Store/production distribution must use the
company release keystore or Play App Signing certificate and a matching Android
OAuth client; do not reuse the pilot certificate as a production trust root.

Initialize the empty `gcs` backend with a company-owned, versioned, access-
logged state bucket and environment-specific prefix, for example
`-backend-config=bucket=... -backend-config=prefix=trickee/production`.
Sensitive input values still exist in encrypted Terraform state; restrict that
bucket to the deployment service account and break-glass operators.

Run the `migrate` Cloud Run Job once before shifting traffic. API replicas never
run migrations. Validate Cloud SQL restore into a new instance and archive
restore-and-compare before recording Gate 3 as complete.
