package com.example.cpen321application.ui.map

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.CameraPositionState
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerComposable
import com.google.maps.android.compose.MarkerState

private val PARKING_BLUE = Color(0xFF1A73E8) // the same blue as the planner's driving line
private val P_MARKER_SIZE = 32.dp
private val P_MARKER_CORNER = 8.dp
private val P_MARKER_BORDER = 2.dp

/**
 * The map: every saved spot as a P marker, a pin for an unsaved selected place, and the
 * location dot when location is allowed.
 *
 * @param bottomPadding Space the sheet covers, so the Google logo stays visible above it.
 * @param onLongPress Called with the long-pressed point, to drop a pin there.
 */
@Composable
fun ParkingMap(
    camera: CameraPositionState,
    showLocation: Boolean,
    spots: ParkingSpotsViewModel,
    bottomPadding: Dp,
    onLongPress: (LatLng) -> Unit,
) {
    val selected = spots.selected
    GoogleMap(
        modifier = Modifier.fillMaxSize(),
        cameraPositionState = camera,
        properties = MapProperties(isMyLocationEnabled = showLocation),
        // the screen's own recenter button replaces Google's, which sits under the search bar
        uiSettings = MapUiSettings(myLocationButtonEnabled = false, zoomControlsEnabled = false),
        contentPadding = PaddingValues(bottom = bottomPadding),
        onMapLongClick = onLongPress,
    ) {
        spots.spots.forEach { spot ->
            MarkerComposable(
                spot.id,
                spot.details.label,
                state = remember(spot.location) { MarkerState(position = spot.location) },
                title = spot.details.label,
                onClick = {
                    spots.tapSpot(spot)
                    true // the sheet replaces Google's info window
                },
            ) { ParkingMarker() }
        }
        // a saved place already has its P marker
        if (selected != null && spots.selectedSpot == null) {
            Marker(
                state = remember(selected.location) { MarkerState(position = selected.location) },
                title = selected.name,
            )
        }
    }
}

/** The P marker, drawn like a parking sign. */
@Composable
private fun ParkingMarker() {
    Box(
        Modifier
            .size(P_MARKER_SIZE)
            .background(PARKING_BLUE, RoundedCornerShape(P_MARKER_CORNER))
            .border(P_MARKER_BORDER, Color.White, RoundedCornerShape(P_MARKER_CORNER)),
        contentAlignment = Alignment.Center,
    ) {
        Text("P", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
    }
}
