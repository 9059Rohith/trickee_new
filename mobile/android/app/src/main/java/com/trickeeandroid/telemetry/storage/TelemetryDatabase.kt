package com.trickeeandroid.telemetry.storage

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

@Database(
    entities = [LocalTripEntity::class, TelemetryOutboxEntity::class],
    version = 1,
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
                "trickee-telemetry.db",
            ).setJournalMode(JournalMode.WRITE_AHEAD_LOGGING).build().also { instance = it }
        }
    }
}
