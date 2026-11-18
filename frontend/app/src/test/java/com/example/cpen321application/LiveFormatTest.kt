package com.example.cpen321application

import com.example.cpen321application.data.LiveAlert
import com.example.cpen321application.data.LiveLeg
import com.example.cpen321application.data.LiveUpdate
import com.example.cpen321application.ui.navigation.CANCELLED_TEXT
import com.example.cpen321application.ui.navigation.LiveStatus
import com.example.cpen321application.ui.navigation.NOT_LIVE_TEXT
import com.example.cpen321application.ui.navigation.alertsAhead
import com.example.cpen321application.ui.navigation.cardTitle
import com.example.cpen321application.ui.navigation.delayText
import com.example.cpen321application.ui.navigation.effectLabel
import com.example.cpen321application.ui.navigation.isCancelled
import com.example.cpen321application.ui.navigation.etaText
import com.example.cpen321application.ui.navigation.liveArrival
import com.example.cpen321application.ui.navigation.liveDeparture
import com.example.cpen321application.ui.navigation.liveStatus
import com.example.cpen321application.ui.navigation.moreAlertsText
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

private const val MINUTE = 60L

// testRoute()'s Expo Line leg (leg 2) boards at minute 19 and arrives at minute 39, the trip's end
private val BOARDS = ROUTE_LEAVES.plusSeconds(19 * MINUTE)
private val ARRIVES = ROUTE_LEAVES.plusSeconds(39 * MINUTE)

private fun alert(id: String, vararg legs: Int, effect: String = "DETOUR") =
    LiveAlert(id, "Header $id", null, effect, legs.toList(), activeUntil = null)

// leg 2 live, `delay` seconds late
private fun liveUpdate(delay: Int, alerts: List<LiveAlert> = emptyList()) = LiveUpdate(
    live = true,
    updatedAt = BOARDS,
    legs = listOf(LiveLeg(2, matched = true, BOARDS.plusSeconds(delay.toLong()), ARRIVES.plusSeconds(delay.toLong()), delay)),
    alerts = alerts,
)

class LiveFormatTest {
    private val route = testRoute()

    @Test
    fun delaysRoundToTheNearestMinuteAndUnderAMinuteIsOnTime() {
        assertEquals("On time", delayText(0))
        assertEquals("On time", delayText(59))
        assertEquals("On time", delayText(-59))
        assertEquals("1 min late", delayText(60))
        assertEquals("3 min late", delayText(170))
        assertEquals("2 min early", delayText(-120))
    }

    @Test
    fun aLiveTransitLegSaysHowLateItIs() {
        assertEquals(LiveStatus("Live · 3 min late", live = true, late = true), liveStatus(route, 2, liveUpdate(180)))
        assertEquals(LiveStatus("Live · On time", live = true, late = false), liveStatus(route, 2, liveUpdate(20)))
        assertEquals(LiveStatus("Live · 2 min early", live = true, late = false), liveStatus(route, 2, liveUpdate(-120)))
    }

    @Test
    fun aTransitLegWithoutLiveTimesSaysScheduled() {
        val notLive = LiveStatus(NOT_LIVE_TEXT, live = false, late = false)
        val unmatched = liveUpdate(0).copy(legs = listOf(LiveLeg(2, matched = false, BOARDS, ARRIVES, null)))

        assertEquals(notLive, liveStatus(route, 2, LiveUpdate.NOT_LIVE))
        assertEquals(notLive, liveStatus(route, 2, liveUpdate(180).copy(live = false)))
        assertEquals(notLive, liveStatus(route, 2, unmatched))
    }

    @Test
    fun aCancelledRunSaysCancelledInsteadOfNotLive() {
        // as the backend sends it: matched, at the scheduled times, with no delay
        val cancelled = liveUpdate(0).copy(legs = listOf(LiveLeg(2, matched = true, BOARDS, ARRIVES, null, cancelled = true)))

        assertEquals(LiveStatus(CANCELLED_TEXT, live = true, late = false, cancelled = true), liveStatus(route, 2, cancelled))
        assertEquals(true, isCancelled(cancelled, 2))
        assertEquals(false, isCancelled(cancelled, 1))
        assertEquals(false, isCancelled(liveUpdate(180), 2))
    }

