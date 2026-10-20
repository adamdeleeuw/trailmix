package com.example.cpen321application

import com.example.cpen321application.data.Trip
import com.example.cpen321application.data.TripLeg
import com.example.cpen321application.data.TripPlace
import com.example.cpen321application.ui.main.calculateCommuteInsights
import com.example.cpen321application.ui.main.modePercentages
import com.example.cpen321application.ui.main.sortTrips
import com.example.cpen321application.ui.main.TripHistorySort
import org.junit.Assert.assertEquals
import org.junit.Test

class CommuteInsightsTest {
    @Test
    fun averagesTripDurationAndCostAndTotalsModeDurations() {
        val summary = calculateCommuteInsights(
            listOf(
                trip(duration = 600, cost = 250, legs = listOf(TripLeg("DRIVE", 300), TripLeg("TRANSIT", 300))),
                trip(duration = 1200, cost = 450, legs = listOf(TripLeg("TRANSIT", 1200))),
            ),
        )

        assertEquals(2, summary.tripCount)
        assertEquals(900, summary.averageDurationSeconds)
        assertEquals(350, summary.averageCostCents)
        assertEquals(mapOf("DRIVE" to 300L, "TRANSIT" to 1500L), summary.durationByMode)
        assertEquals(1800L, summary.totalModeDurationSeconds)
    }

    @Test
    fun emptyHistoryProducesZeroAveragesAndNoModeTime() {
        val summary = calculateCommuteInsights(emptyList())

        assertEquals(0, summary.tripCount)
        assertEquals(0, summary.averageDurationSeconds)
        assertEquals(0, summary.averageCostCents)
        assertEquals(emptyMap<String, Long>(), summary.durationByMode)
    }

    @Test
    fun historyCanSortByNewestOrCost() {
        val trips = listOf(
            trip(duration = 600, cost = 500, legs = emptyList()).copy(tripDate = "2026-10-17T08:00:00Z"),
            trip(duration = 700, cost = 100, legs = emptyList()).copy(tripDate = "2026-10-19T08:00:00Z"),
            trip(duration = 800, cost = 300, legs = emptyList()).copy(tripDate = "2026-10-18T08:00:00Z"),
        )

        assertEquals(listOf(700, 800, 600), sortTrips(trips, TripHistorySort.NEWEST).map { it.totalDurationSeconds })
        assertEquals(listOf(100, 300, 500), sortTrips(trips, TripHistorySort.LOWEST_COST).map { it.totalCostCents })
        assertEquals(listOf(500, 300, 100), sortTrips(trips, TripHistorySort.HIGHEST_COST).map { it.totalCostCents })
    }

    @Test
    fun displayedModePercentagesAlwaysAddToOneHundred() {
        val percentages = modePercentages(mapOf("DRIVE" to 1L, "TRANSIT" to 1L, "OTHER" to 1L))

        assertEquals(mapOf("DRIVE" to 34, "TRANSIT" to 33, "OTHER" to 33), percentages)
        assertEquals(100, percentages.values.sum())
    }

    @Test
    fun emptyModeDurationsHaveZeroPercentages() {
        assertEquals(emptyMap<String, Int>(), modePercentages(emptyMap()))
    }

    private fun trip(duration: Int, cost: Int, legs: List<TripLeg>) = Trip(
        id = "id-$duration",
        origin = TripPlace("Home"),
        destination = TripPlace("Work"),
        legs = legs,
        totalDurationSeconds = duration,
        totalCostCents = cost,
        tripDate = "2026-10-19T08:00:00Z",
    )
}
