package com.example.cpen321application.ui.planning

import com.example.cpen321application.data.PlanLeg
import com.example.cpen321application.data.RouteLabel
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.data.TripMode
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/*
 * The text on Planning's route cards and chips. Kept out of the composables so it can
 * be unit tested. Times are shown in [zone], the phone's time zone by default.
 */

private const val SECONDS_PER_MINUTE = 60
private const val CENTS_PER_DOLLAR = 100
private val CLOCK = DateTimeFormatter.ofPattern("h:mm", Locale.CANADA) // "8:12", like Google Maps

fun labelText(label: RouteLabel) = when (label) {
    RouteLabel.CHEAPEST -> "Cheapest"
    RouteLabel.FASTEST -> "Fastest"
    RouteLabel.BALANCED -> "Balanced"
}

/** "8:12" in the given time zone. */
fun clockText(time: Instant, zone: ZoneId = ZoneId.systemDefault()): String = CLOCK.format(time.atZone(zone))

/** Whole minutes, rounded to the nearest. */
fun minutes(seconds: Int) = (seconds + SECONDS_PER_MINUTE / 2) / SECONDS_PER_MINUTE

/** "$3.40", with " (est.)" when part of the cost is a guess. */
fun costText(cents: Int, estimated: Boolean = false): String {
    val dollars = "$%d.%02d".format(cents / CENTS_PER_DOLLAR, cents % CENTS_PER_DOLLAR)
    return if (estimated) "$dollars (est.)" else dollars
}

/** "11:16 – 12:07", leave to arrive. */
fun timeRangeText(route: RouteOption, zone: ZoneId = ZoneId.systemDefault()) =
    "${clockText(route.leaveAt, zone)} – ${clockText(route.arriveAt, zone)}"

/** "4 min early" or "On time" against the arrive-by time; `null` when leaving now or late (see [lateText]). */
fun punctualityText(route: RouteOption, arriveBy: Instant?): String? {
    if (arriveBy == null || route.lateByMinutes > 0) return null
    val early = Duration.between(route.arriveAt, arriveBy).toMinutes()
    return if (early > 0) "$early min early" else "On time"
}

/** "7 min late for 9:00", or `null` when the route is on time. */
fun lateText(route: RouteOption, arriveBy: Instant?, zone: ZoneId = ZoneId.systemDefault()): String? {
    if (route.lateByMinutes <= 0 || arriveBy == null) return null
    return "${route.lateByMinutes} min late for ${clockText(arriveBy, zone)}"
}

/** One leg's name for the mode strip: "Drive", "Walk", or the line ridden, e.g. "Expo Line". */
fun legName(leg: PlanLeg) = when (leg.mode) {
    TripMode.DRIVE -> "Drive"
    TripMode.WALK -> "Walk"
    TripMode.TRANSIT -> leg.transitLines.firstOrNull()?.badgeName ?: "Transit"
}

/** One piece of a route row's mode strip: "Drive 28", "Walk 4", or a line's name in its colour. */
data class StripItem(val text: String, val mode: TripMode, val colour: String? = null)

/** The mode strip of a route row, one item per leg. Transit shows the line, the others their minutes. */
fun modeStrip(route: RouteOption): List<StripItem> = route.legs.map { leg ->
    when (leg.mode) {
        TripMode.TRANSIT -> StripItem(legName(leg), leg.mode, leg.transitLines.firstOrNull()?.colour)
        else -> StripItem("${legName(leg)} ${minutes(leg.durationSeconds)}", leg.mode)
    }
}

/** "Drive 14 · Walk 3 · Expo Line 20 · Walk 3", minutes per leg. */
fun modeStripText(route: RouteOption) = route.legs.joinToString(" · ") { "${legName(it)} ${minutes(it.durationSeconds)}" }

/** "1 transfer · Park at North Parkade", "No transfers", or "2 transfers". */
fun transfersText(route: RouteOption): String {
    val transfers = when (route.transfers) {
        0 -> "No transfers"
        1 -> "1 transfer"
        else -> "${route.transfers} transfers"
    }
    val spot = route.transferPoints.firstOrNull() ?: return transfers
    return "$transfers · Park at ${spot.label}"
}

