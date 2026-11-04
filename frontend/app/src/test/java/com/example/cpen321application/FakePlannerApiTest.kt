package com.example.cpen321application

import com.example.cpen321application.data.FakePlannerApi
import com.example.cpen321application.data.PlanPlace
import com.example.cpen321application.data.PlanRequest
import com.example.cpen321application.data.RouteLabel
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.ui.route.decodePolyline
import com.google.android.gms.maps.model.LatLng
import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

private val UBC = PlanPlace("UBC", LatLng(49.2606, -123.2460))
private val WATERFRONT = PlanPlace("Waterfront Station", LatLng(49.2858, -123.1118))
private val NOW = Instant.parse("2026-11-02T15:00:00Z")
private val BOTH = setOf(TripMode.DRIVE, TripMode.TRANSIT)

class FakePlannerApiTest {
    private val api = FakePlannerApi(delayMs = 0, clock = { NOW })

    private suspend fun plan(modes: Set<TripMode> = BOTH, arriveBy: Instant? = null) =
        api.planTrip("token", PlanRequest(UBC, WATERFRONT, arriveBy, modes))

    @Test
    fun answersWithThreeLabelledRoutesInContractOrder() = runTest {
        val labels = plan().options.map { it.label }

        assertEquals(listOf(RouteLabel.CHEAPEST, RouteLabel.FASTEST, RouteLabel.BALANCED), labels)
    }

    @Test
    fun theLabelsMatchTheNumbers() = runTest {
        val routes = plan().options.associateBy { it.label }

        assertEquals(routes.values.minOf { it.totalCostCents }, routes.getValue(RouteLabel.CHEAPEST).totalCostCents)
        assertEquals(routes.values.minOf { it.totalDurationSeconds }, routes.getValue(RouteLabel.FASTEST).totalDurationSeconds)
    }

    @Test
    fun leavesOutRoutesThatNeedATurnedOffMode() = runTest {
        assertEquals(listOf(RouteLabel.CHEAPEST), plan(modes = setOf(TripMode.TRANSIT)).options.map { it.label })
        assertEquals(listOf(RouteLabel.FASTEST), plan(modes = setOf(TripMode.DRIVE)).options.map { it.label })
    }

    @Test
    fun leavingNowStartsNowAndLegsRunBackToBack() = runTest {
        for (route in plan().options) {
            assertEquals(NOW, route.leaveAt)
            assertEquals(route.leaveAt, route.legs.first().departAt)
            assertEquals(route.arriveAt, route.legs.last().arriveAt)
            route.legs.zipWithNext { a, b -> assertEquals(a.arriveAt, b.departAt) }
        }
    }

    @Test
    fun anArriveByTimeIsMetOrBeaten() = runTest {
        val deadline = Instant.parse("2026-11-02T17:00:00Z")

        for (route in plan(arriveBy = deadline).options) {
            assertTrue(!route.arriveAt.isAfter(deadline))
            assertEquals(0, route.lateByMinutes)
        }
    }

    @Test
    fun costsAddUp() = runTest {
        for (route in plan().options) {
            val parts = route.costBreakdown
            assertEquals(parts.fuelCents + parts.parkingCents + parts.fareCents, route.totalCostCents)
        }
    }

    @Test
    fun eachLegsLineRunsBetweenItsEnds() = runTest {
        for (leg in plan().options.flatMap { it.legs }) {
            val points = decodePolyline(leg.polyline)
            assertEquals(leg.from.location.latitude, points.first().latitude, 1e-5)
            assertEquals(leg.to.location.longitude, points.last().longitude, 1e-5)
        }
    }
}
