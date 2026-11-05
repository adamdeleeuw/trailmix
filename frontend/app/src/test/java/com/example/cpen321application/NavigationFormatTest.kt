package com.example.cpen321application

import com.example.cpen321application.data.NavigationStep
import com.example.cpen321application.ui.navigation.cardTitle
import com.example.cpen321application.ui.navigation.currentLegAt
import com.example.cpen321application.ui.navigation.etaText
import com.example.cpen321application.ui.navigation.finishedText
import com.example.cpen321application.ui.navigation.hasArrived
import com.example.cpen321application.ui.navigation.isFarFromDestination
import com.example.cpen321application.ui.navigation.legAfterFix
import com.example.cpen321application.ui.navigation.legTitle
import com.example.cpen321application.ui.navigation.linePosition
import com.example.cpen321application.ui.navigation.maneuverAngle
import com.example.cpen321application.ui.navigation.remainingText
import com.example.cpen321application.ui.navigation.turnDistanceText
import com.example.cpen321application.ui.navigation.turnPositions
import com.example.cpen321application.ui.navigation.upcomingTurn
import com.google.android.gms.maps.model.LatLng
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private val UTC = ZoneOffset.UTC
private const val MINUTE = 60L

// a point `degrees` of latitude north of a place, where 0.0001 is about 11 m
private fun north(place: LatLng, degrees: Double) = LatLng(place.latitude + degrees, place.longitude)

// a line 0.002 degrees (about 223 m) north from START, then 0.002 degrees east
private val START = LatLng(49.0, -123.0)
private val CORNER = north(START, 0.002)
private val LINE = listOf(START, north(START, 0.001), CORNER, LatLng(CORNER.latitude, CORNER.longitude + 0.002))
private val DEPART = NavigationStep("Head north on Main St", "DEPART", START)
private val RIGHT_TURN = NavigationStep("Turn right onto 1st Ave", "TURN_RIGHT", CORNER)
private const val TOLERANCE_M = 1.0

class NavigationFormatTest {
    private val route = testRoute()

    @Test
    fun theLegFollowsTheActualStartNotThePlannedOne() {
        val started = ROUTE_LEAVES.plusSeconds(120 * MINUTE) // saved for later, started two hours after its planned time

        assertEquals(0, currentLegAt(route, started, now = started))
        assertEquals(1, currentLegAt(route, started, now = started.plusSeconds(12 * MINUTE))) // driving took 10 min
        assertEquals(2, currentLegAt(route, started, now = started.plusSeconds(50 * MINUTE))) // past the end stays on the last
        assertEquals(0, currentLegAt(route, actualStart = null, now = started))
    }

    @Test
    fun reachingALegsEndMovesToTheNextLeg() {
        val parkade = ROUTE_PARKADE.location

        assertEquals(0, legAfterFix(route, 0, north(parkade, 0.0009))) // 100 m away, still driving
        assertEquals(1, legAfterFix(route, 0, north(parkade, 0.0006))) // 67 m away, but over 75 m from the station
        assertEquals(2, legAfterFix(route, 0, parkade)) // the station is under 75 m from the parkade too
        assertEquals(2, legAfterFix(route, 2, ROUTE_UBC.location)) // never past the last leg
    }

    @Test
    fun arrivingIsWithin50MetresOfTheDestination() {
        assertTrue(hasArrived(route, north(ROUTE_UBC.location, 0.0003))) // 33 m
        assertFalse(hasArrived(route, north(ROUTE_UBC.location, 0.0006))) // 67 m
    }

    @Test
    fun endAsksFirstOnlyWhenKnownToBeOver500MetresAway() {
        assertTrue(isFarFromDestination(route, north(ROUTE_UBC.location, 0.0054))) // 600 m
        assertFalse(isFarFromDestination(route, north(ROUTE_UBC.location, 0.0036))) // 400 m
        assertFalse(isFarFromDestination(route, here = null))
    }

    @Test
    fun theCardSaysWhatToDoOnEachLeg() {
        assertEquals("Drive to North Parkade · 10 min", legTitle(route, 0, UTC))
        assertEquals("Walk to Commercial-Broadway · 5 min", legTitle(route, 1, UTC)) // the stop, not "Transit connection"
        assertEquals("Board Expo Line toward King George at 8:19 · 6 stops", legTitle(route, 2, UTC))
        assertEquals("Drive to destination · 10 min", legTitle(route.copy(legs = route.legs.take(1)), 0, UTC))
    }

