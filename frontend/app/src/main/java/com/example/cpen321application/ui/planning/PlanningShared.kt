package com.example.cpen321application.ui.planning

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.ui.route.decodePolyline
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.maps.android.compose.CameraPositionState

/* Colours and pieces shared by Planning and Trip Preview. */

internal val DRIVE_BLUE = Color(0xFF1A73E8) // the app's drive blue, also the selected route
internal val LINE_FALLBACK = Color(0xFF5C7A99) // grey-blue, for a transit line with no colour
internal val VANCOUVER = LatLng(49.2827, -123.1207)

/** Every point of a route, leg after leg. */
internal fun routePoints(route: RouteOption): List<LatLng> = route.legs.flatMap { decodePolyline(it.polyline) }

/** Moves the map to show all of [points] with [paddingPx] around them. Does nothing when there are none. */
internal suspend fun CameraPositionState.showAll(points: List<LatLng>, paddingPx: Int) {
    if (points.isEmpty()) return
    val bounds = LatLngBounds.builder().apply { points.forEach { include(it) } }.build()
    animate(CameraUpdateFactory.newLatLngBounds(bounds, paddingPx))
}

/** A line's "#0060A9" colour, or grey-blue when it has none or it can't be read. */
internal fun lineColour(hex: String?): Color = try {
    if (hex == null) LINE_FALLBACK else Color(android.graphics.Color.parseColor(hex))
} catch (e: IllegalArgumentException) {
    LINE_FALLBACK
}

/** A transit line's name on its own colour, like Google Maps' line badges. */
@Composable
internal fun LineBadge(name: String, colour: Color) {
    Surface(color = colour, shape = RoundedCornerShape(4.dp)) {
        Text(
            name,
            color = Color.White,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}