/** The arrive-by chip: "Leave now", "Arrive by 9:00", or "Arrive by 9:00 tomorrow". */
fun arriveByChipText(arriveBy: Instant?, zone: ZoneId = ZoneId.systemDefault(), today: LocalDate = LocalDate.now(zone)): String {
    if (arriveBy == null) return "Leave now"
    val day = arriveBy.atZone(zone).toLocalDate()
    val suffix = if (day.isAfter(today)) " tomorrow" else ""
    return "Arrive by ${clockText(arriveBy, zone)}$suffix"
}

/** The Instant for [hour]:[minute] today, or tomorrow when [tomorrow] is set, in [zone]. */
fun arriveByInstant(
    hour: Int,
    minute: Int,
    tomorrow: Boolean,
    zone: ZoneId = ZoneId.systemDefault(),
    today: LocalDate = LocalDate.now(zone),
): Instant {
    val day = if (tomorrow) today.plusDays(1) else today
    return day.atTime(hour, minute).atZone(zone).toInstant()
}

/** How the route list is ordered. Only reorders: changing it never asks the Planner again. */
enum class SortBy { COST, TIME }

/** Cheapest first (ties go to the faster), or fastest first (ties go to the cheaper). */
fun sortRoutes(routes: List<RouteOption>, sortBy: SortBy): List<RouteOption> = when (sortBy) {
    SortBy.COST -> routes.sortedWith(compareBy({ it.totalCostCents }, { it.totalDurationSeconds }))
    SortBy.TIME -> routes.sortedWith(compareBy({ it.totalDurationSeconds }, { it.totalCostCents }))
}

/** A line of the top bar: a place, or the connector between two places saying how you travel it. */
sealed interface TripLine {
    data class Stop(val label: String, val kind: StopKind) : TripLine
    data class Connector(val text: String) : TripLine
}

/** Where a top bar place sits in the trip. A [TRANSFER] is where the mode changes, e.g. a parking spot. */
enum class StopKind { START, TRANSFER, END }

/**
 * The top bar for a route: start, then each mode it uses with the place where it changes
 * to the next, then the destination. "Your location ┊ Drive 14 min ┊ North Parkade ┊ Expo Line · 20 min ┊ UBC".
 *
 * Walking just to reach transit or a car isn't shown (the map shows it); walking is only
 * shown when it's the whole trip. Back-to-back transit legs are one connector
 * ("99 B-Line › Canada Line · 42 min"), since changing buses isn't changing mode.
 * With no route yet it's just start and destination.
 */
fun topBarLines(origin: String, destination: String, route: RouteOption?): List<TripLine> {
    val legs = route?.legs.orEmpty()
    val travelled = if (legs.all { it.mode == TripMode.WALK }) legs else legs.filter { it.mode != TripMode.WALK }
    val groups = mutableListOf<MutableList<PlanLeg>>()
    for (leg in travelled) {
        val last = groups.lastOrNull()
        if (last != null && last.first().mode == leg.mode) last += leg else groups += mutableListOf(leg)
    }

    val lines = mutableListOf<TripLine>(TripLine.Stop(origin, StopKind.START))
    groups.forEachIndexed { i, group ->
        lines += TripLine.Connector(connectorText(group))
        if (i < groups.lastIndex) lines += TripLine.Stop(group.last().to.label, StopKind.TRANSFER)
    }
    lines += TripLine.Stop(destination, StopKind.END)
    return lines
}

// "Drive 14 min", "Walk 25 min", or "99 B-Line › Canada Line · 42 min"
private fun connectorText(group: List<PlanLeg>): String {
    val total = minutes(group.sumOf { it.durationSeconds })
    return when (group.first().mode) {
        TripMode.TRANSIT -> "${group.joinToString(" › ") { legName(it) }} · $total min"
        else -> "${legName(group.first())} $total min"
    }
}

/** "No routes found…", with a nudge to allow longer walks when transit is on and the limit is short. */
fun noRoutesText(modes: Set<TripMode>, maxWalkMinutes: Int): String {
    val base = NO_ROUTES
    val walkHelps = TripMode.TRANSIT in modes && maxWalkMinutes < SHORT_WALK_LIMIT_MINUTES
    return if (walkHelps) "$base Try allowing a longer walk." else base
}

const val NO_ROUTES = "No routes found between these places."
private const val SHORT_WALK_LIMIT_MINUTES = 30
