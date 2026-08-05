resource "google_service_account" "role" {
  for_each = local.roles
  account_id = substr("${local.name}-${replace(each.key, "-", "")}", 0, 30)
  display_name = "Trickee ${each.key} ${var.environment}"
}

resource "google_project_iam_member" "sql" {
  for_each = local.roles
  project = var.project_id
  role = "roles/cloudsql.client"
  member = "serviceAccount:${google_service_account.role[each.key].email}"
}

resource "google_project_iam_member" "monitoring_writer" {
  for_each = local.roles
  project = var.project_id
  role = "roles/monitoring.metricWriter"
  member = "serviceAccount:${google_service_account.role[each.key].email}"
}

resource "google_storage_bucket_iam_member" "archive_writer" {
  bucket = google_storage_bucket.archive.name
  role = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.role["archive"].email}"
}

resource "google_storage_bucket_iam_member" "archive_verifier" {
  bucket = google_storage_bucket.archive.name
  role = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.role["archive"].email}"
}
