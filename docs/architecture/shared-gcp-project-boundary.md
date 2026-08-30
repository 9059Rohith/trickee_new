# GPS Driver Shared Google Cloud Project Boundary

**Recorded:** 2026-08-30

## Decision

GPS Driver may remain in the shared `trickee-jaswanth-pilot` Google Cloud
project for Play internal testing. The current infrastructure design gives GPS
Driver dedicated runtime and storage resources, so sharing the project does
not inherently mix its application data with the other Trickee applications.

A dedicated GPS Driver production project and a separate staging project are
recommended before public rollout, customer onboarding, or material traffic.
The shared pilot project is an operating convenience, not the intended
long-term security boundary.

## What Breaks First

The first shared-project risks are operational boundaries rather than database
row collisions:

1. Project-level IAM changes can affect every application in the project.
2. Cloud Run and API quotas are shared by project and region, so load from one
   application can constrain another.
3. Billing, budgets, alerts, and cost attribution are harder to assign to a
   single product.
4. OAuth branding, consent configuration, and some API quotas are shared at
   project level even when applications use separate OAuth clients.
5. Independent Terraform stacks can conflict if they share resource names or
   state.
6. A compromised project owner or editor has a larger blast radius.

## Current GPS Driver Isolation

The repository configuration and the deployment evidence dated 2026-08-07
describe the following GPS Driver-specific resources in `asia-south1`:

| Layer | GPS Driver boundary |
| --- | --- |
| Cloud Run | Services and jobs use the `trickee-pilot-*` prefix |
| PostgreSQL | Dedicated Cloud SQL instance `trickee-pilot-postgres`, database `trickee`, and user `trickee_app` |
| Redis | Dedicated `trickee-pilot-redis` instance with private networking and TLS |
| Archive | Private `gs://trickee-jaswanth-pilot-trickee-pilot-telemetry-archive` bucket |
| Secrets | Secrets use the `trickee-pilot-*` prefix and resource-level access grants |
| Runtime identity | Separate service account for each API, worker, and job role |
| Network | Dedicated serverless connector and private service access configuration |
| Android identity | Package `com.trickee.gpsdriverapp` and its own OAuth clients and signing configuration |

The API and WebSocket gateways are public invokers by design. Worker services
remain internal. Cloud SQL, Cloud Run services, and Cloud Run jobs use deletion
protection in the Terraform design. The archive bucket prevents public access,
uses uniform bucket-level access, and enables object versioning.

This separation prevents accidental data mixing during normal operation. It
does not override permissions held by project owners, editors, inherited
organization roles, or other project-wide principals.

## Required Shared-Project Safeguards

The internal pilot remains acceptable only while all of these controls hold:

- GPS Driver has its own database instance, database credentials, Redis
  instance, bucket, secrets, service accounts, OAuth clients, and runtime
  services.
- No other application receives access to GPS Driver secrets or the telemetry
  archive bucket.
- GPS Driver service accounts are not reused by another application.
- Every Terraform environment has a unique remote-state prefix; state files
  are never shared between applications.
- Resource names remain application- and environment-prefixed.
- Deployment plans are reviewed for unexpected deletes, replacements, IAM
  changes, and resource adoption before apply.
- Cloud Run, Cloud SQL, Redis, VPC, and relevant API quotas are monitored at
  project and `asia-south1` levels.
- Budget alerts and resource labels identify GPS Driver costs separately.
- Project-level owner and editor membership is minimized and audited.
- The GPS Driver Android and web OAuth clients retain the correct package,
  certificate, redirect-origin, and audience restrictions.
- Production secrets are not copied into Git, mobile binaries, logs, or other
  applications.

## Known IAM Limitation

The current Terraform grants `roles/cloudsql.client` to GPS Driver runtime
service accounts at project level. Google Cloud IAM does not make this grant a
database-password grant, and the application still requires its dedicated
private network route and database credential. However, the project-level role
is broader than an application-specific project boundary.

