package com.example.cpen321application.ui.main

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.Trip
import java.util.Locale

internal data class CommuteInsightSummary(
    val tripCount: Int,
    val averageDurationSeconds: Int,
    val averageCostCents: Int,
    val durationByMode: Map<String, Long>,
) {
    val totalModeDurationSeconds: Long get() = durationByMode.values.sum()
}

internal fun calculateCommuteInsights(trips: List<Trip>): CommuteInsightSummary {
    val durationsByMode = mutableMapOf<String, Long>()
    trips.forEach { trip ->
        trip.legs.forEach { leg ->
            durationsByMode[leg.mode] = (durationsByMode[leg.mode] ?: 0L) + leg.durationSeconds
        }
    }
    return CommuteInsightSummary(
        tripCount = trips.size,
        averageDurationSeconds = if (trips.isEmpty()) 0 else trips.sumOf { it.totalDurationSeconds } / trips.size,
        averageCostCents = if (trips.isEmpty()) 0 else trips.sumOf { it.totalCostCents } / trips.size,
        durationByMode = durationsByMode,
    )
}

internal fun modePercentages(durationByMode: Map<String, Long>): Map<String, Int> {
    val total = durationByMode.values.sum()
    if (total <= 0L) return durationByMode.keys.associateWith { 0 }

    val exactPercentages = durationByMode.mapValues { (_, seconds) -> seconds * 100.0 / total }
    val percentages = exactPercentages.mapValues { (_, percentage) -> kotlin.math.floor(percentage).toInt() }.toMutableMap()
    var pointsLeft = 100 - percentages.values.sum()
    exactPercentages.entries
        .sortedByDescending { it.value - kotlin.math.floor(it.value) }
        .take(pointsLeft)
        .forEach { entry -> percentages[entry.key] = percentages.getValue(entry.key) + 1 }
    return percentages
}

@Composable
internal fun CommuteInsightsContent(
    viewModel: TripHistoryViewModel,
    selectedPeriod: TripHistoryPeriod,
    onPeriodSelected: (TripHistoryPeriod) -> Unit,
    onUnauthorized: () -> Unit,
) {
    Text("Commute insights", style = MaterialTheme.typography.titleLarge)
    PeriodMenu(selectedPeriod, onPeriodSelected)
    when {
        viewModel.isLoading -> CircularProgressIndicator()
        viewModel.loadError != null -> {
            Text(viewModel.loadError!!, color = MaterialTheme.colorScheme.error)
            Button(onClick = { viewModel.load(onUnauthorized) }) { Text("Retry") }
        }
        else -> {
            val trips = viewModel.trips?.let { filterTrips(it, selectedPeriod) }.orEmpty()
            if (trips.isEmpty()) {
                Text("No trips found for ${selectedPeriod.label.lowercase(Locale.getDefault())}.")
            } else {
                val summary = calculateCommuteInsights(trips)
                Text("Based on ${summary.tripCount} ${if (summary.tripCount == 1) "trip" else "trips"}")
                Text("Average time: ${formatDuration(summary.averageDurationSeconds)}")
                Text(String.format(Locale.getDefault(), "Average cost: \u0024%.2f", summary.averageCostCents / 100.0))
                if (summary.totalModeDurationSeconds > 0L) {
                    Text("Time by transportation", style = MaterialTheme.typography.titleMedium)
                    ModeTimePieChart(summary)
                }
            }
        }
    }
}

@Composable
private fun PeriodMenu(selectedPeriod: TripHistoryPeriod, onPeriodSelected: (TripHistoryPeriod) -> Unit) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    Box {
        Button(onClick = { expanded = true }) { Text(selectedPeriod.label) }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            TripHistoryPeriod.entries.forEach { period ->
                DropdownMenuItem(
                    text = { Text(period.label) },
                    onClick = {
                        onPeriodSelected(period)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun ModeTimePieChart(summary: CommuteInsightSummary) {
    val colors = MaterialTheme.colorScheme
    val modeColors = mapOf("DRIVE" to colors.primary, "TRANSIT" to colors.tertiary)
    val percentages = modePercentages(summary.durationByMode)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(24.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Canvas(Modifier.weight(1f).aspectRatio(1f).padding(8.dp)) {
            val chartColors = mapOf("DRIVE" to colors.primary, "TRANSIT" to colors.tertiary)
            var startAngle = -90f
            summary.durationByMode.toSortedMap().forEach { (mode, seconds) ->
                val sweepAngle = 360f * seconds / summary.totalModeDurationSeconds
                drawArc(
                    color = chartColors[mode] ?: colors.secondary,
                    startAngle = startAngle,
                    sweepAngle = sweepAngle,
                    useCenter = true,
                )
                startAngle += sweepAngle
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            summary.durationByMode.toSortedMap().forEach { (mode, seconds) ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Canvas(Modifier.size(12.dp)) {
                        drawCircle(color = modeColors[mode] ?: colors.secondary)
                    }
                    Text("${mode.toModeLabel()}: ${percentages.getValue(mode)}%")
                }
            }
        }
    }
}

private fun String.toModeLabel() = when (this) {
    "DRIVE" -> "Driving"
    "TRANSIT" -> "Transit"
    else -> replaceFirstChar { it.titlecase(Locale.getDefault()) }
}

private fun formatDuration(seconds: Int): String {
    val minutes = seconds / 60
    val hours = minutes / 60
    return if (hours > 0) "${hours}h ${minutes % 60}m" else "${minutes} min"
}
