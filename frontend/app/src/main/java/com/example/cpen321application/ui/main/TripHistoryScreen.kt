package com.example.cpen321application.ui.main

import androidx.compose.foundation.layout.Arrangement
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
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Signed-in screen with access to the user's saved trip history. */
@Composable
fun TripHistoryScreen(
    user: User,
    tripHistory: TripHistoryViewModel,
    onSignOut: () -> Unit,
    onUnauthorized: () -> Unit,
) {
    var showingHistory by rememberSaveable { mutableStateOf(false) }
    Column(
        modifier = Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Signed in as ${user.name}")
        Button(onClick = {
            showingHistory = !showingHistory
            if (showingHistory) tripHistory.load(onUnauthorized)
        }) { Text("Trip history") }
        if (showingHistory) TripHistoryContent(tripHistory, onUnauthorized)
        Button(onClick = onSignOut) { Text("Sign out") }
    }
}

@Composable
private fun TripHistoryContent(viewModel: TripHistoryViewModel, onUnauthorized: () -> Unit) {
    Text("Trip history", style = MaterialTheme.typography.titleLarge)
    when {
        viewModel.isLoading -> CircularProgressIndicator()
        viewModel.loadError != null -> {
            Text(viewModel.loadError!!, color = MaterialTheme.colorScheme.error)
            Button(onClick = { viewModel.load(onUnauthorized) }) { Text("Retry") }
        }
        viewModel.trips.isNullOrEmpty() -> Text("No trips yet.")
        else -> viewModel.trips.orEmpty().forEachIndexed { index, trip ->
            if (index > 0) HorizontalDivider()
            TripHistoryRow(trip)
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