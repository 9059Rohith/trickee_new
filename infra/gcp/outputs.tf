output "api_url" { value = google_cloud_run_v2_service.role["api"].uri }
output "websocket_url" { value = google_cloud_run_v2_service.role["websocket"].uri }
output "archive_bucket" { value = google_storage_bucket.archive.name }
output "sql_instance" { value = google_sql_database_instance.postgres.connection_name }
output "redis_host" {
  value     = google_redis_instance.streams.host
  sensitive = true
}
output "service_accounts" { value = { for name, account in google_service_account.role : name => account.email } }
