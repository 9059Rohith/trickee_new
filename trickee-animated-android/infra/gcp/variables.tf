variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "asia-south1"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "image" {
  type        = string
  description = "Immutable Artifact Registry image digest (name@sha256:...)"
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image))
    error_message = "image must be an immutable sha256 digest."
  }
}

variable "database_password" {
  type      = string
  sensitive = true
}

variable "jwt_secret" {
  type      = string
  sensitive = true
}

variable "google_oauth_client_id" {
  type      = string
  sensitive = true
}

variable "google_workspace_domain" {
  type    = string
  default = ""
}

variable "allowed_origins" {
  type = string
}

variable "monitoring_audience" {
  type        = string
  description = "Expected Google identity-token audience for the internal monitoring endpoint"
  default     = "https://trickee-pilot-api-pylmkxap6a-el.a.run.app"
}

variable "monitoring_caller_service_accounts" {
  type        = string
  description = "Comma-separated service-account emails permitted to read the monitoring snapshot"
  default     = ""
}

variable "monitoring_notification_channels" {
  type        = list(string)
  description = "At least one pre-created Monitoring notification channel ID"
  validation {
    condition     = length(var.monitoring_notification_channels) > 0
    error_message = "Production requires at least one monitoring notification channel."
  }
}

variable "db_tier" {
  type    = string
  default = "db-custom-2-7680"
}

variable "redis_memory_gb" {
  type    = number
  default = 5
}

variable "api_max_instances" {
  type    = number
  default = 10
}

variable "websocket_max_instances" {
  type    = number
  default = 20
}

variable "worker_max_instances" {
  type    = number
  default = 3
}

locals {
  name = "trickee-${var.environment}"
  services = toset([
    "run.googleapis.com", "sqladmin.googleapis.com", "redis.googleapis.com",
    "vpcaccess.googleapis.com", "servicenetworking.googleapis.com",
    "secretmanager.googleapis.com", "artifactregistry.googleapis.com",
    "monitoring.googleapis.com", "logging.googleapis.com", "cloudscheduler.googleapis.com",
    "firebase.googleapis.com", "fcm.googleapis.com"
  ])
  roles       = toset(["api", "websocket", "relay", "live-state", "imu-rules", "trip-finalizer", "notification-fcm", "finalization-reconciler", "migrate", "archive", "retention"])
  redis_roles = toset(["relay", "live-state", "imu-rules", "trip-finalizer"])
  secret_access = {
    api                     = toset(["database-url", "jwt-secret", "google-oauth-client-id"])
    websocket               = toset(["database-url", "jwt-secret"])
    relay                   = toset(["database-url", "redis-ca"])
    live-state              = toset(["database-url", "redis-ca"])
    imu-rules               = toset(["database-url", "redis-ca"])
    trip-finalizer          = toset(["database-url", "redis-ca"])
    notification-fcm        = toset(["database-url"])
    finalization-reconciler = toset(["database-url"])
    migrate                 = toset(["database-url"])
    archive                 = toset(["database-url"])
    retention               = toset(["database-url"])
  }
  secret_grants = merge([
    for role, secrets in local.secret_access : {
      for secret in secrets : "${role}:${secret}" => { role = role, secret = secret }
    }
  ]...)
}
