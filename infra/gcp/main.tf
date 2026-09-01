resource "google_project_service" "required" {
  for_each           = local.services
  service            = each.key
  disable_on_destroy = false
}

resource "google_compute_network" "telemetry" {
  name                    = "${local.name}-network"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.required]
}

resource "google_compute_subnetwork" "serverless" {
  name                     = "${local.name}-serverless"
  ip_cidr_range            = "10.20.0.0/28"
  region                   = var.region
  network                  = google_compute_network.telemetry.id
  private_ip_google_access = true
}

resource "google_vpc_access_connector" "serverless" {
  provider = google-beta
  name     = substr("${local.name}-vpc", 0, 24)
  region   = var.region
  subnet { name = google_compute_subnetwork.serverless.name }
  min_instances = 2
  max_instances = 4
  machine_type  = "e2-micro"
}

resource "google_compute_global_address" "private_services" {
  name          = "${local.name}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.telemetry.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = google_compute_network.telemetry.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}

resource "google_sql_database_instance" "postgres" {
  name                = "${local.name}-postgres"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = true
  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE"
    availability_type = "REGIONAL"
    disk_type         = "PD_SSD"
    disk_autoresize   = true
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.telemetry.id
    }
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 14
        retention_unit   = "COUNT"
      }
    }
    maintenance_window {
      day          = 7
      hour         = 21
      update_track = "stable"
    }
    database_flags {
      name  = "max_connections"
      value = "300"
    }
  }
  depends_on = [google_service_networking_connection.private_vpc]
}

resource "google_sql_database" "app" {
  name     = "trickee"
  instance = google_sql_database_instance.postgres.name
}
resource "google_sql_user" "app" {
  name     = "trickee_app"
  instance = google_sql_database_instance.postgres.name
  password = var.database_password
}

resource "google_redis_instance" "streams" {
  name                    = "${local.name}-redis"
  tier                    = "STANDARD_HA"
  memory_size_gb          = var.redis_memory_gb
  region                  = var.region
  authorized_network      = google_compute_network.telemetry.id
  connect_mode            = "PRIVATE_SERVICE_ACCESS"
  redis_version           = "REDIS_7_2"
  transit_encryption_mode = "SERVER_AUTHENTICATION"
  depends_on              = [google_service_networking_connection.private_vpc]
}

resource "google_storage_bucket" "archive" {
  name                        = "${var.project_id}-${local.name}-telemetry-archive"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning {
    enabled = true
  }
  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }
  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type          = "SetStorageClass"
      storage_class = "COLDLINE"
    }
  }
  lifecycle_rule {
    condition {
      num_newer_versions = 3
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_artifact_registry_repository" "images" {
  location               = var.region
  repository_id          = "trickee"
  format                 = "DOCKER"
  cleanup_policy_dry_run = false
  depends_on             = [google_project_service.required]
}

resource "google_secret_manager_secret" "secret" {
  for_each  = toset(["database-url", "jwt-secret", "google-oauth-client-id", "redis-ca"])
  secret_id = "${local.name}-${each.key}"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.secret["database-url"].id
  secret_data = "postgresql+psycopg2://trickee_app:${urlencode(var.database_password)}@${google_sql_database_instance.postgres.private_ip_address}:5432/trickee"
}
resource "google_secret_manager_secret_version" "jwt_secret" {
  secret      = google_secret_manager_secret.secret["jwt-secret"].id
  secret_data = var.jwt_secret
}
resource "google_secret_manager_secret_version" "google_oauth_client_id" {
  secret      = google_secret_manager_secret.secret["google-oauth-client-id"].id
  secret_data = var.google_oauth_client_id
}
resource "google_secret_manager_secret_version" "redis_ca" {
  secret      = google_secret_manager_secret.secret["redis-ca"].id
  secret_data = google_redis_instance.streams.server_ca_certs[0].cert
}

resource "google_secret_manager_secret_iam_member" "access" {
  for_each  = local.secret_grants
  secret_id = google_secret_manager_secret.secret[each.value.secret].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.role[each.value.role].email}"
}

locals {
  run_roles = {
    api            = { command = "api", max = var.api_max_instances, concurrency = 40, timeout = "60s" }
    websocket      = { command = "websocket", max = var.websocket_max_instances, concurrency = 200, timeout = "3600s" }
    relay          = { command = "relay", max = var.worker_max_instances, concurrency = 1, timeout = "3600s" }
    live-state     = { command = "live-state", max = var.worker_max_instances, concurrency = 1, timeout = "3600s" }
    imu-rules      = { command = "imu-rules", max = var.worker_max_instances, concurrency = 1, timeout = "3600s" }
    trip-finalizer = { command = "trip-finalizer", max = var.worker_max_instances, concurrency = 1, timeout = "3600s" }
  }
}

