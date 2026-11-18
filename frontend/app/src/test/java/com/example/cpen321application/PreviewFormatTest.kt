package com.example.cpen321application

import com.example.cpen321application.data.CostBreakdown
import com.example.cpen321application.data.FakePlannerApi
import com.example.cpen321application.data.PlanPlace
import com.example.cpen321application.data.PlanRequest
import com.example.cpen321application.data.RouteLabel
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.ui.planning.RowKind
import com.example.cpen321application.data.TransitLine
import com.example.cpen321application.ui.planning.arrivalSummaryText
import com.example.cpen321application.ui.planning.boardDetail
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
import org.junit.Assert.assertTrue
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
        assertEquals("Expo Line", rows[4].title) // shown in a badge
        assertEquals("toward Waterfront · Board at Sample Station · 9 stops", rows[4].detail)
        assertEquals("#0060A9", rows[4].colour)
        assertEquals("Get off at Waterfront Station", rows[5].title)
        assertEquals("#0060A9", rows[5].colour)
        assertEquals("Arrive at UBC", rows[7].title)
        assertEquals("4 min early", rows[7].detail)
        assertEquals("8:56", rows[7].time)
    }

    @Test
    fun bicycleTimelineShowsItsDestinationDistanceAndEndpoints() {
        val bike = route(RouteLabel.BALANCED).legs.first().copy(
            mode = TripMode.BICYCLE,
            durationSeconds = 720,
            distanceMeters = 3400,
        )
        val result = timelineRows(route(RouteLabel.BALANCED).copy(legs = listOf(bike)), arriveBy = null, zone = ZONE)
        val row = result[1]

        assertEquals(RowKind.BICYCLE, row.kind)
        assertEquals("Bike to North Parkade (sample)", row.title)
        assertEquals("12 min · 3.4 km", row.detail)
        assertEquals(bike.from.location, row.at)
        assertEquals(bike.to.location, row.endAt)
    }

    @Test
    fun bikeThenTransitTimelineShowsStationHandoffInOrder() {
        val balanced = route(RouteLabel.BALANCED)
        val transit = balanced.legs.first { it.mode == TripMode.TRANSIT }
        val bike = balanced.legs.first().copy(
            mode = TripMode.BICYCLE,
            to = transit.from,
            durationSeconds = 600,
        )
        val rows = timelineRows(balanced.copy(legs = listOf(bike, transit)), arriveBy = null, zone = ZONE)

        assertEquals(
            listOf(RowKind.LEAVE, RowKind.BICYCLE, RowKind.BICYCLE_TRANSFER, RowKind.BOARD, RowKind.ALIGHT, RowKind.ARRIVE),
            rows.map { it.kind },
        )
        assertEquals("Bike to Sample Station", rows[1].title)
        assertEquals("Lock bike at Sample Station", rows[2].title)
        assertTrue(rows[3].detail.orEmpty().contains("Board at Sample Station"))
    }

    @Test
    fun transitThenBikeTimelineShowsStationHandoffInOrder() {
        val balanced = route(RouteLabel.BALANCED)
        val transit = balanced.legs.first { it.mode == TripMode.TRANSIT }
        val bike = balanced.legs.last().copy(
            mode = TripMode.BICYCLE,
            from = transit.to,
            to = balanced.legs.last().to,
            durationSeconds = 600,
            distanceMeters = 1800,
        )
        val rows = timelineRows(balanced.copy(legs = listOf(transit, bike)), arriveBy = null, zone = ZONE)

        assertEquals(
            listOf(RowKind.LEAVE, RowKind.BOARD, RowKind.ALIGHT, RowKind.BICYCLE_TRANSFER, RowKind.BICYCLE, RowKind.ARRIVE),
            rows.map { it.kind },
        )
        assertEquals("Get off at Waterfront Station", rows[2].title)
        assertEquals("Pick up bike at Waterfront Station", rows[3].title)
        assertEquals("Bike to UBC", rows[4].title)
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
    fun theDriveRowShowsFuelEvenWhenTheLegAlsoCarriesParking() {
        val balanced = route(RouteLabel.BALANCED)
        // the real Planner puts fuel + parking in the drive leg's cost
        val paid = balanced.copy(
            costBreakdown = CostBreakdown(118, 300, 240),
            legs = balanced.legs.mapIndexed { i, leg -> if (i == 0) leg.copy(costCents = 418) else leg },
        )

        assertEquals("14 min \u00B7 9.2 km \u00B7 $1.18 fuel", timelineRows(paid, NINE_AM, ZONE)[1].detail)
    }

    @Test
    fun boardingLeavesOutAMissingDirectionAndStopCount() {
        val leg = route(RouteLabel.BALANCED).legs.first { it.mode == TripMode.TRANSIT }
        val bare = leg.copy(transitLines = leg.transitLines.map { it.copy(headsign = "", stopCount = 0) })
        val oneStop = leg.copy(transitLines = leg.transitLines.map { it.copy(stopCount = 1) })

        assertEquals("Board at Sample Station", boardDetail(bare))
        assertEquals("toward Waterfront \u00B7 Board at Sample Station \u00B7 1 stop", boardDetail(oneStop))
    }

    @Test
    fun linesWithAShortNameShowItLikeGoogleMaps() {
        val line = TransitLine("UBC/Commercial-Broadway", "Bus", null, "UBC", "A", "B", 4, shortName = "99")

        assertEquals("99", line.badgeName)
        assertEquals("Expo Line", line.copy(name = "Expo Line", shortName = null).badgeName)
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
