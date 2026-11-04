package com.example.cpen321application

import com.example.cpen321application.data.TripLeg
import com.example.cpen321application.data.TripStatus
import com.example.cpen321application.ui.main.calculateTripTotals
import com.example.cpen321application.ui.main.formatCents
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

private val LEAVE = Instant.parse("2026-10-19T08:00:00Z")

// drive 10 min, walk 5 min, wait 4 min at the platform, ride transit 20 min
private val DRIVE_AND_TRANSIT = listOf(
    TripLeg("DRIVE", 600, 8000, LEAVE, LEAVE.plusSeconds(600)),
    TripLeg("WALK", 300, 400, LEAVE.plusSeconds(600), LEAVE.plusSeconds(900)),
    TripLeg("TRANSIT", 1200, 12000, LEAVE.plusSeconds(1140), LEAVE.plusSeconds(2340)),
)

class TripTotalsTest {
    @Test
    fun onlyCompletedTripsCount() {
        val totals = calculateTripTotals(
            listOf(
                testTrip(id = "done", cost = 300, legs = DRIVE_AND_TRANSIT),
                testTrip(id = "planned", status = TripStatus.PLANNED, cost = 900, legs = DRIVE_AND_TRANSIT),
                testTrip(id = "active", status = TripStatus.ACTIVE, cost = 900, legs = DRIVE_AND_TRANSIT),
                testTrip(id = "cancelled", status = TripStatus.CANCELLED, cost = 900, legs = DRIVE_AND_TRANSIT),
            ),
        )

        assertEquals(1, totals.tripCount)
        assertEquals(300, totals.costCents)
    }

    @Test
    fun partsAddUpToTheTotals() {
        val trips = listOf(testTrip(id = "a", cost = 455, legs = DRIVE_AND_TRANSIT), testTrip(id = "b", cost = 200))

        val totals = calculateTripTotals(trips)

        assertEquals(655, totals.costCents)
        assertEquals(totals.costCents, totals.fuelCents + totals.parkingCents + totals.fareCents)
        assertEquals(mapOf("DRIVE" to 8000L, "WALK" to 400L, "TRANSIT" to 12000L), totals.distanceByMode)
        assertEquals(20400L, totals.distanceMeters)
        assertEquals(mapOf("DRIVE" to 600L, "WALK" to 300L, "TRANSIT" to 1200L), totals.durationByMode)
        assertEquals(totals.durationByMode.values.sum() + totals.waitingSeconds, totals.durationSeconds)
    }

    @Test
    fun waitingIsTheGapBetweenLegs() {
        val totals = calculateTripTotals(listOf(testTrip(legs = DRIVE_AND_TRANSIT)))

        assertEquals(240L, totals.waitingSeconds)
        assertEquals(2340L, totals.durationSeconds) // leave 8:00, arrive 8:39
    }

    @Test
    fun legsWithoutTimesOrOverlappingAddNoWaiting() {
        val overlapping = listOf(
            TripLeg("DRIVE", 600, 0, LEAVE, LEAVE.plusSeconds(600)),
            TripLeg("WALK", 300, 0, LEAVE.plusSeconds(500), LEAVE.plusSeconds(800)), // departs before the drive arrives
        )
        val beforeCp2 = listOf(TripLeg("DRIVE", 600), TripLeg("TRANSIT", 900))

        val totals = calculateTripTotals(listOf(testTrip(id = "a", legs = overlapping), testTrip(id = "b", legs = beforeCp2)))

        assertEquals(0L, totals.waitingSeconds)
    }

    @Test
    fun savedVsDrivingSkipsTripsWithoutABaseline() {
        val totals = calculateTripTotals(
            listOf(
                testTrip(id = "cheaper", cost = 300, baselineDriveCostCents = 1000),
                testTrip(id = "pricier", cost = 500, baselineDriveCostCents = 400),
                testTrip(id = "unknown", cost = 700),
            ),
        )

        assertEquals(600, totals.savedVsDrivingCents)
    }

    @Test
    fun noTripsGiveZeros() {
        val totals = calculateTripTotals(emptyList())

        assertEquals(0, totals.tripCount)
        assertEquals(0, totals.costCents)
        assertEquals(0L, totals.distanceMeters)
        assertEquals(0L, totals.durationSeconds)
        assertEquals(0, totals.savedVsDrivingCents)
    }

    @Test
    fun negativeSavingsShowAMinusSign() {
        assertEquals("-$1.20", formatCents(-120))
        assertEquals("$3.40", formatCents(340))
    }
}
