package com.example.cpen321application.ui.navigation

import com.example.cpen321application.data.LiveAlert
import com.example.cpen321application.data.LiveLeg
import com.example.cpen321application.data.LiveUpdate
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.data.TripMode
import java.time.Duration
import java.time.Instant
import kotlin.math.abs

/*
 * How Navigation shows TransLink's live times and alerts (#87), kept out of the composables so they can be unit tested.
 */

/** Shown on a transit leg when its times aren't live. */
const val NOT_LIVE_TEXT = "Scheduled times, not live"

/** Shown on a transit leg when TransLink has cancelled its run. */
const val CANCELLED_TEXT = "Cancelled"
private const val ON_TIME_SECONDS = 60 // within a minute either way is on time, like TransLink's signs
private const val SECONDS_PER_MINUTE = 60

// GTFS-RT's Alert.Effect names, as the banner labels them
private val EFFECT_LABELS = mapOf(
    "NO_SERVICE" to "No service",
    "REDUCED_SERVICE" to "Reduced service",
    "SIGNIFICANT_DELAYS" to "Significant delays",
    "DETOUR" to "Detour",
    "ADDITIONAL_SERVICE" to "Extra service",
    "MODIFIED_SERVICE" to "Service change",
    "STOP_MOVED" to "Stop moved",
    "ACCESSIBILITY_ISSUE" to "Accessibility",
)

/** The live times of leg [legIndex], when the update is live and TransLink predicted that leg's run, and it's running. */
fun liveLeg(update: LiveUpdate?, legIndex: Int): LiveLeg? =
    update?.takeIf { it.live }?.legs?.firstOrNull { it.legIndex == legIndex && it.matched && !it.cancelled }

/** Whether TransLink has cancelled the run leg [legIndex] was planned to ride. */
fun isCancelled(update: LiveUpdate?, legIndex: Int): Boolean =
    update?.takeIf { it.live }?.legs?.any { it.legIndex == legIndex && it.cancelled } == true

/** How late a run is, like "3 min late", "2 min early" or "On time", rounded to the nearest minute. */
fun delayText(seconds: Int): String {
    if (abs(seconds) < ON_TIME_SECONDS) return "On time"
    val minutes = (abs(seconds) + SECONDS_PER_MINUTE / 2) / SECONDS_PER_MINUTE
    return if (seconds > 0) "$minutes min late" else "$minutes min early"
}

/** How a leg's live status reads, and whether it's worth drawing attention to. */
data class LiveStatus(val text: String, val live: Boolean, val late: Boolean, val cancelled: Boolean = false)

/**
 * The line under a transit leg's title: "Live · 3 min late" when TransLink predicted its run, [CANCELLED_TEXT] when
 * it cancelled it, else [NOT_LIVE_TEXT]. `null` for a drive or walk leg, and before the first answer, so the card
 * doesn't flash "not live" on opening.
 */
fun liveStatus(route: RouteOption, legIndex: Int, update: LiveUpdate?): LiveStatus? {
    if (update == null || route.legs.getOrNull(legIndex)?.mode != TripMode.TRANSIT) return null
    if (isCancelled(update, legIndex)) return LiveStatus(CANCELLED_TEXT, live = true, late = false, cancelled = true)
    val leg = liveLeg(update, legIndex) ?: return LiveStatus(NOT_LIVE_TEXT, live = false, late = false)
    val delay = leg.delaySeconds ?: 0
    return LiveStatus("Live · ${delayText(delay)}", live = true, late = delay >= ON_TIME_SECONDS)
}

/** When leg [legIndex]'s run really leaves, when that's live, for the card's "Board … at 8:42". */
fun liveDeparture(update: LiveUpdate?, legIndex: Int): Instant? = liveLeg(update, legIndex)?.departAt

/**
 * The trip's arrival with live times: the last live transit leg's predicted arrival, plus the planned time from that
 * leg's end to the destination. `null` when no transit leg from [legIndex] on is live, so the planned arrival stands.
 */
fun liveArrival(route: RouteOption, legIndex: Int, update: LiveUpdate?): Instant? {
    val last = update?.takeIf { it.live }?.legs
        ?.filter { it.matched && !it.cancelled && it.arriveAt != null && it.legIndex >= legIndex && it.legIndex < route.legs.size }
        ?.maxByOrNull { it.legIndex } ?: return null
    val arriveAt = last.arriveAt ?: return null
    return arriveAt.plus(Duration.between(route.legs[last.legIndex].arriveAt, route.arriveAt))
}

/** The alerts on leg [legIndex] or a later one, in the backend's order; ones only on finished legs are left out. */
fun alertsAhead(update: LiveUpdate?, legIndex: Int): List<LiveAlert> =
    update?.alerts?.filter { alert -> alert.legIndexes.any { it >= legIndex } }.orEmpty()

/** The banner's label for an alert's effect, like "Detour", or "Service alert" for the vaguer ones. */
fun effectLabel(effect: String): String = EFFECT_LABELS[effect] ?: "Service alert"

/** The banner's "+2 more" when there's more than one alert, else `null`. */
fun moreAlertsText(count: Int): String? = if (count > 1) "+${count - 1} more" else null
