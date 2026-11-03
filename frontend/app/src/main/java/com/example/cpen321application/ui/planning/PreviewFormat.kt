package com.example.cpen321application.ui.planning

import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.data.TripMode
import com.google.android.gms.maps.model.LatLng
import java.time.Instant
import java.time.ZoneId

/*
 * The text of Trip Preview's summary and timeline, kept out of the composables so it
 * can be unit tested.
 */

private const val METRES_PER_KM = 1000.0

/** What kind of step a timeline row is, which sets its icon. */
enum class RowKind { LEAVE, DRIVE, PARK, WALK, BOARD, ALIGHT, ARRIVE }

/**
 * One row of the Trip Preview timeline.
 *
 * @property at Where the row happens, so tapping it can pan the map there.
 * @property colour A transit line's "#RRGGBB" colour, for board and get-off rows.
 */
data class TimelineRow(
    val kind: RowKind,
    val title: String,
    val detail: String?,
    val time: String?,
    val at: LatLng,
    val colour: String? = null,
)

/**
 * The trip top to bottom: leave, each leg (drive, park, walk, board, get off), arrive.
 * A park row follows a drive that hands off to another mode.
 */
fun timelineRows(route: RouteOption, arriveBy: Instant?, zone: ZoneId = ZoneId.systemDefault()): List<TimelineRow> {
    val legs = route.legs
    if (legs.isEmpty()) return emptyList()
    val rows = mutableListOf(
        TimelineRow(RowKind.LEAVE, "Leave ${legs.first().from.label}", null, clockText(route.leaveAt, zone), legs.first().from.location),
    )
    legs.forEachIndexed { i, leg ->
        when (leg.mode) {
            TripMode.DRIVE -> {
                val detail = "${minutes(leg.durationSeconds)} min · ${kmText(leg.distanceMeters)} · ${costText(leg.costCents)} fuel"
                rows += TimelineRow(RowKind.DRIVE, "Drive to ${leg.to.label}", detail, null, leg.from.location)
                if (i < legs.lastIndex) rows += TimelineRow(RowKind.PARK, "Park at ${leg.to.label}", parkingText(route), clockText(leg.arriveAt, zone), leg.to.location)
            }
            TripMode.WALK -> rows += TimelineRow(
                RowKind.WALK,
                "Walk to ${leg.to.label}",
                "${minutes(leg.durationSeconds)} min · ${kmText(leg.distanceMeters)}",
                null,
                leg.from.location,
            )
            TripMode.TRANSIT -> {
                val line = leg.transitLines.firstOrNull()
                val title = if (line == null) "Transit" else "${line.name} toward ${line.headsign}"
                val from = line?.departureStop ?: leg.from.label
                val stops = line?.let { " · ${it.stopCount} stops" }.orEmpty()
                rows += TimelineRow(RowKind.BOARD, title, "Board at $from$stops", clockText(leg.departAt, zone), leg.from.location, line?.colour)
                rows += TimelineRow(
                    RowKind.ALIGHT,
                    "Get off at ${line?.arrivalStop ?: leg.to.label}",
                    null,
                    clockText(leg.arriveAt, zone),
                    leg.to.location,
                    line?.colour,
                )
            }
        }
    }
    val arrival = lateText(route, arriveBy, zone) ?: punctualityText(route, arriveBy)
    rows += TimelineRow(RowKind.ARRIVE, "Arrive at ${legs.last().to.label}", arrival, clockText(route.arriveAt, zone), legs.last().to.location)
    return rows
}

/** "9.2 km", or "200 m" under a kilometre. */
fun kmText(metres: Int): String = if (metres < METRES_PER_KM) "$metres m" else "%.1f km".format(metres / METRES_PER_KM)

/** "Parking $3.00", "Free parking", or "Parking cost unknown" when the spot's rate isn't known. */
fun parkingText(route: RouteOption): String {
    val cents = route.costBreakdown.parkingCents
    return when {
        cents > 0 -> "Parking ${costText(cents)}"
        route.costEstimated -> "Parking cost unknown"
        else -> "Free parking"
    }
}

/** "Fuel $1.18 + parking $0.00 + fare $2.40", leaving out parts that are zero; `null` for a free trip. */
fun costSplitText(route: RouteOption): String? {
    val parts = route.costBreakdown
    val shown = listOf("Fuel" to parts.fuelCents, "parking" to parts.parkingCents, "fare" to parts.fareCents)
        .filter { (_, cents) -> cents > 0 }
        .map { (name, cents) -> "$name ${costText(cents)}" }
    return shown.takeIf { it.isNotEmpty() }?.joinToString(" + ")?.replaceFirstChar { it.uppercase() }
}

/** "$0.32 cheaper than driving", or `null` when driving's cost is unknown or this isn't cheaper. */
fun savingsText(route: RouteOption): String? {
    val driving = route.baselineDriveCostCents ?: return null
    val saved = driving - route.totalCostCents
    return if (saved > 0) "${costText(saved)} cheaper than driving" else null
}

/** "Arrive 8:56 · 4 min early", "Arrive 9:07 · 7 min late for 9:00", or "Arrive 8:56". */
fun arrivalSummaryText(route: RouteOption, arriveBy: Instant?, zone: ZoneId = ZoneId.systemDefault()): String {
    val note = lateText(route, arriveBy, zone) ?: punctualityText(route, arriveBy)
    val arrive = "Arrive ${clockText(route.arriveAt, zone)}"
    return if (note == null) arrive else "$arrive · $note"
}
