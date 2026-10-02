package com.trickee.gpsdriver.telemetry.storage

import android.content.Context
import androidx.room.testing.MigrationTestHelper
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TelemetryMigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        TelemetryDatabase::class.java,
    )

    @After
    fun deleteDatabase() {
        ApplicationProvider.getApplicationContext<Context>().deleteDatabase(DATABASE_NAME)
    }

    @Test
    fun migrationRequeuesLegacyHttpFailuresButPreservesExplicitRejections() {
        helper.createDatabase(DATABASE_NAME, 1).use { database ->
            insertTrip(database)
            insertOutbox(database, "legacy-http", 1L, "PERMANENTLY_REJECTED", "HTTP_403", "{\"kept\":true}")
            insertOutbox(database, "explicit", 2L, "PERMANENTLY_REJECTED", "PAYLOAD_CONFLICT", "{\"kept\":true}")
        }

        helper.runMigrationsAndValidate(
            DATABASE_NAME,
            2,
            true,
            TelemetryDatabase.MIGRATION_1_2,
        ).use { database ->
            database.query(
                "SELECT sample_id, state, rejection_code, last_http_status, last_error_code, payload_json FROM telemetry_outbox ORDER BY sequence_no"
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals("legacy-http", cursor.getString(0))
                assertEquals("PENDING", cursor.getString(1))
                assertEquals(null, cursor.getString(2))
                assertEquals(403, cursor.getInt(3))
                assertEquals("LEGACY_HTTP_403_REQUEUED", cursor.getString(4))
                assertEquals("{\"kept\":true}", cursor.getString(5))

                cursor.moveToNext()
                assertEquals("explicit", cursor.getString(0))
                assertEquals("PERMANENTLY_REJECTED", cursor.getString(1))
                assertEquals("PAYLOAD_CONFLICT", cursor.getString(2))
                assertEquals(true, cursor.isNull(3))
                assertEquals(true, cursor.isNull(4))
            }
        }
    }

    @Test
    fun migrationRepairsAnActiveTripThatWasAlreadySealed() {
        helper.createDatabase(DATABASE_NAME, 2).use { database ->
            database.execSQL(
                "INSERT INTO local_trips (trip_id, device_id, vehicle_id, state, next_sequence_no, final_sequence_no, started_at_utc_ms, ended_at_utc_ms) VALUES ('trip', 'device', 'vehicle', 'ACTIVE', 3225, 1345, 1000, 2000)"
            )
            insertVersionTwoOutbox(database, "within-final", 1345L, "ACKED")
            insertVersionTwoOutbox(database, "late-acked", 3223L, "ACKED")
            insertVersionTwoOutbox(database, "late-pending", 3224L, "PENDING")
        }

        helper.runMigrationsAndValidate(
            DATABASE_NAME,
            3,
            true,
            TelemetryDatabase.MIGRATION_2_3,
        ).use { database ->
            database.query(
                "SELECT state, final_sequence_no, next_sequence_no FROM local_trips WHERE trip_id = 'trip'"
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals("SYNC_PENDING", cursor.getString(0))
                assertEquals(1345L, cursor.getLong(1))
                assertEquals(3225L, cursor.getLong(2))
            }

            database.query(
                "SELECT sample_id, state, rejection_code FROM telemetry_outbox ORDER BY sequence_no"
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals("within-final", cursor.getString(0))
                assertEquals("ACKED", cursor.getString(1))

                cursor.moveToNext()
                assertEquals("late-acked", cursor.getString(0))
                assertEquals("ACKED", cursor.getString(1))

                cursor.moveToNext()
                assertEquals("late-pending", cursor.getString(0))
                assertEquals("PERMANENTLY_REJECTED", cursor.getString(1))
                assertEquals("CAPTURED_AFTER_FINAL_SEQUENCE", cursor.getString(2))
            }
        }
    }

    private fun insertTrip(database: SupportSQLiteDatabase) {
        database.execSQL(
            "INSERT INTO local_trips (trip_id, device_id, vehicle_id, state, next_sequence_no, final_sequence_no, started_at_utc_ms, ended_at_utc_ms) VALUES ('trip', 'device', 'vehicle', 'ACTIVE', 3, NULL, 1000, NULL)"
        )
    }

    private fun insertOutbox(
        database: SupportSQLiteDatabase,
        sampleId: String,
        sequenceNo: Long,
        state: String,
        rejectionCode: String,
        payload: String,
    ) {
        database.execSQL(
            "INSERT INTO telemetry_outbox (sample_id, trip_id, sequence_no, event_time_utc_ms, monotonic_time_ns, payload_json, state, attempt_count, next_attempt_at_utc_ms, lease_until_utc_ms, server_committed_at_utc_ms, created_at_utc_ms, rejection_code) VALUES (?, 'trip', ?, 2000, 3000, ?, ?, 1, 0, NULL, NULL, 2001, ?)",
            arrayOf<Any?>(sampleId, sequenceNo, payload, state, rejectionCode),
        )
    }

    private fun insertVersionTwoOutbox(
        database: SupportSQLiteDatabase,
        sampleId: String,
        sequenceNo: Long,
        state: String,
    ) {
        database.execSQL(
            "INSERT INTO telemetry_outbox (sample_id, trip_id, sequence_no, event_time_utc_ms, monotonic_time_ns, payload_json, state, attempt_count, next_attempt_at_utc_ms, lease_until_utc_ms, server_committed_at_utc_ms, created_at_utc_ms, rejection_code, last_http_status, last_error_code, last_error_detail, last_failure_at_utc_ms, permanently_rejected_at_utc_ms) VALUES (?, 'trip', ?, 2000, 3000, '{\"kept\":true}', ?, 1, 0, NULL, NULL, 2001, NULL, NULL, NULL, NULL, NULL, NULL)",
            arrayOf<Any?>(sampleId, sequenceNo, state),
        )
    }

    private companion object {
        const val DATABASE_NAME = "telemetry-migration-test"
    }
}
