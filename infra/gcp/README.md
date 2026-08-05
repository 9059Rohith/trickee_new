# Trickee Google Cloud telemetry topology

This Terraform module creates the production shape for 150 vehicles: regional
Cloud SQL for PostgreSQL 16 with private IP, HA and point-in-time recovery;
private TLS Memorystore; separate Cloud Run services for HTTP, WebSocket,
outbox relay and each processor; one-shot migration/archive/retention jobs; a
private versioned archive bucket; Secret Manager; Artifact Registry; and
role-specific service accounts.

No credentials, secret values, Terraform state, or service-account keys belong
in this repository. Supply sensitive variables through the company CI secret
store. Use an immutable `image` value containing `@sha256:`. Create and review a
saved plan before apply:

```powershell
python .\validate_architecture.py
terraform init -backend-config=bucket=COMPANY_TF_STATE_BUCKET -backend-config=prefix=trickee/production
terraform fmt -check
terraform validate
terraform plan -out=trickee.tfplan
terraform apply trickee.tfplan
```

Initialize the empty `gcs` backend with a company-owned, versioned, access-
logged state bucket and environment-specific prefix, for example
`-backend-config=bucket=... -backend-config=prefix=trickee/production`.
Sensitive input values still exist in encrypted Terraform state; restrict that
bucket to the deployment service account and break-glass operators.

Run the `migrate` Cloud Run Job once before shifting traffic. API replicas never
run migrations. Validate Cloud SQL restore into a new instance and archive
restore-and-compare before recording Gate 3 as complete.
