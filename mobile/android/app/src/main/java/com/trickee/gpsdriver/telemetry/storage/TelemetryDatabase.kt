package com.trickee.gpsdriver.telemetry.storage

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [LocalTripEntity::class, TelemetryOutboxEntity::class],
    version = 3,
    exportSchema = true,
)
@TypeConverters(TelemetryConverters::class)
abstract class TelemetryDatabase : RoomDatabase() {
    abstract fun telemetryDao(): TelemetryDao

    companion object {
        @Volatile private var instance: TelemetryDatabase? = null

        fun open(context: Context): TelemetryDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                TelemetryDatabase::class.java,
                DATABASE_NAME,
            ).addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                .setJournalMode(JournalMode.WRITE_AHEAD_LOGGING)
                .build()
                .also { instance = it }
        }

        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("ALTER TABLE telemetry_outbox ADD COLUMN last_http_status INTEGER")
                database.execSQL("ALTER TABLE telemetry_outbox ADD COLUMN last_error_code TEXT")
                database.execSQL("ALTER TABLE telemetry_outbox ADD COLUMN last_error_detail TEXT")
                database.execSQL("ALTER TABLE telemetry_outbox ADD COLUMN last_failure_at_utc_ms INTEGER")
                database.execSQL("ALTER TABLE telemetry_outbox ADD COLUMN permanently_rejected_at_utc_ms INTEGER")
                database.execSQL(
                    """
                    UPDATE telemetry_outbox
                    SET state = 'PENDING',
                        next_attempt_at_utc_ms = 0,
                        lease_until_utc_ms = NULL,
                        last_http_status = CAST(SUBSTR(rejection_code, 6) AS INTEGER),
                        last_error_code = 'LEGACY_' || rejection_code || '_REQUEUED',
                        last_failure_at_utc_ms = 0,
                        rejection_code = NULL
                    WHERE state = 'PERMANENTLY_REJECTED'
                      AND rejection_code GLOB 'HTTP_[0-9]*'
                    """.trimIndent()
                )
            }
        }

        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    """
                    UPDATE telemetry_outbox
                    SET state = 'PERMANENTLY_REJECTED',
                        lease_until_utc_ms = NULL,
                        last_error_code = 'CAPTURED_AFTER_FINAL_SEQUENCE',
                        last_error_detail = 'Preserved locally but excluded because the trip was already sealed',
                        last_failure_at_utc_ms = COALESCE(last_failure_at_utc_ms, created_at_utc_ms),
                        permanently_rejected_at_utc_ms = COALESCE(permanently_rejected_at_utc_ms, created_at_utc_ms),
                        rejection_code = 'CAPTURED_AFTER_FINAL_SEQUENCE'
                    WHERE state IN ('PENDING', 'IN_FLIGHT')
                      AND EXISTS (
                          SELECT 1
                          FROM local_trips
                          WHERE local_trips.trip_id = telemetry_outbox.trip_id
                            AND local_trips.final_sequence_no IS NOT NULL
                            AND telemetry_outbox.sequence_no > local_trips.final_sequence_no
                      )
                    """.trimIndent()
                )
                database.execSQL(
                    """
                    UPDATE local_trips
                    SET state = 'SYNC_PENDING'
                    WHERE final_sequence_no IS NOT NULL
                      AND state IN ('CREATED_LOCAL', 'START_PENDING', 'ACTIVE', 'ENDING')
                    """.trimIndent()
                )
            }
        }

        const val DATABASE_NAME = "trickee-telemetry.db"
    }
}
