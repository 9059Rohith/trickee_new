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

    private companion object {
        const val DATABASE_NAME = "telemetry-migration-test"
    }
}
