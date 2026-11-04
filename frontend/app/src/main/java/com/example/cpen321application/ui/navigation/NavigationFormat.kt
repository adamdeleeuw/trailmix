package com.example.cpen321application.ui.navigation

import com.example.cpen321application.data.NavigationStep
import com.example.cpen321application.data.PlanLeg
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.data.Trip
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.ui.map.distanceMetres
import com.example.cpen321application.ui.map.formatDistance
import com.example.cpen321application.ui.planning.arrivalSummaryText
import com.example.cpen321application.ui.planning.clockText
import com.example.cpen321application.ui.planning.costText
import com.example.cpen321application.ui.planning.minutes
import com.google.android.gms.maps.model.LatLng
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.roundToInt

/*
 * Navigation's rules and text, kept out of the composables so they can be unit tested.
 */

const val NEXT_LEG_RADIUS_M = 75.0 // close enough to a leg's end (like the parking spot) to move on
const val ARRIVED_RADIUS_M = 50.0 // close enough to the destination to finish the trip
const val END_EARLY_RADIUS_M = 500.0 // further than this, End asks before cancelling the trip
const val TURN_PASSED_M = 15.0 // a turn this far behind the user is done, so the next one shows
const val BOARDED_M = 100.0 // this far along a transit leg, the user is riding it, not waiting for it
private const val SECONDS_PER_MINUTE = 60
private const val METRES_PER_DEGREE = 111_320.0 // of latitude, close enough for the few hundred metres around a fix
private const val DEGREES_PER_TURN = 360f
private const val TURN_ROUNDING_M = 10 // "Turn left in 230 m", rounded like Google Maps
private const val KM = 1000.0

// how far to turn the card's arrow from straight ahead for each of Google's maneuvers, clockwise in degrees
private val MANEUVER_ANGLES = mapOf(
    "TURN_SLIGHT_LEFT" to -45f, "TURN_LEFT" to -90f, "TURN_SHARP_LEFT" to -135f, "UTURN_LEFT" to -180f,
    "TURN_SLIGHT_RIGHT" to 45f, "TURN_RIGHT" to 90f, "TURN_SHARP_RIGHT" to 135f, "UTURN_RIGHT" to 180f,
    "RAMP_LEFT" to -45f, "RAMP_RIGHT" to 45f, "FORK_LEFT" to -45f, "FORK_RIGHT" to 45f,
    "ROUNDABOUT_LEFT" to -90f, "ROUNDABOUT_RIGHT" to 90f,
)

/**
 * Where a location fix is along a leg's line.
 *
 * @property alongMetres How far along the line the closest point to the fix is.
 * @property bearing Which way the line runs there, in degrees clockwise from north, for the camera.
 */
data class LinePosition(val alongMetres: Double, val bearing: Float)

/** Where [here] is along the line through [points], or `null` when the line has fewer than 2 points. */
fun linePosition(points: List<LatLng>, here: LatLng): LinePosition? {
    var best: LinePosition? = null
    var bestOff = Double.MAX_VALUE
    var start = 0.0
    for ((a, b) in points.zipWithNext()) {
        // flat x and y in metres from a, which is accurate enough over one segment
        val scale = cos(Math.toRadians(a.latitude))
        val bx = (b.longitude - a.longitude) * METRES_PER_DEGREE * scale
        val by = (b.latitude - a.latitude) * METRES_PER_DEGREE
        val hx = (here.longitude - a.longitude) * METRES_PER_DEGREE * scale
        val hy = (here.latitude - a.latitude) * METRES_PER_DEGREE
        val length = hypot(bx, by)
        val t = if (length == 0.0) 0.0 else ((hx * bx + hy * by) / (length * length)).coerceIn(0.0, 1.0)
        val off = hypot(hx - t * bx, hy - t * by)
        if (off < bestOff) {
            bestOff = off
            val bearing = Math.toDegrees(atan2(bx, by)).toFloat()
            best = LinePosition(start + t * length, (bearing + DEGREES_PER_TURN) % DEGREES_PER_TURN)
        }
        start += length
    }
    return best
}

