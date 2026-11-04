package com.example.cpen321application.ui.main

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.Trip
import com.example.cpen321application.data.TripLeg
import com.example.cpen321application.data.TripStatus
import java.time.Duration
import java.util.Locale

private const val METERS_PER_KM = 1000.0

/**
 * The totals for a History period, from its completed trips only.
 *
 * @property waitingSeconds Time between legs, like waiting at a stop for the bus. Each leg only
 *   counts time spent moving, so a gap between one leg's arrival and the next one's departure is
 *   time spent waiting. Trips saved before CP2 have no leg times, so they add no waiting.
 * @property savedVsDrivingCents What driving the whole way would have cost minus what the trips
 *   cost, over trips that know their driving cost. Negative when they cost more than driving.
 */
internal data class TripTotals(
    val tripCount: Int,
    val costCents: Int,
    val fuelCents: Int,
    val parkingCents: Int,
    val fareCents: Int,
    val distanceByMode: Map<String, Long>,
    val durationByMode: Map<String, Long>,
    val waitingSeconds: Long,
    val savedVsDrivingCents: Int,
) {
    val distanceMeters: Long get() = distanceByMode.values.sum()

    // driving + transit + walking + waiting, so the parts always add up to it
    val durationSeconds: Long get() = durationByMode.values.sum() + waitingSeconds
}

/** Adds up the completed trips in [trips], since planned, active and cancelled ones weren't travelled. */
internal fun calculateTripTotals(trips: List<Trip>): TripTotals {
    val completed = trips.filter { it.status == TripStatus.COMPLETED }
    val legsByMode = completed.flatMap { it.legs }.groupBy { it.mode }
    return TripTotals(
        tripCount = completed.size,
        costCents = completed.sumOf { it.totalCostCents },
        fuelCents = completed.sumOf { it.fuelCents },
        parkingCents = completed.sumOf { it.parkingCents },
        fareCents = completed.sumOf { it.fareCents },
        distanceByMode = legsByMode.mapValues { (_, legs) -> legs.sumOf { it.distanceMeters.toLong() } },
        durationByMode = legsByMode.mapValues { (_, legs) -> legs.sumOf { it.durationSeconds.toLong() } },
        waitingSeconds = completed.sumOf { waitingSeconds(it.legs) },
        savedVsDrivingCents = completed.sumOf { trip ->
            trip.baselineDriveCostCents?.let { it - trip.totalCostCents } ?: 0
        },
    )
}

// the gaps between each leg's arrival and the next leg's departure, where a missing time or an overlap adds nothing
private fun waitingSeconds(legs: List<TripLeg>): Long = legs.zipWithNext { leg, next ->
    val arrived = leg.arriveAt
    val departs = next.departAt
    if (arrived == null || departs == null) 0L else Duration.between(arrived, departs).seconds.coerceAtLeast(0L)
}.sum()

/** Shows the period's totals above the History list, or that it has no completed trips. */
@Composable
internal fun TripTotalsHeader(trips: List<Trip>) {
    val totals = calculateTripTotals(trips)
    if (totals.tripCount == 0) {
        Text("No completed trips in this period.")
        return
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            val tripWord = if (totals.tripCount == 1) "trip" else "trips"
            Text("Totals from ${totals.tripCount} completed $tripWord", style = MaterialTheme.typography.titleMedium)
            Text("Cost: ${formatCents(totals.costCents)}")
            Detail(
                "Fuel ${formatCents(totals.fuelCents)} · Parking ${formatCents(totals.parkingCents)} · " +
                    "Fares ${formatCents(totals.fareCents)}",
            )
            Text("Distance: ${formatKm(totals.distanceMeters)}")
            Detail(byMode(totals.distanceByMode, ::formatKm).joinToString(" · "))
            Text("Time: ${formatDuration(totals.durationSeconds)}")
            val waiting = "Waiting ${formatDuration(totals.waitingSeconds)}"
            Detail((byMode(totals.durationByMode, ::formatDuration) + waiting).joinToString(" · "))
            Text("Saved vs driving: ${formatCents(totals.savedVsDrivingCents)}")
        }
    }
}

/** A small grey line of detail, like a total's breakdown or a History row's modes. */
@Composable
internal fun Detail(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

// one "Driving 1h 5m" part per mode, in a fixed order
private fun byMode(amounts: Map<String, Long>, format: (Long) -> String) =
    amounts.toSortedMap().map { (mode, amount) -> "${mode.toModeLabel()} ${format(amount)}" }

// e.g. "12.3 km"
private fun formatKm(meters: Long) = String.format(Locale.getDefault(), "%.1f km", meters / METERS_PER_KM)
