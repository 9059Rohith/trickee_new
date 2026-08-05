variable "project_id" { type = string }
variable "region" { type = string
  default = "asia-south1"
}
variable "environment" { type = string
  default = "production"
}
variable "image" { type = string
  description = "Immutable Artifact Registry image digest (name@sha256:...)"
}
variable "database_password" { type = string
  sensitive = true
}
variable "jwt_secret" { type = string
  sensitive = true
}
variable "google_oauth_client_id" { type = string
  sensitive = true
}
variable "google_workspace_domain" { type = string
  default = ""
}
variable "allowed_origins" { type = string }
variable "monitoring_notification_channels" {
  type        = list(string)
  description = "At least one pre-created Monitoring notification channel ID"
  validation {
    condition     = length(var.monitoring_notification_channels) > 0
    error_message = "Production requires at least one monitoring notification channel."
  }
}
variable "db_tier" { type = string
  default = "db-custom-2-7680"
}
variable "redis_memory_gb" { type = number
  default = 5
}
variable "api_max_instances" { type = number
  default = 10
}
variable "websocket_max_instances" { type = number
  default = 20
}
variable "worker_max_instances" { type = number
  default = 3
}

locals {
  name = "trickee-${var.environment}"
  services = toset([
    "run.googleapis.com", "sqladmin.googleapis.com", "redis.googleapis.com",
    "vpcaccess.googleapis.com", "servicenetworking.googleapis.com",
    "secretmanager.googleapis.com", "artifactregistry.googleapis.com",
    "monitoring.googleapis.com", "cloudscheduler.googleapis.com"
  ])
  roles = toset(["api", "websocket", "relay", "live-state", "imu-rules", "trip-finalizer", "migrate", "archive", "retention"])
}
