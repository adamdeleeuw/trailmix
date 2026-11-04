package com.example.cpen321application.ui.main

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.data.Trip
import com.example.cpen321application.data.TripStatus
import com.example.cpen321application.ui.planning.RoutePreview
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs

private const val CENTS_PER_DOLLAR = 100.0
private const val SECONDS_PER_MINUTE = 60
private const val MINUTES_PER_HOUR = 60

enum class TripHistoryPeriod(val label: String, val days: Long?) {
    LAST_14_DAYS("Last 14 days", 14),
    LAST_30_DAYS("Last 30 days", 30),
    ALL_TIME("All time", null),
}

enum class TripHistorySort(val label: String) {
    NEWEST("Newest"),
    LOWEST_COST("Lowest cost"),
    HIGHEST_COST("Highest cost"),
}

internal fun filterTrips(
    trips: List<Trip>,
    period: TripHistoryPeriod,
    now: Instant = Instant.now(),
): List<Trip> {
    val days = period.days ?: return trips
    val cutoff = now.minus(days, ChronoUnit.DAYS)
    // no upper bound, since a trip saved for later is dated when it's planned to leave
    return trips.filter { trip -> trip.tripDate.toInstantOrNull()?.isBefore(cutoff) == false }
}

internal fun sortTrips(trips: List<Trip>, sort: TripHistorySort): List<Trip> = when (sort) {
    TripHistorySort.NEWEST -> trips.sortedByDescending { it.tripDate.toInstantOrNull() ?: Instant.MIN }
    TripHistorySort.LOWEST_COST -> trips.sortedBy { it.totalCostCents }
    TripHistorySort.HIGHEST_COST -> trips.sortedByDescending { it.totalCostCents }
}

/** Formats a duration for the History tab, like "1h 5m" or "12 min". */
internal fun formatDuration(seconds: Long): String {
    val minutes = seconds / SECONDS_PER_MINUTE
    val hours = minutes / MINUTES_PER_HOUR
    return if (hours > 0) "${hours}h ${minutes % MINUTES_PER_HOUR}m" else "$minutes min"
}

/** Formats cents as dollars for the History tab, like "$3.40", or "-$1.20" when negative. */
internal fun formatCents(cents: Int): String =
    String.format(Locale.getDefault(), "%s$%.2f", if (cents < 0) "-" else "", abs(cents) / CENTS_PER_DOLLAR)

private fun String.toInstantOrNull(): Instant? = try {
    Instant.parse(this)
} catch (_: RuntimeException) {
    null
}

/** The two views of the History tab, both built from the same saved trips. */
enum class HistoryView(val label: String) {
    TRIPS("Trip history"),
    INSIGHTS("Commute insights"),
}

/**
 * The History tab: the user's saved trips, or insights computed from them.
 *
 * Trips stay loaded while the user switches tabs. Each view keeps its own date range. A
 * planned trip can be started (which opens Navigation) or deleted. Tapping a trip opens it
 * in Trip Preview, read-only, with **Plan again**. Trips saved before CP2 can't be previewed.
 *
 * @param onPlanAgain Opens Planning with the trip's places and modes.
 * @param onUnauthorized Signs the user out when the session is no longer valid.
 */
@Composable
fun TripHistoryScreen(viewModel: TripHistoryViewModel, onPlanAgain: (RouteOption) -> Unit, onUnauthorized: () -> Unit) {
    var view by rememberSaveable { mutableStateOf(HistoryView.TRIPS) }
    var historyPeriod by rememberSaveable { mutableStateOf(TripHistoryPeriod.LAST_14_DAYS) }
    var insightsPeriod by rememberSaveable { mutableStateOf(TripHistoryPeriod.LAST_14_DAYS) }
    var historySort by rememberSaveable { mutableStateOf(TripHistorySort.NEWEST) }
    var previewId by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(viewModel) { viewModel.load(onUnauthorized) }

    val previewing = viewModel.trips?.find { it.id == previewId }
    val route = previewing?.route
    if (route != null) {
        BackHandler { previewId = null }
        RoutePreview(route, previewing.arriveBy, label = null, onBack = { previewId = null }) {
            Button(onClick = { onPlanAgain(route) }, modifier = Modifier.weight(1f)) { Text("Plan again") }
        }
        return
    }
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HistoryView.entries.forEach { option ->
                FilterChip(option == view, onClick = { view = option }, label = { Text(option.label) })
            }
        }
        when (view) {
            HistoryView.TRIPS -> TripHistoryContent(
                viewModel = viewModel,
                options = HistoryOptions(historyPeriod, historySort, { historyPeriod = it }, { historySort = it }),
                onOpen = { previewId = it.id },
                onUnauthorized = onUnauthorized,
            )
            HistoryView.INSIGHTS ->
                CommuteInsightsContent(viewModel, insightsPeriod, { insightsPeriod = it }, onUnauthorized)
        }
    }
}

/** Shows the trip messages ("Saved to History", "Trip started") in a snackbar, wherever the user is. */
@Composable
internal fun rememberTripSnackbar(viewModel: TripHistoryViewModel): SnackbarHostState {
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(viewModel.message) {
        viewModel.message?.let {
            snackbar.showSnackbar(it)
            viewModel.messageShown()
        }
    }
    return snackbar
}