    @Test
    fun theArrivalMovesWithTheActualStart() {
        val nine = ROUTE_LEAVES.plusSeconds(60 * MINUTE)

        assertEquals("Arrive 8:39", etaText(route, actualStart = null, arriveBy = null, UTC))
        assertEquals("Arrive 8:39 · 21 min early", etaText(route, ROUTE_LEAVES, nine, UTC))
        assertEquals("Arrive 9:09 · 9 min late for 9:00", etaText(route, ROUTE_LEAVES.plusSeconds(30 * MINUTE), nine, UTC))
    }

    @Test
    fun theSummaryUsesTheActualTimes() {
        val trip = testTrip(cost = 765, duration = 39 * 60).copy(route = route)
            .copy(actualStart = ROUTE_LEAVES, actualEnd = ROUTE_LEAVES.plusSeconds(42 * MINUTE))

        assertEquals("42 min · $7.65", finishedText(trip))
        assertEquals("39 min · $7.65", finishedText(trip.copy(actualEnd = null)))
    }

    @Test
    fun aFixIsPlacedAlongTheLineFacingTheWayItRuns() {
        val beside = LatLng(START.latitude + 0.001, START.longitude + 0.0001) // 111 m up the line, 7 m east of it
        val position = linePosition(LINE, beside)!!

        assertEquals(111.3, position.alongMetres, TOLERANCE_M)
        assertEquals(0f, position.bearing, 1f) // north
        assertEquals(90f, linePosition(LINE, LatLng(CORNER.latitude, CORNER.longitude + 0.001))!!.bearing, 1f) // east
        assertNull(linePosition(listOf(START), beside))
    }

    @Test
    fun theNextTurnIsTheFirstOneNotPassed() {
        val steps = listOf(DEPART, RIGHT_TURN)
        val positions = turnPositions(steps, LINE)

        assertEquals(DEPART, upcomingTurn(steps, positions, alongMetres = 0.0)?.step)
        assertEquals(RIGHT_TURN, upcomingTurn(steps, positions, alongMetres = 20.0)?.step) // the start is 20 m behind
        assertEquals(203.0, upcomingTurn(steps, positions, alongMetres = 20.0)!!.metres, TOLERANCE_M)
        assertEquals(0.0, upcomingTurn(steps, positions, alongMetres = 230.0)!!.metres, 0.0) // just past it, still "Now"
        assertNull(upcomingTurn(steps, positions, alongMetres = 250.0)) // every turn behind
    }

    @Test
    fun turnPositionsNeverGoBackwards() {
        val backAtStart = NavigationStep("Turn around", "UTURN_LEFT", START) // closest to the start of the line

        assertEquals(listOf(223.0, 223.0), turnPositions(listOf(RIGHT_TURN, backAtStart), LINE).map { Math.round(it).toDouble() })
    }

    @Test
    fun theArrowAndDistanceMatchTheTurn() {
        assertEquals(-90f, maneuverAngle("TURN_LEFT"), 0f)
        assertEquals(180f, maneuverAngle("UTURN_RIGHT"), 0f)
        assertEquals(0f, maneuverAngle("NAME_CHANGE"), 0f) // straight on for anything else
        assertEquals("Now", turnDistanceText(5.0))
        assertEquals("230 m", turnDistanceText(234.0))
        assertEquals("1.4 km", turnDistanceText(1400.0))
    }

    @Test
    fun aTransitCardSaysWhereToGetOffOnceRiding() {
        assertEquals("Board Expo Line toward King George at 8:19 · 6 stops", cardTitle(route, 2, alongMetres = null, UTC))
        assertEquals("Board Expo Line toward King George at 8:19 · 6 stops", cardTitle(route, 2, alongMetres = 20.0, UTC))
        assertEquals("Ride Expo Line to Main Street · 6 stops", cardTitle(route, 2, alongMetres = 150.0, UTC))
        assertEquals("Drive to North Parkade · 10 min", cardTitle(route, 0, alongMetres = 150.0, UTC))
    }

    @Test
    fun theDistanceLeftIsTheRestOfThisLegAndEveryLaterOne() {
        assertEquals("2.5 km to go", remainingText(route, 0, leftInLeg = 500.0)) // the walk and the ride are 1 km each
        assertEquals("300 m to go", remainingText(route, 2, leftInLeg = 300.0))
    }
}