/** How long the line through [points] is, in metres. */
fun lineLength(points: List<LatLng>): Double = points.zipWithNext(::distanceMetres).sum()

/**
 * How far along a leg's line each of its turns is. Never decreasing, so a line that passes
 * close to itself can't put a later turn before an earlier one.
 */
fun turnPositions(steps: List<NavigationStep>, points: List<LatLng>): List<Double> =
    steps.map { linePosition(points, it.location)?.alongMetres ?: 0.0 }.runningReduce(::maxOf)

/** The next turn on a leg and how far ahead it is along the line. */
data class UpcomingTurn(val step: NavigationStep, val metres: Double)

/** The first turn the user isn't past yet, [alongMetres] along the leg, or `null` once every turn is behind them. */
fun upcomingTurn(steps: List<NavigationStep>, positions: List<Double>, alongMetres: Double): UpcomingTurn? {
    val index = positions.indexOfFirst { it > alongMetres - TURN_PASSED_M }
    return if (index < 0) null else UpcomingTurn(steps[index], (positions[index] - alongMetres).coerceAtLeast(0.0))
}

/** How far to turn the card's arrow from straight ahead for one of Google's maneuvers, like -90 for "TURN_LEFT". */
fun maneuverAngle(maneuver: String): Float = MANEUVER_ANGLES[maneuver] ?: 0f

/** The distance to the next turn, like "230 m" or "1.4 km", or "Now" once the user is at it. */
fun turnDistanceText(metres: Double): String = when {
    metres < TURN_PASSED_M -> "Now"
    metres < KM -> formatDistance(((metres / TURN_ROUNDING_M).roundToInt() * TURN_ROUNDING_M).toDouble())
    else -> formatDistance(metres)
}

/**
 * The top card's title when there's no turn to show: [legTitle], or once the user is riding a
 * transit leg, where to get off, like "Ride Expo Line to Main Street · 6 stops".
 */
fun cardTitle(route: RouteOption, index: Int, alongMetres: Double?, zone: ZoneId = ZoneId.systemDefault()): String {
    val leg = route.legs[index]
    val riding = leg.mode == TripMode.TRANSIT && alongMetres != null && alongMetres >= BOARDED_M
    return if (riding) rideTitle(leg) else legTitle(route, index, zone)
}

// where a transit leg gets off, with its stop count
private fun rideTitle(leg: PlanLeg): String {
    val line = leg.transitLines.firstOrNull()
    val stop = line?.arrivalStop?.takeIf { it.isNotBlank() } ?: leg.to.label
    val stops = line?.stopCount?.takeIf { it > 0 }?.let { if (it == 1) " · 1 stop" else " · $it stops" }.orEmpty()
    return "Ride ${line?.badgeName ?: "transit"} to $stop$stops"
}

/** "6.2 km to go": what's left of the current leg's line, then every later leg. */
fun remainingText(route: RouteOption, legIndex: Int, leftInLeg: Double): String {
    val later = route.legs.drop(legIndex + 1).sumOf { it.distanceMeters }
    return "${formatDistance(leftInLeg.coerceAtLeast(0.0) + later)} to go"
}

/**
 * Which leg the user should be on, [now] into a trip that started at [actualStart].
 *
 * The planned leg times are moved to start at [actualStart], since a trip saved for later can
 * start long after its planned time. Reopening the app mid-trip lands on the right leg this way.
 */
fun currentLegAt(route: RouteOption, actualStart: Instant?, now: Instant): Int {
    val elapsed = Duration.between(actualStart ?: now, now)
    val index = route.legs.indexOfFirst { Duration.between(route.leaveAt, it.arriveAt) > elapsed }
    return if (index < 0) route.legs.lastIndex else index
}