/** Asks "End your current trip?" when the user starts a trip, from Trip Preview or History, while another one is active. */
@Composable
fun EndActiveTripDialog(viewModel: TripHistoryViewModel, onUnauthorized: () -> Unit) {
    if (!viewModel.isConfirmingEndActive) return
    AlertDialog(
        onDismissRequest = viewModel::keepActive,
        title = { Text("End your current trip?") },
        text = { Text("Your active trip will be cancelled, so it won't count in your totals.") },
        confirmButton = {
            TextButton(onClick = { viewModel.endActiveAndStart(onUnauthorized) }) { Text("End and start") }
        },
        dismissButton = { TextButton(onClick = viewModel::keepActive) { Text("Keep current trip") } },
    )
}

/** The trip list's date range and sort, and how to change them. */
private class HistoryOptions(
    val period: TripHistoryPeriod,
    val sort: TripHistorySort,
    val onPeriod: (TripHistoryPeriod) -> Unit,
    val onSort: (TripHistorySort) -> Unit,
)

@Composable
private fun TripHistoryContent(
    viewModel: TripHistoryViewModel,
    options: HistoryOptions,
    onOpen: (Trip) -> Unit,
    onUnauthorized: () -> Unit,
) {
    TripHistoryOptionsMenu(options.period, options.sort, options.onPeriod, options.onSort)
    val inPeriod = filterTrips(viewModel.trips.orEmpty(), options.period)
    when {
        viewModel.isLoading -> CircularProgressIndicator()
        viewModel.loadError != null -> {
            Text(viewModel.loadError!!, color = MaterialTheme.colorScheme.error)
            Button(onClick = { viewModel.load(onUnauthorized) }) { Text("Retry") }
        }
        viewModel.trips.isNullOrEmpty() -> Text("No trips yet.")
        inPeriod.isEmpty() -> Text("No trips in this period.")
        else -> {
            TripTotalsHeader(inPeriod)
            sortTrips(inPeriod, options.sort).forEachIndexed { index, trip ->
                if (index > 0) HorizontalDivider()
                TripHistoryRow(trip, viewModel, onOpen, onUnauthorized)
            }
        }
    }
}

@Composable
private fun TripHistoryOptionsMenu(
    selectedPeriod: TripHistoryPeriod,
    selectedSort: TripHistorySort,
    onPeriodSelected: (TripHistoryPeriod) -> Unit,
    onSortSelected: (TripHistorySort) -> Unit,
) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    Box {
        Button(onClick = { expanded = true }) { Text("${selectedPeriod.label} · ${selectedSort.label}") }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(text = { Text("Date range", style = MaterialTheme.typography.labelLarge) }, onClick = {}, enabled = false)
            TripHistoryPeriod.entries.forEach { period ->
                DropdownMenuItem(
                    text = { Text(if (period == selectedPeriod) "✓ ${period.label}" else period.label) },
                    onClick = {
                        onPeriodSelected(period)
                        expanded = false
                    },
                )
            }
            HorizontalDivider()
            DropdownMenuItem(text = { Text("Sort by", style = MaterialTheme.typography.labelLarge) }, onClick = {}, enabled = false)
            TripHistorySort.entries.forEach { sort ->
                DropdownMenuItem(
                    text = { Text(if (sort == selectedSort) "✓ ${sort.label}" else sort.label) },
                    onClick = {
                        onSortSelected(sort)
                        expanded = false
                    },
                )
            }
        }
    }
}

// tappable when the trip has a route to preview
@Composable
private fun TripHistoryRow(trip: Trip, viewModel: TripHistoryViewModel, onOpen: (Trip) -> Unit, onUnauthorized: () -> Unit) {
    val tap = if (trip.route != null) Modifier.clickable { onOpen(trip) } else Modifier
    Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.fillMaxWidth().then(tap)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "${trip.origin.label} to ${trip.destination.label}",
                Modifier.weight(1f),
                style = MaterialTheme.typography.titleMedium,
            )
            StatusChip(trip.status)
        }
        Text(formatTripDate(trip.tripDate), style = MaterialTheme.typography.bodyMedium)
        Detail(modeStrip(trip))
        trip.route?.transferPoints?.firstOrNull()?.let { Detail("Park at ${it.label}") }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(formatDuration(trip.totalDurationSeconds.toLong()))
            Text(formatCents(trip.totalCostCents))
        }
        TripActions(trip, viewModel, onUnauthorized)
    }
}

// Start and Delete on a planned trip, nothing on others (the active one is ended in Navigation)
@Composable
private fun TripActions(trip: Trip, viewModel: TripHistoryViewModel, onUnauthorized: () -> Unit) {
    if (trip.status != TripStatus.PLANNED) return
    val enabled = !viewModel.isChanging
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = { viewModel.startPlanned(trip, onUnauthorized) }, enabled = enabled) { Text("Start") }
        TextButton(onClick = { viewModel.delete(trip, onUnauthorized) }, enabled = enabled) { Text("Delete") }
    }
}

/** The modes a trip takes in order, like "Driving → Walking → Transit". */
internal fun modeStrip(trip: Trip): String = trip.legs.joinToString(" → ") { it.mode.toModeLabel() }

// "Planned", "Active", "Completed" or "Cancelled"
@Composable
private fun StatusChip(status: TripStatus) {
    Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.secondaryContainer) {
        Text(
            status.name.lowercase(Locale.getDefault()).replaceFirstChar { it.titlecase(Locale.getDefault()) },
            Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

private fun formatTripDate(value: String): String = try {
    DateTimeFormatter.ofPattern("MMM d, yyyy · h:mm a", Locale.getDefault())
        .withZone(ZoneId.systemDefault())
        .format(Instant.parse(value))
} catch (_: RuntimeException) {
    value
}
