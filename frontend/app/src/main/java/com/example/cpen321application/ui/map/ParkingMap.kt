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
private val P_MARKER_SELECTED_SIZE = 44.dp // the selected spot grows, like Google Maps' selected pin
private val P_MARKER_SELECTED_BORDER = 3.dp
private val P_LABEL_SIZE = 18.sp
private val P_LABEL_SELECTED_SIZE = 24.sp

/** What the map does when the user taps or long-presses it. */
class MapTaps(
    /** A place label, like a business or a station, with its Google place ID, name and location. */
    val onPoi: (placeId: String, name: String, location: LatLng) -> Unit,
    /** Empty map, which closes the sheet. */
    val onEmpty: () -> Unit,
    /** Anywhere, held down, to drop a pin there. */
    val onLongPress: (LatLng) -> Unit,
)

/**
 * The map: every saved spot as a P marker (the selected one larger), a pin for an
 * unsaved selected place, and the location dot when location is allowed.
 *
 * @param padding Space the search bar and the sheet cover, so the selected place is
 *   centred in what's visible and the Google logo and compass aren't hidden.
 */
@Composable
fun ParkingMap(
    camera: CameraPositionState,
    showLocation: Boolean,
    spots: ParkingSpotsViewModel,
    padding: PaddingValues,
    taps: MapTaps,
) {
    val selected = spots.selected
    val selectedSpotId = spots.selectedSpot?.id
    GoogleMap(
        modifier = Modifier.fillMaxSize(),
        cameraPositionState = camera,
        properties = MapProperties(isMyLocationEnabled = showLocation),
        // the screen draws its own recenter and zoom buttons, which can sit above the sheet;
        // the toolbar would offer to leave for the Google Maps app
        uiSettings = MapUiSettings(
            myLocationButtonEnabled = false,
            zoomControlsEnabled = false,
            mapToolbarEnabled = false,
        ),
        contentPadding = padding,
        onMapClick = { taps.onEmpty() },
        onMapLongClick = taps.onLongPress,
        onPOIClick = { taps.onPoi(it.placeId, it.name, it.latLng) },
    ) {
        spots.spots.forEach { spot ->
            val isSelected = spot.id == selectedSpotId
            MarkerComposable(
                spot.id,
                spot.details.label,
                isSelected,
                state = remember(spot.location) { MarkerState(position = spot.location) },
                title = spot.details.label,
                zIndex = if (isSelected) 1f else 0f, // the selected spot draws over its neighbours
                onClick = {
                    spots.tapSpot(spot)
                    true // the sheet replaces Google's info window
                },
            ) { ParkingMarker(isSelected) }
        }
        // a saved place already has its P marker
        if (selected != null && selectedSpotId == null) {
            Marker(
                state = remember(selected.location) { MarkerState(position = selected.location) },
                title = selected.name,
                onClick = { true }, // the sheet is already open for it, so no info window
            )
        }
    }
}

/** The P marker, drawn like a parking sign, and larger while its sheet is open. */
@Composable
private fun ParkingMarker(selected: Boolean) {
    Box(
        Modifier
            .size(if (selected) P_MARKER_SELECTED_SIZE else P_MARKER_SIZE)
            .background(PARKING_BLUE, RoundedCornerShape(P_MARKER_CORNER))
            .border(
                if (selected) P_MARKER_SELECTED_BORDER else P_MARKER_BORDER,
                Color.White,
                RoundedCornerShape(P_MARKER_CORNER),
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "P",
            color = Color.White,
            fontWeight = FontWeight.Bold,
            fontSize = if (selected) P_LABEL_SELECTED_SIZE else P_LABEL_SIZE,
        )
    }
}
