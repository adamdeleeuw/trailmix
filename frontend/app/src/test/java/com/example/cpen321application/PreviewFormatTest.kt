package com.example.cpen321application

import com.example.cpen321application.data.CostBreakdown
import com.example.cpen321application.data.FakePlannerApi
import com.example.cpen321application.data.PlanPlace
import com.example.cpen321application.data.PlanRequest
import com.example.cpen321application.data.RouteLabel
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.ui.planning.RowKind
import com.example.cpen321application.ui.planning.arrivalSummaryText
import com.example.cpen321application.ui.planning.costSplitText
import com.example.cpen321application.ui.planning.kmText
import com.example.cpen321application.ui.planning.parkingText
import com.example.cpen321application.ui.planning.savingsText
import com.example.cpen321application.ui.planning.timelineRows
import com.google.android.gms.maps.model.LatLng
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

// a fixed offset, so the tests don't depend on the machine's time zone rules
private val ZONE = ZoneId.of("-07:00")
private val NINE_AM = Instant.parse("2026-11-02T16:00:00Z")

class PreviewFormatTest {
    private lateinit var routes: Map<RouteLabel, RouteOption>

    @Before
    fun setUp() = runTest {
        val request = PlanRequest(
            PlanPlace("Your location", LatLng(49.2606, -123.2460)),
            PlanPlace("UBC", LatLng(49.2858, -123.1118)),
            arriveBy = NINE_AM,
            modes = setOf(TripMode.DRIVE, TripMode.TRANSIT),
        )
        routes = FakePlannerApi(delayMs = 0).planTrip("token", request).options.associateBy { it.label }
    }

    private fun route(label: RouteLabel) = routes.getValue(label)

    @Test
    fun aParkAndRideTimelineGoesLeaveDriveParkWalkBoardGetOffWalkArrive() {
        val rows = timelineRows(route(RouteLabel.BALANCED), NINE_AM, ZONE)

        assertEquals(
            listOf(
                RowKind.LEAVE, RowKind.DRIVE, RowKind.PARK, RowKind.WALK,
                RowKind.BOARD, RowKind.ALIGHT, RowKind.WALK, RowKind.ARRIVE,
            ),
            rows.map { it.kind },
        )
        assertEquals("Leave Your location", rows[0].title)
        assertEquals("8:16", rows[0].time)
        assertEquals("14 min · 9.2 km · $1.18 fuel", rows[1].detail)
        assertEquals("Park at North Parkade (sample)", rows[2].title)
        assertEquals("Free parking", rows[2].detail)
        assertEquals("Expo Line toward Waterfront", rows[4].title)
        assertEquals("Board at Sample Station · 9 stops", rows[4].detail)
        assertEquals("#0060A9", rows[4].colour)
        assertEquals("Get off at Waterfront Station", rows[5].title)
        assertEquals("#0060A9", rows[5].colour)
        assertEquals("Arrive at UBC", rows[7].title)
        assertEquals("4 min early", rows[7].detail)
        assertEquals("8:56", rows[7].time)
    }

    @Test
    fun aTransferBetweenLinesIsGetOffThenBoard() {
        val kinds = timelineRows(route(RouteLabel.CHEAPEST), NINE_AM, ZONE).map { it.kind }

        assertEquals(
            listOf(
                RowKind.LEAVE, RowKind.WALK, RowKind.BOARD, RowKind.ALIGHT,
                RowKind.BOARD, RowKind.ALIGHT, RowKind.WALK, RowKind.ARRIVE,
            ),
            kinds,
        )
    }

    @Test
    fun aWalkWithNoUsefulDestinationUsesItsDurationAndDistance() {
        val balanced = route(RouteLabel.BALANCED)
        val walk = balanced.legs.first { it.mode == TripMode.WALK }
        val preview = balanced.copy(legs = listOf(walk.copy(to = walk.to.copy(label = "Transit connection"))))

        val row = timelineRows(preview, arriveBy = null, zone = ZONE)[1]

        assertEquals("Walk · 3 min · 200 m", row.title)
        assertNull(row.detail)
    }

    @Test
    fun drivingTheWholeWayHasNoParkRow() {
        val kinds = timelineRows(route(RouteLabel.FASTEST), NINE_AM, ZONE).map { it.kind }

        assertEquals(listOf(RowKind.LEAVE, RowKind.DRIVE, RowKind.ARRIVE), kinds)
    }

    @Test
    fun aLateArrivalSaysSo() {
        val late = route(RouteLabel.FASTEST).copy(lateByMinutes = 7)

        assertEquals("7 min late for 9:00", timelineRows(late, NINE_AM, ZONE).last().detail)
        assertEquals("Arrive 9:00 · 7 min late for 9:00", arrivalSummaryText(late, NINE_AM, ZONE))
    }

    @Test
    fun theArrivalSummaryWithoutADeadlineIsJustTheTime() {
        assertEquals("Arrive 8:56", arrivalSummaryText(route(RouteLabel.BALANCED), arriveBy = null, zone = ZONE))
    }

    @Test
    fun distancesUnderAKilometreAreMetres() {
        assertEquals("200 m", kmText(200))
        assertEquals("9.2 km", kmText(9200))
    }

    @Test
    fun parkingIsPricedFreeOrUnknown() {
        val balanced = route(RouteLabel.BALANCED)

        assertEquals("Free parking", parkingText(balanced))
        assertEquals("Parking $3.00", parkingText(balanced.copy(costBreakdown = CostBreakdown(118, 300, 240))))
        assertEquals("Parking cost unknown", parkingText(balanced.copy(costEstimated = true)))
    }

    @Test
    fun theCostSplitLeavesOutZeroParts() {
        assertEquals("Fuel $1.18 + fare $2.40", costSplitText(route(RouteLabel.BALANCED)))
        assertEquals("Fare $3.35", costSplitText(route(RouteLabel.CHEAPEST)))
        assertNull(costSplitText(route(RouteLabel.CHEAPEST).copy(costBreakdown = CostBreakdown(0, 0, 0))))
    }

    @Test
    fun savingsOnlyShowWhenCheaperThanDriving() {
        assertEquals("$0.32 cheaper than driving", savingsText(route(RouteLabel.BALANCED))) // 390 - 358
        assertNull(savingsText(route(RouteLabel.FASTEST))) // it is driving
        assertNull(savingsText(route(RouteLabel.BALANCED).copy(baselineDriveCostCents = null)))
    }
}
