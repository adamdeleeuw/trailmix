package com.example.cpen321application

import com.example.cpen321application.data.TripLeg
import com.example.cpen321application.ui.main.TripHistoryPeriod
import com.example.cpen321application.ui.main.filterTrips
import com.example.cpen321application.ui.main.modeStrip
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.junit.Assert.assertEquals
import org.junit.Test

class TripHistoryListTest {
    @Test
    fun aRowListsItsModesInOrder() {
        val trip = testTrip(legs = listOf(TripLeg("DRIVE", 600), TripLeg("WALK", 300), TripLeg("TRANSIT", 900)))

        assertEquals("Driving → Walking → Transit", modeStrip(trip))
    }

    @Test
    fun aTripSavedForLaterShowsInThePeriod() {
        val now = Instant.parse("2026-11-03T12:00:00Z")
        val trips = listOf(
            testTrip(id = "later", tripDate = now.plus(3, ChronoUnit.DAYS).toString()),
            testTrip(id = "recent", tripDate = now.minus(3, ChronoUnit.DAYS).toString()),
            testTrip(id = "old", tripDate = now.minus(20, ChronoUnit.DAYS).toString()),
        )

        assertEquals(listOf("later", "recent"), filterTrips(trips, TripHistoryPeriod.LAST_14_DAYS, now).map { it.id })
    }
}