/** The leg to show after a location fix at [here]: the next one for each leg whose end the user has reached. */
fun legAfterFix(route: RouteOption, index: Int, here: LatLng): Int {
    var leg = index
    while (leg < route.legs.lastIndex && distanceMetres(here, route.legs[leg].to.location) <= NEXT_LEG_RADIUS_M) leg++
    return leg
}

/** Whether [here] is close enough to the destination to finish the trip. */
fun hasArrived(route: RouteOption, here: LatLng): Boolean =
    distanceMetres(here, route.legs.last().to.location) <= ARRIVED_RADIUS_M

/** Whether End should ask "End trip early?" first. Never when the location is unknown, since the user knows best. */
fun isFarFromDestination(route: RouteOption, here: LatLng?): Boolean =
    here != null && distanceMetres(here, route.legs.last().to.location) > END_EARLY_RADIUS_M

/**
 * The top card's title for a leg, like "Drive to North Parkade · 14 min",
 * "Board Expo Line toward King George at 8:31 · 6 stops" or "Walk to destination · 4 min".
 */
fun legTitle(route: RouteOption, index: Int, zone: ZoneId = ZoneId.systemDefault()): String {
    val leg = route.legs[index]
    val duration = "${minutes(leg.durationSeconds)} min"
    return when (leg.mode) {
        TripMode.DRIVE -> "Drive to ${placeName(route, index)} · $duration"
        TripMode.WALK -> "Walk to ${placeName(route, index)} · $duration"
        TripMode.TRANSIT -> {
            val line = leg.transitLines.firstOrNull()
            val parts = listOfNotNull(
                "Board ${line?.badgeName ?: "transit"}",
                line?.headsign?.takeIf { it.isNotBlank() }?.let { "toward $it" },
                "at ${clockText(leg.departAt, zone)}",
            )
            val stops = line?.stopCount?.takeIf { it > 0 }?.let { if (it == 1) " · 1 stop" else " · $it stops" }.orEmpty()
            parts.joinToString(" ") + stops
        }
    }
}

// where a drive or walk leg goes: "destination" for the last leg, the stop when the Planner only says
// "Transit connection", else the place's name
private fun placeName(route: RouteOption, index: Int): String {
    val leg = route.legs[index]
    if (index == route.legs.lastIndex) return "destination"
    val stop = route.legs[index + 1].transitLines.firstOrNull()?.departureStop?.takeIf { it.isNotBlank() }
    return if (leg.to.label.isBlank() || leg.to.label == TRANSIT_CONNECTION) stop ?: "your stop" else leg.to.label
}

private const val TRANSIT_CONNECTION = "Transit connection" // the Planner's label for a walk's end at a stop

/**
 * The bottom bar's arrival, like "Arrive 8:56 · 4 min early". The planned arrival moves with the
 * actual start, so a trip started late from History shows when it will really arrive.
 */
fun etaText(route: RouteOption, actualStart: Instant?, arriveBy: Instant?, zone: ZoneId = ZoneId.systemDefault()): String {
    val eta = actualStart?.plus(Duration.between(route.leaveAt, route.arriveAt)) ?: route.arriveAt
    val lateSeconds = arriveBy?.let { Duration.between(it, eta).seconds } ?: 0
    val lateBy = if (lateSeconds <= 0) 0 else ((lateSeconds + SECONDS_PER_MINUTE - 1) / SECONDS_PER_MINUTE).toInt()
    return arrivalSummaryText(route.copy(arriveAt = eta, lateByMinutes = lateBy), arriveBy, zone)
}

/** The summary after a completed trip, like "42 min · $7.65", timed from its actual start to its actual end. */
fun finishedText(trip: Trip): String {
    val start = trip.actualStart
    val end = trip.actualEnd
    val seconds = if (start != null && end != null) Duration.between(start, end).seconds.toInt() else trip.totalDurationSeconds
    return "${minutes(seconds)} min · ${costText(trip.totalCostCents, trip.route?.costEstimated == true)}"
}