resource "google_cloud_run_v2_service" "role" {
  for_each            = local.run_roles
  name                = "${local.name}-${each.key}"
  location            = var.region
  deletion_protection = true
  ingress             = each.key == "api" || each.key == "websocket" ? "INGRESS_TRAFFIC_ALL" : "INGRESS_TRAFFIC_INTERNAL_ONLY"
  lifecycle {
    # Cloud Run returns an empty service-level block even when template scaling owns capacity.
    ignore_changes = [scaling]
  }
  template {
    service_account                  = google_service_account.role[each.key].email
    timeout                          = each.value.timeout
    max_instance_request_concurrency = each.value.concurrency
    scaling {
      min_instance_count = each.key == "api" || each.key == "websocket" ? 2 : 1
      max_instance_count = each.value.max
    }
    vpc_access {
      connector = google_vpc_access_connector.serverless.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
    dynamic "volumes" {
      for_each = contains(local.redis_roles, each.key) ? [1] : []
      content {
        name = "redis-ca"
        secret {
          secret = google_secret_manager_secret.secret["redis-ca"].secret_id
          items {
            version = "latest"
            path    = "ca.pem"
            mode    = 0444
          }
        }
      }
    }
    containers {
      image   = var.image
      command = ["python", "-m", "app.cli"]
      args    = [each.value.command]
      resources {
        limits   = { cpu = "1", memory = each.key == "api" ? "1Gi" : "512Mi" }
        cpu_idle = each.key == "api"
      }
      dynamic "volume_mounts" {
        for_each = contains(local.redis_roles, each.key) ? [1] : []
        content {
          name       = "redis-ca"
          mount_path = "/var/run/secrets/redis"
        }
      }
      env {
        name  = "TRICKEE_ALLOWED_ORIGINS"
        value = var.allowed_origins
      }
      env {
        name  = "TRICKEE_GOOGLE_WORKSPACE_DOMAIN"
        value = var.google_workspace_domain
      }
      env {
        name  = "TRICKEE_PASSWORD_AUTH_ENABLED"
        value = "false"
      }
      dynamic "env" {
        for_each = contains(local.redis_roles, each.key) ? [1] : []
        content {
          name  = "TRICKEE_REDIS_URL"
          value = "rediss://${google_redis_instance.streams.host}:${google_redis_instance.streams.port}"
        }
      }
      dynamic "env" {
        for_each = contains(local.redis_roles, each.key) ? [1] : []
        content {
          name  = "TRICKEE_REDIS_CA_CERT"
          value = "/var/run/secrets/redis/ca.pem"
        }
      }
      env {
        name  = "TRICKEE_DB_POOL_SIZE"
        value = "2"
      }
      env {
        name  = "TRICKEE_DB_MAX_OVERFLOW"
        value = "1"
      }
      env {
        name = "TRICKEE_DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.secret["database-url"].secret_id
            version = "latest"
          }
        }
      }
      dynamic "env" {
        for_each = contains(["api", "websocket"], each.key) ? [1] : []
        content {
          name = "TRICKEE_SECRET_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secret["jwt-secret"].secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = each.key == "api" ? [1] : []
        content {
          name = "TRICKEE_GOOGLE_OAUTH_CLIENT_ID"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secret["google-oauth-client-id"].secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = each.key == "api" ? [1] : []
        content {
          name  = "TRICKEE_MONITORING_AUDIENCE"
          value = var.monitoring_audience
        }
      }
      dynamic "env" {
        for_each = each.key == "api" ? [1] : []
        content {
          name  = "TRICKEE_MONITORING_CALLER_SERVICE_ACCOUNTS"
          value = var.monitoring_caller_service_accounts
        }
      }
    }
  }
  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_iam_member.access,
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_version.redis_ca,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public_gateway" {
  for_each = toset(["api", "websocket"])
  location = google_cloud_run_v2_service.role[each.key].location
  name     = google_cloud_run_v2_service.role[each.key].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_job" "job" {
  for_each            = toset(["migrate", "archive", "retention", "finalization-reconciler"])
  name                = "${local.name}-${each.key}"
  location            = var.region
  deletion_protection = true
  template {
    template {
      service_account = google_service_account.role[each.key].email
      timeout         = "3600s"
      max_retries     = each.key == "migrate" ? 0 : 2
      vpc_access {
        connector = google_vpc_access_connector.serverless.id
        egress    = "PRIVATE_RANGES_ONLY"
      }
      containers {
        image   = var.image
        command = ["python", "-m", "app.cli"]
        args    = [each.key]
        dynamic "env" {
          for_each = each.key == "archive" ? [1] : []
          content {
            name  = "TRICKEE_ARCHIVE_BUCKET"
            value = google_storage_bucket.archive.name
          }
        }
        env {
          name = "TRICKEE_DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secret["database-url"].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_version.database_url]
}

resource "google_cloud_run_v2_job_iam_member" "finalization_reconciler_invoker" {
  location = google_cloud_run_v2_job.job["finalization-reconciler"].location
  name     = google_cloud_run_v2_job.job["finalization-reconciler"].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.role["finalization-reconciler"].email}"
}

resource "google_cloud_scheduler_job" "finalization_reconciler" {
  name        = "${local.name}-finalization-reconciler"
  description = "Close telemetry-incomplete trips after the configured grace period"
  region      = var.region
  schedule    = "15 * * * *"
  time_zone   = "Etc/UTC"

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.job["finalization-reconciler"].name}:run"
    oauth_token {
      service_account_email = google_service_account.role["finalization-reconciler"].email
    }
  }

  depends_on = [google_cloud_run_v2_job_iam_member.finalization_reconciler_invoker]
}

resource "google_logging_metric" "outbox_pending" {
  name        = "${local.name}-server-outbox-pending"
  description = "Pending canonical telemetry outbox rows emitted by the relay"
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.name}-relay\" AND jsonPayload.metric=\"trickee_server_outbox_pending\""

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "1"
    display_name = "${local.name} server outbox pending"
  }

  value_extractor = "EXTRACT(jsonPayload.outbox_pending)"
  bucket_options {
    explicit_buckets {
      bounds = [0, 10, 100, 500, 1000, 5000, 10000]
    }
  }
}

resource "google_monitoring_alert_policy" "outbox_backlog" {
  display_name          = "${local.name} telemetry outbox backlog"
  combiner              = "OR"
  notification_channels = var.monitoring_notification_channels
  conditions {
    display_name = "pending outbox high"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.outbox_pending.name}\" resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1000
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_PERCENTILE_99"
      }
    }
  }
  depends_on = [google_logging_metric.outbox_pending]
}
