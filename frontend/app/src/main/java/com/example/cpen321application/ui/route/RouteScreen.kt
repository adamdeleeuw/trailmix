package com.example.cpen321application.ui.route

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.cpen321application.data.BackendApi
import com.example.cpen321application.data.ChainedRoute
import com.example.cpen321application.data.DataStoreSessionStore
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState

private val VANCOUVER = LatLng(49.2827, -123.1207)
private val DRIVE_COLOR = Color(0xFF1A73E8) // blue
private val TRANSIT_COLOR = Color(0xFF8E24AA) // purple
private const val LINE_WIDTH = 12f
private const val SECONDS_PER_MINUTE = 60

/** The three points of a chained commute, in the order the user picks them. */
private enum class Stop(val label: String, val hue: Float) {
    START("Start", BitmapDescriptorFactory.HUE_GREEN),
    SPLIT("Split point", BitmapDescriptorFactory.HUE_ORANGE),
    DESTINATION("Destination", BitmapDescriptorFactory.HUE_RED),
}

/**
 * Map for planning a chained commute (#7): tap to set start, split point, then destination.
 *
 * Opened by the place sheet's Directions button until Planning (#73) replaces it.
 *
 * @param onClose Called by the Close button, to go back to the Map tab's home.
 */
@Composable
fun RouteScreen(onClose: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current.applicationContext
    val viewModel = viewModel { RouteViewModel(BackendApi, DataStoreSessionStore(context)) }
    val cameraPositionState = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(VANCOUVER, 12f)
    }
    val stops = Stop.entries
    val points = viewModel.points

    Box(modifier.fillMaxSize()) {
        GoogleMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = cameraPositionState,
            onMapClick = viewModel::addPoint,
        ) {
            viewModel.route?.legs?.forEach { leg ->
                Polyline(
                    points = remember(leg.polyline) { decodePolyline(leg.polyline) },
                    color = if (leg.mode == "DRIVE") DRIVE_COLOR else TRANSIT_COLOR,
                    width = LINE_WIDTH,
                )
            }
            points.forEachIndexed { i, point ->
                Marker(
                    state = remember(point) { MarkerState(position = point) },
                    title = stops[i].label,
                    icon = BitmapDescriptorFactory.defaultMarker(stops[i].hue),
                )
            }
        }

        Card(
            Modifier
                .align(Alignment.TopCenter)
                .statusBarsPadding()
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                StatusText(viewModel, stops)
                if (viewModel.error != null) {
                    TextButton(onClick = viewModel::plan) { Text("Retry") }
                }
                if (points.isNotEmpty()) {
                    TextButton(onClick = viewModel::reset) { Text("Reset") }
                }
                TextButton(onClick = onClose) { Text("Close") }
            }
        }
    }
}

@Composable
private fun RowScope.StatusText(viewModel: RouteViewModel, stops: List<Stop>) {
    val route = viewModel.route
    val error = viewModel.error
    when {
        viewModel.isPlanning -> CircularProgressIndicator(Modifier.padding(8.dp))
        error != null -> Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f, fill = false))
        route != null -> RouteSummary(route)
        else -> Text(stops.getOrNull(viewModel.points.size)?.let { "Tap to set ${it.label.lowercase()}" } ?: "All points set")
    }
}

@Composable
private fun RouteSummary(route: ChainedRoute) {
    Column {
        Text(
            route.legs.joinToString(" · ") { leg ->
                val mode = if (leg.mode == "DRIVE") "Drive" else "Transit"
                "$mode ${minutes(leg.durationSeconds)} min"
            }
        )
        Text("Total ${minutes(route.totalDurationSeconds)} min", style = MaterialTheme.typography.titleMedium)
    }
}

private fun minutes(seconds: Int) = (seconds + SECONDS_PER_MINUTE / 2) / SECONDS_PER_MINUTE // rounded
