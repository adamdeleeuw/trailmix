package com.example.cpen321application

import com.example.cpen321application.data.FakePlannerApi
import com.example.cpen321application.data.PlanPlace
import com.example.cpen321application.data.PlanRequest
import com.example.cpen321application.data.RouteLabel
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.ui.planning.arriveByChipText
import com.example.cpen321application.ui.planning.arriveByInstant
import com.example.cpen321application.ui.planning.costText
import com.example.cpen321application.ui.planning.SortBy
import com.example.cpen321application.ui.planning.StopKind
import com.example.cpen321application.ui.planning.StripItem
import com.example.cpen321application.ui.planning.TripLine
import com.example.cpen321application.ui.planning.lateText
import com.example.cpen321application.ui.planning.minutes
import com.example.cpen321application.ui.planning.noRoutesText
import com.example.cpen321application.ui.planning.modeStrip
import com.example.cpen321application.ui.planning.modeStripText
import com.example.cpen321application.ui.planning.punctualityText
import com.example.cpen321application.ui.planning.sortRoutes
import com.example.cpen321application.ui.planning.timeRangeText
import com.example.cpen321application.ui.planning.topBarLines
import com.example.cpen321application.ui.planning.transfersText
import com.google.android.gms.maps.model.LatLng
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

// a fixed offset rather than "America/Vancouver", so the tests don't depend on the machine's time zone rules
private val VANCOUVER = ZoneId.of("-07:00")
private val NOV_2 = LocalDate.of(2026, 11, 2)
private val NINE_AM = Instant.parse("2026-11-02T16:00:00Z") // 9:00 at UTC-7

class PlanningFormatTest {
    private lateinit var routes: Map<RouteLabel, RouteOption>

    @Before
    fun setUp() = runTest {
        val api = FakePlannerApi(delayMs = 0)
        val request = PlanRequest(
            PlanPlace("UBC", LatLng(49.2606, -123.2460)),
            PlanPlace("Waterfront", LatLng(49.2858, -123.1118)),
            arriveBy = NINE_AM,
            modes = setOf(TripMode.DRIVE, TripMode.TRANSIT),
        )
        routes = api.planTrip("token", request).options.associateBy { it.label }
    }

    @Test
    fun noRoutesSuggestsALongerWalkOnlyWhenThatCouldHelp() {
        val hint = "No routes found between these places. Try allowing a longer walk."
        assertEquals(hint, noRoutesText(setOf(TripMode.TRANSIT), maxWalkMinutes = 10))
        assertEquals("No routes found between these places.", noRoutesText(setOf(TripMode.DRIVE), maxWalkMinutes = 10))
        assertEquals("No routes found between these places.", noRoutesText(setOf(TripMode.TRANSIT), maxWalkMinutes = 30))
    }

    @Test
    fun costsAreDollarsAndCents() {
        assertEquals("$3.40", costText(340))
        assertEquals("$0.05", costText(5))
        assertEquals("$12.00 (est.)", costText(1200, estimated = true))
    }

    @Test
    fun minutesRoundToTheNearest() {
        assertEquals(1, minutes(89))
        assertEquals(2, minutes(90))
    }

    @Test
    fun theTimeRangeIsLeaveToArrive() {
        assertEquals("8:16 \u2013 8:56", timeRangeText(routes.getValue(RouteLabel.BALANCED), VANCOUVER)) // arrives 4 min early
    }

    @Test
    fun punctualitySaysHowEarlyOnlyWithAnArriveByTime() {
        assertEquals("4 min early", punctualityText(routes.getValue(RouteLabel.BALANCED), NINE_AM))
        assertEquals("On time", punctualityText(routes.getValue(RouteLabel.FASTEST), NINE_AM))
        assertNull(punctualityText(routes.getValue(RouteLabel.BALANCED), arriveBy = null))
        assertNull(punctualityText(routes.getValue(RouteLabel.FASTEST).copy(lateByMinutes = 3), NINE_AM)) // late shows instead
    }

    @Test
    fun sortingByCostOrTimeBreaksTiesTheOtherWay() {
        val all = routes.values.toList()

        assertEquals(
            listOf(RouteLabel.CHEAPEST, RouteLabel.BALANCED, RouteLabel.FASTEST),
            sortRoutes(all, SortBy.COST).map { it.label },
        )
        assertEquals(
            listOf(RouteLabel.FASTEST, RouteLabel.BALANCED, RouteLabel.CHEAPEST),
            sortRoutes(all, SortBy.TIME).map { it.label },
        )
        val sameCost = routes.getValue(RouteLabel.FASTEST).copy(totalCostCents = 335)
        assertEquals(RouteLabel.FASTEST, sortRoutes(listOf(routes.getValue(RouteLabel.CHEAPEST), sameCost), SortBy.COST).first().label)
    }