This is acceptable for the internal pilot because the database credential is
separate and Secret Manager access is resource-scoped. It is another reason to
move production into a dedicated project rather than relying indefinitely on
naming conventions inside a shared project.

## Production Recommendation

Use distinct projects as the production trust boundary:

```text
Trickee organization
├── trickee-gpsdriver-staging
├── trickee-gpsdriver-prod
└── other application projects
```

Each GPS Driver project should have its own:

- Cloud SQL instance and credentials
- Redis instance
- Cloud Storage archive bucket
- Secret Manager secrets
- Service accounts and IAM policies
- Artifact Registry repository
- Terraform state
- quotas, budgets, dashboards, and alert policies
- OAuth clients appropriate to the environment

Staging must not use production driver accounts, telemetry, secrets, signing
credentials, or database backups.

## Migration Triggers

Create the dedicated production project before the first of these events:

- Play rollout expands beyond controlled internal testers.
- Real customer or fleet data is onboarded.
- Another application requires broad project-level IAM.
- Shared Cloud Run, API, VPC, database, or Redis quotas become material.
- GPS Driver needs an independent availability or disaster-recovery objective.
- Product-specific cost accounting or contractual data isolation is required.
- Multiple teams or deployment pipelines administer the shared project.
- A security review requires a smaller trust or incident-response boundary.

## URL Preservation

The currently deployed endpoints are:

- API: `https://trickee-pilot-api-pylmkxap6a-el.a.run.app`
- WebSocket: `https://trickee-pilot-websocket-pylmkxap6a-el.a.run.app`

Moving the services to another project creates new native Cloud Run URLs.
Existing mobile builds must not be broken during migration. Preserve the
current endpoints until clients have moved to stable company-controlled API
and WebSocket domains, or keep the existing services as a narrowly scoped
compatibility gateway. Do not remove or repurpose the current URLs without a
versioned client migration and rollback plan.

## Storage Boundary

The canonical live record is PostgreSQL, not Redis or Cloud Storage:

```text
Android Room outbox
        |
        v
Cloud Run API
        |
        v
Dedicated Cloud SQL PostgreSQL
        |
        v
Verified archive job
        |
        v
Private, versioned Cloud Storage archive
```

Redis provides recoverable processing and live-state infrastructure. It must
not become the only copy of accepted telemetry. Archived trip objects use
opaque trip identifiers rather than email addresses or vehicle registration
identifiers.

## Verification Status

Repository deployment evidence dated 2026-08-07 records the project, region,
dedicated Cloud SQL instance, Redis instance, Cloud Run services, and archive
bucket as deployed. A live GCP inventory attempted on 2026-08-30 could not
refresh because the workstation's `gcloud` credentials require interactive
reauthentication.

Before making IAM, quota, migration, or production-readiness decisions, refresh
the live inventory and compare it against Terraform. Repository configuration
is intended state; it is not a substitute for a current provider-backed audit.

## Repository References

- `infra/gcp/main.tf` — Cloud SQL, Redis, bucket, secrets, Cloud Run, and jobs
- `infra/gcp/iam.tf` — service accounts and IAM grants
- `infra/gcp/variables.tf` — resource naming and region defaults
- `infra/gcp/outputs.tf` — deployed endpoint and resource outputs
- `docs/evidence/gates-1-to-4-status.md` — deployment evidence and remaining certification gates
- `docs/superpowers/specs/2026-08-30-gpsdriver-live-pilot-release-hardening-design.md` — pilot release and isolation requirements

## External References

- Google Cloud resource hierarchy and project isolation:
  <https://docs.cloud.google.com/resource-manager/docs/manage-projects-within-folder>
- Google Cloud IAM resource hierarchy:
  <https://docs.cloud.google.com/iam/docs/resource-hierarchy-access-control>
- Cloud Run quotas and limits:
  <https://docs.cloud.google.com/run/quotas>
- Google Cloud billing and project hierarchy:
  <https://cloud.google.com/billing/docs/how-to/reports-project-hierarchy>
