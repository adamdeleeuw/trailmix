package com.example.cpen321application.ui.main

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider as MenuDivider
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.Trip
import com.example.cpen321application.data.User
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

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
    return trips.filter { trip ->
        val tripDate = trip.tripDate.toInstantOrNull()
        tripDate != null && !tripDate.isBefore(cutoff) && !tripDate.isAfter(now)
    }
}

internal fun sortTrips(trips: List<Trip>, sort: TripHistorySort): List<Trip> = when (sort) {
    TripHistorySort.NEWEST -> trips.sortedByDescending { it.tripDate.toInstantOrNull() ?: Instant.MIN }
    TripHistorySort.LOWEST_COST -> trips.sortedBy { it.totalCostCents }
    TripHistorySort.HIGHEST_COST -> trips.sortedByDescending { it.totalCostCents }
}

private fun String.toInstantOrNull(): Instant? = try {
    Instant.parse(this)
} catch (_: RuntimeException) {
    null
}

/** Signed-in screen with access to the user's saved trip history. */
@Composable
fun TripHistoryScreen(
    user: User,
    tripHistory: TripHistoryViewModel,
    onSignOut: () -> Unit,
    onUnauthorized: () -> Unit,
) {
    var selectedView by rememberSaveable { mutableStateOf<TripHistoryView?>(null) }
    var historyPeriod by rememberSaveable { mutableStateOf(TripHistoryPeriod.LAST_14_DAYS) }
    var insightsPeriod by rememberSaveable { mutableStateOf(TripHistoryPeriod.LAST_14_DAYS) }
    var historySort by rememberSaveable { mutableStateOf(TripHistorySort.NEWEST) }
    Column(
        modifier = Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Signed in as ${user.name}")
        Button(onClick = {
            selectedView = if (selectedView == TripHistoryView.HISTORY) null else TripHistoryView.HISTORY
            if (selectedView != null) tripHistory.load(onUnauthorized)
        }) { Text("Trip history") }
        Button(onClick = {
            selectedView = if (selectedView == TripHistoryView.INSIGHTS) null else TripHistoryView.INSIGHTS
            if (selectedView != null) tripHistory.load(onUnauthorized)
        }) { Text("Commute insights") }
        when (selectedView) {
            TripHistoryView.HISTORY -> TripHistoryContent(
                tripHistory,
                historyPeriod,
                historySort,
                onPeriodSelected = { historyPeriod = it },
                onSortSelected = { historySort = it },
                onUnauthorized = onUnauthorized,
            )
            TripHistoryView.INSIGHTS -> CommuteInsightsContent(
                tripHistory,
                insightsPeriod,
                onPeriodSelected = { insightsPeriod = it },
                onUnauthorized = onUnauthorized,
            )
            null -> Unit
        }
        Button(onClick = onSignOut) { Text("Sign out") }
    }
}

@Composable
private fun TripHistoryContent(
    viewModel: TripHistoryViewModel,
    selectedPeriod: TripHistoryPeriod,
    selectedSort: TripHistorySort,
    onPeriodSelected: (TripHistoryPeriod) -> Unit,
    onSortSelected: (TripHistorySort) -> Unit,
    onUnauthorized: () -> Unit,
) {
    Text("Trip history", style = MaterialTheme.typography.titleLarge)
    TripHistoryOptionsMenu(selectedPeriod, selectedSort, onPeriodSelected, onSortSelected)
    val trips = sortTrips(filterTrips(viewModel.trips.orEmpty(), selectedPeriod), selectedSort)
    when {
        viewModel.isLoading -> CircularProgressIndicator()
        viewModel.loadError != null -> {
            Text(viewModel.loadError!!, color = MaterialTheme.colorScheme.error)
            Button(onClick = { viewModel.load(onUnauthorized) }) { Text("Retry") }
        }
        viewModel.trips.isNullOrEmpty() -> Text("No trips yet.")
        trips.isEmpty() -> Text("No trips found for ${selectedPeriod.label.lowercase(Locale.getDefault())}.")
        else -> trips.forEachIndexed { index, trip ->
            if (index > 0) HorizontalDivider()
            TripHistoryRow(trip)
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
            MenuDivider()
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

@Composable
private fun TripHistoryRow(trip: Trip) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.fillMaxWidth()) {
        Text("${trip.origin.label} to ${trip.destination.label}", style = MaterialTheme.typography.titleMedium)
        Text(formatTripDate(trip.tripDate), style = MaterialTheme.typography.bodyMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(formatDuration(trip.totalDurationSeconds))
            Text(String.format(Locale.getDefault(), "\u0024%.2f", trip.totalCostCents / 100.0))
        }
    }
}

private fun formatTripDate(value: String): String = try {
    DateTimeFormatter.ofPattern("MMM d, yyyy · h:mm a", Locale.getDefault())
        .withZone(ZoneId.systemDefault())
        .format(Instant.parse(value))
} catch (_: RuntimeException) {
    value
}

private fun formatDuration(seconds: Int): String {
    val minutes = seconds / 60
    val hours = minutes / 60
    return if (hours > 0) "${hours}h ${minutes % 60}m" else "${minutes} min"
}

private enum class TripHistoryView { HISTORY, INSIGHTS }