    @Test
    fun theModeStripShowsLinesWithTheirColoursAndOtherLegsWithMinutes() {
        assertEquals(
            listOf(
                StripItem("Drive 14", TripMode.DRIVE),
                StripItem("Walk 3", TripMode.WALK),
                StripItem("Expo Line", TripMode.TRANSIT, "#0060A9"),
                StripItem("Walk 3", TripMode.WALK),
            ),
            modeStrip(routes.getValue(RouteLabel.BALANCED)),
        )
        assertNull(modeStrip(routes.getValue(RouteLabel.CHEAPEST))[1].colour) // the sample bus has no colour
    }

    @Test
    fun theTopBarShowsEachModeAndWhereItChanges() {
        assertEquals(
            listOf(
                TripLine.Stop("Your location", StopKind.START),
                TripLine.Connector("Drive 14 min"),
                TripLine.Stop("North Parkade (sample)", StopKind.TRANSFER),
                TripLine.Connector("Expo Line \u00B7 20 min"),
                TripLine.Stop("UBC", StopKind.END),
            ),
            topBarLines("Your location", "UBC", routes.getValue(RouteLabel.BALANCED)),
        )
    }

    @Test
    fun theTopBarMergesBackToBackTransitAndHidesWalksToIt() {
        assertEquals(
            listOf(
                TripLine.Stop("Your location", StopKind.START),
                TripLine.Connector("99 B-Line \u203A Canada Line \u00B7 42 min"),
                TripLine.Stop("UBC", StopKind.END),
            ),
            topBarLines("Your location", "UBC", routes.getValue(RouteLabel.CHEAPEST)),
        )
    }

    @Test
    fun theTopBarShowsWalkingWhenWalkingIsTheTrip() {
        val fastest = routes.getValue(RouteLabel.FASTEST)
        val walk = fastest.copy(legs = fastest.legs.map { it.copy(mode = TripMode.WALK, durationSeconds = 1500) })

        assertEquals(TripLine.Connector("Walk 25 min"), topBarLines("Here", "There", walk)[1])
    }

    @Test
    fun withNoRouteTheTopBarIsJustStartAndDestination() {
        assertEquals(
            listOf(TripLine.Stop("Choose start point", StopKind.START), TripLine.Stop("UBC", StopKind.END)),
            topBarLines("Choose start point", "UBC", route = null),
        )
    }

    @Test
    fun aLateRouteSaysHowLate() {
        val late = routes.getValue(RouteLabel.FASTEST).copy(lateByMinutes = 7)

        assertEquals("7 min late for 9:00", lateText(late, NINE_AM, VANCOUVER))
        assertNull(lateText(routes.getValue(RouteLabel.FASTEST), NINE_AM, VANCOUVER))
    }

    @Test
    fun theModeStripNamesLinesAndMinutes() {
        assertEquals("Drive 14 · Walk 3 · Expo Line 20 · Walk 3", modeStripText(routes.getValue(RouteLabel.BALANCED)))
        assertEquals("Drive 28", modeStripText(routes.getValue(RouteLabel.FASTEST)))
    }

    @Test
    fun transfersMentionTheParkingSpot() {
        assertEquals("1 transfer · Park at North Parkade (sample)", transfersText(routes.getValue(RouteLabel.BALANCED)))
        assertEquals("No transfers", transfersText(routes.getValue(RouteLabel.FASTEST)))
        assertEquals("2 transfers", transfersText(routes.getValue(RouteLabel.CHEAPEST).copy(transfers = 2)))
    }

    @Test
    fun theArriveByChipSaysTodayOrTomorrow() {
        assertEquals("Leave now", arriveByChipText(null, VANCOUVER, NOV_2))
        assertEquals("Arrive by 9:00", arriveByChipText(NINE_AM, VANCOUVER, NOV_2))
        assertEquals("Arrive by 9:00 tomorrow", arriveByChipText(NINE_AM, VANCOUVER, NOV_2.minusDays(1)))
    }

    @Test
    fun pickedTimesBecomeInstantsInTheLocalZone() {
        assertEquals(NINE_AM, arriveByInstant(9, 0, tomorrow = false, zone = VANCOUVER, today = NOV_2))
        assertEquals(NINE_AM, arriveByInstant(9, 0, tomorrow = true, zone = VANCOUVER, today = NOV_2.minusDays(1)))
    }
}