    @Test
    fun aCancelledRunGivesNoLiveTimes() {
        val cancelled = liveUpdate(0).copy(legs = listOf(LiveLeg(2, matched = true, BOARDS, ARRIVES.plusSeconds(600), null, cancelled = true)))

        assertNull(liveDeparture(cancelled, 2)) // the card keeps the scheduled boarding time
        assertNull(liveArrival(route, 0, cancelled)) // and the arrival isn't moved by a bus that isn't coming
    }

    @Test
    fun aCancelledFlagOnANotLiveUpdateIsIgnored() {
        val stale = LiveUpdate.NOT_LIVE.copy(legs = listOf(LiveLeg(2, matched = true, BOARDS, ARRIVES, null, cancelled = true)))

        assertEquals(false, isCancelled(stale, 2))
        assertEquals(NOT_LIVE_TEXT, liveStatus(route, 2, stale)?.text)
    }

    @Test
    fun driveAndWalkLegsAndTheFirstMomentsShowNoStatus() {
        assertNull(liveStatus(route, 0, liveUpdate(180)))
        assertNull(liveStatus(route, 1, LiveUpdate.NOT_LIVE))
        assertNull(liveStatus(route, 2, update = null)) // before the first answer, so the card doesn't flash "not live"
    }

    @Test
    fun theCardBoardsAtTheLiveTime() {
        val update = liveUpdate(180)

        assertEquals(BOARDS.plusSeconds(180), liveDeparture(update, 2))
        assertNull(liveDeparture(update, 1))
        assertNull(liveDeparture(update.copy(live = false), 2))
        assertEquals(
            "Board Expo Line toward King George at 8:22 · 6 stops",
            cardTitle(route, 2, alongMetres = null, ZoneOffset.UTC, liveDepartAt = liveDeparture(update, 2)),
        )
        assertEquals("Board Expo Line toward King George at 8:19 · 6 stops", cardTitle(route, 2, alongMetres = null, ZoneOffset.UTC))
    }

    @Test
    fun theArrivalMovesWithTheLastLiveLeg() {
        val update = liveUpdate(300)

        assertEquals(ARRIVES.plusSeconds(300), liveArrival(route, 0, update))
        assertEquals("Arrive 8:44", etaText(route, ROUTE_LEAVES, arriveBy = null, ZoneOffset.UTC, liveArrival(route, 0, update)))
        assertEquals("Arrive 8:39", etaText(route, ROUTE_LEAVES, arriveBy = null, ZoneOffset.UTC, liveArrival = null))
    }

    @Test
    fun theArrivalStaysPlannedWithoutALiveLegAhead() {
        assertNull(liveArrival(route, 0, null))
        assertNull(liveArrival(route, 0, LiveUpdate.NOT_LIVE))
        assertNull(liveArrival(route, 0, liveUpdate(300).copy(live = false)))
        val noArrival = liveUpdate(300).copy(legs = listOf(LiveLeg(2, matched = true, BOARDS, arriveAt = null, delaySeconds = 300)))
        assertNull(liveArrival(route, 0, noArrival))
        val pastTheEnd = liveUpdate(300).copy(legs = listOf(LiveLeg(7, matched = true, BOARDS, ARRIVES, 300)))
        assertNull(liveArrival(route, 0, pastTheEnd)) // a leg index the route doesn't have is ignored
    }

    @Test
    fun onlyAlertsOnTheLegsAheadShow() {
        val update = liveUpdate(0, listOf(alert("done", 0), alert("ahead", 2), alert("both", 0, 2)))

        assertEquals(listOf("done", "ahead", "both"), alertsAhead(update, 0).map { it.id })
        assertEquals(listOf("ahead", "both"), alertsAhead(update, 1).map { it.id })
        assertEquals(emptyList<LiveAlert>(), alertsAhead(null, 0))
    }

    @Test
    fun alertsAreLabelledByEffect() {
        assertEquals("Detour", effectLabel("DETOUR"))
        assertEquals("No service", effectLabel("NO_SERVICE"))
        assertEquals("Stop moved", effectLabel("STOP_MOVED"))
        assertEquals("Service alert", effectLabel("UNKNOWN_EFFECT"))
        assertEquals("Service alert", effectLabel("SOMETHING_NEW"))
        assertNull(moreAlertsText(1))
        assertEquals("+2 more", moreAlertsText(3))
    }
}
