package com.example.cpen321application.ui.route

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Card
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.rememberCameraPositionState

private val VANCOUVER = LatLng(49.2827, -123.1207)

/** The three points of a chained commute, in the order the user picks them. */
private enum class Stop(val label: String, val hue: Float) {
    START("Start", BitmapDescriptorFactory.HUE_GREEN),
    SPLIT("Split point", BitmapDescriptorFactory.HUE_ORANGE),
    DESTINATION("Destination", BitmapDescriptorFactory.HUE_RED),
}

/** Map for planning a chained commute (#7): tap to set start, split point, then destination. */
@Composable
fun RouteScreen(modifier: Modifier = Modifier) {
    val cameraPositionState = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(VANCOUVER, 12f)
    }
    val points = remember { mutableStateListOf<LatLng>() }
    val stops = Stop.entries

    Box(modifier.fillMaxSize()) {
        GoogleMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = cameraPositionState,
            onMapClick = { latLng -> if (points.size < stops.size) points.add(latLng) },
        ) {
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
                .align(Alignment.TopCenter).padding(16.dp)
                .statusBarsPadding()
                .padding(horizontal = 16.dp, vertical = 0.dp)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),

            ) {
                Text(
                    if (points.size < stops.size) "Tap to set ${stops[points.size].label.lowercase()}"
                    else "All points set"
                )
                if (points.isNotEmpty()) {
                    TextButton(onClick = { points.clear() }) { Text("Reset") }
                }
            }
        }
    }
}