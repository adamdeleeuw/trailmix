package com.example.cpen321application.ui.planning

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas as AndroidCanvas
import android.graphics.Paint
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.PlanLeg
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.ui.main.TripHistoryViewModel
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.BitmapDescriptor
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.Dot
import com.google.android.gms.maps.model.Gap
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import java.time.Instant
import kotlinx.coroutines.launch

private const val WALK_GAP_PX = 12f
private const val ROUTE_PADDING_PX = 120
private const val ROW_ZOOM = 16f // close enough to see the stop or the parkade
private val TIMELINE_MAX_HEIGHT = 300.dp
private val DOT_SIZE = 12.dp

/**
 * Trip Preview (#73) for the route selected in Planning, with **Start** (#74), which saves it
 * as the active trip and opens Navigation, and **Save for later**, which saves it to History.
 * Back returns to Planning with the same routes.
 *
 * @param onUnauthorized Called when the session has expired.
 */
@Composable
fun TripPreview(planner: PlanningViewModel, trips: TripHistoryViewModel, onUnauthorized: () -> Unit, modifier: Modifier = Modifier) {
    val route = planner.selectedRoute ?: return
    val arriveBy = planner.arriveBy
    RoutePreview(route, arriveBy, labelText(route.label), onBack = planner::closePreview, modifier) {
        Button(
            onClick = { trips.startRoute(route, arriveBy, onUnauthorized) },
            enabled = !trips.isChanging,
            modifier = Modifier.weight(1f),
        ) { Text("Start") }
        OutlinedButton(
            onClick = { trips.save(route, arriveBy, onUnauthorized) },
            enabled = !trips.isChanging,
            modifier = Modifier.weight(1f),
        ) { Text("Save for later") }
    }
}

/**
 * One route in detail, for Planning's Trip Preview and a trip opened from History. Each leg
 * on the map in its own colour (drive blue, transit in its line's colour, walking dotted grey,
 * bicycle green)
 * with markers at the start, the parking spot, each stop and the destination. Underneath, a
 * summary and a timeline of the trip, then [buttons]. Tapping a timeline row pans the map there.
 *
 * @param label The route's label, like "Cheapest", or `null` for a saved trip, which doesn't keep it.
 * @param onBack Closes the preview.
 */
@Composable
fun RoutePreview(
    route: RouteOption,
    arriveBy: Instant?,
    label: String?,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    buttons: @Composable RowScope.() -> Unit,
) {
    val camera = rememberCameraPositionState { position = CameraPosition.fromLatLngZoom(VANCOUVER, 12f) }
    val scope = rememberCoroutineScope()
    var bottomPx by remember { mutableIntStateOf(0) }

    Box(modifier.fillMaxSize()) {
        PreviewMap(route, camera, bottom = with(LocalDensity.current) { bottomPx.toDp() })
        SmallFloatingActionButton(
            onClick = onBack,
            modifier = Modifier.align(Alignment.TopStart).statusBarsPadding().padding(12.dp),
        ) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
        }
        Column(Modifier.align(Alignment.BottomCenter).onSizeChanged { bottomPx = it.height }) {
            PreviewPanel(
                route,
                arriveBy,
                label,
                onRow = { row -> scope.launch { camera.animate(CameraUpdateFactory.newLatLngZoom(row.endAt ?: row.at, ROW_ZOOM)) } },
                buttons,
            )
        }
    }
}

@Composable
private fun PreviewMap(route: RouteOption, camera: com.google.maps.android.compose.CameraPositionState, bottom: androidx.compose.ui.unit.Dp) {
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(route, loaded) {
        if (loaded) camera.showAll(routePoints(route), ROUTE_PADDING_PX)
    }
    GoogleMap(
        modifier = Modifier.fillMaxSize(),
        cameraPositionState = camera,
        contentPadding = PaddingValues(bottom = bottom),
        onMapLoaded = { loaded = true },
    ) {
        route.legs.forEachIndexed { i, leg ->
            key(i) { LegLine(leg) }
        }
        PreviewMarkers(route)
        BicycleLegMarkers(route)
    }
}

// one leg's line, using its routed geometry and mode-specific style
@Composable
private fun LegLine(leg: PlanLeg) {
    val points = remember(leg.polyline) { legPoints(leg) }
    if (points.size < 2) return
    val style = mapLegStyle(leg.mode, leg.transitLines.firstOrNull()?.colour)
    when (leg.mode) {
        TripMode.DRIVE, TripMode.TRANSIT, TripMode.BICYCLE ->
            Polyline(points = points, color = style.colour, width = style.width, zIndex = style.zIndex)
        TripMode.WALK -> Polyline(
            points = points,
            color = style.colour,
            width = style.width,
            pattern = if (style.dotted) listOf(Dot(), Gap(WALK_GAP_PX)) else null,
            zIndex = style.zIndex,
        )
    }
}

@Composable
internal fun BicycleLegMarkers(route: RouteOption) {
    if (route.legs.none { it.mode == TripMode.BICYCLE }) return
    val icon = rememberBicycleMarkerIcon()
    route.legs.forEachIndexed { index, leg ->
        if (leg.mode == TripMode.BICYCLE) {
            val location = bicycleMarkerLocation(route, index) ?: return@forEachIndexed
            key(index) {
                Marker(
                    state = remember(index, location) { MarkerState(location) },
                    title = "Bicycle leg: ${leg.from.label} to ${leg.to.label}",
                    icon = icon,
                    zIndex = 2f,
                )
            }
        }
    }
}

@Composable
private fun rememberBicycleMarkerIcon(): BitmapDescriptor {
    val context = LocalContext.current
    return remember(context) { BitmapDescriptorFactory.fromBitmap(bicycleMarkerBitmap(context)) }
}

internal fun bicycleMarkerBitmap(context: Context): Bitmap {
    val size = 64
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = AndroidCanvas(bitmap)
    val background = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = BICYCLE_GREEN.toArgb() }
    canvas.drawCircle(size / 2f, size / 2f, 31f, background)
    val drawable = checkNotNull(context.getDrawable(com.example.cpen321application.R.drawable.ic_bicycle)) {
        "Bicycle marker drawable is missing"
    }
    drawable.mutate()
    drawable.setTint(android.graphics.Color.WHITE)
    drawable.setBounds(15, 15, 49, 49)
    drawable.draw(canvas)
    return bitmap
}

// start, the parking spot (P), each boarding and getting-off stop, and the destination
@Composable
private fun PreviewMarkers(route: RouteOption) {
    val first = route.legs.first().from
    val last = route.legs.last().to
    Marker(state = remember(first) { MarkerState(first.location) }, title = first.label)
    route.transferPoints.forEach { spot ->
        key(spot) {
            Marker(
                state = remember(spot) { MarkerState(spot.location) },
                title = "P · ${spot.label}",
                icon = BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_AZURE),
            )
        }
    }
    route.legs.filter { it.mode == TripMode.TRANSIT }.flatMap { listOf(it.from, it.to) }.distinct().forEach { stop ->
        key(stop) {
            Marker(
                state = remember(stop) { MarkerState(stop.location) },
                title = stop.label,
                icon = BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_VIOLET),
                alpha = 0.8f,
            )
        }
    }
    Marker(
        state = remember(last) { MarkerState(last.location) },
        title = last.label,
        icon = BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_RED),
    )
}

// the summary, the timeline, and the buttons
@Composable
private fun PreviewPanel(
    route: RouteOption,
    arriveBy: Instant?,
    label: String?,
    onRow: (TimelineRow) -> Unit,
    buttons: @Composable RowScope.() -> Unit,
) {
    val rows = remember(route, arriveBy) { timelineRows(route, arriveBy) }
    Surface(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        tonalElevation = 3.dp,
        shadowElevation = 8.dp,
    ) {
        Column(Modifier.navigationBarsPadding().padding(top = 16.dp)) {
            Summary(route, arriveBy, label)
            HorizontalDivider(Modifier.padding(top = 12.dp))
            LazyColumn(Modifier.heightIn(max = TIMELINE_MAX_HEIGHT)) {
                itemsIndexed(rows) { _, row -> TimelineItem(row) { onRow(row) } }
            }
            HorizontalDivider()
            Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), content = buttons)
        }
    }
}

// "40 min · $3.58", the arrival against the deadline, the cost split and any savings
@Composable
private fun Summary(route: RouteOption, arriveBy: Instant?, label: String?) {
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text("${minutes(route.totalDurationSeconds)} min", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(
                "  ·  ${costText(route.totalCostCents, route.costEstimated)}",
                style = MaterialTheme.typography.titleMedium,
            )
            label?.let {
                Text("  $it", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        val late = route.lateByMinutes > 0 && arriveBy != null
        Text(
            arrivalSummaryText(route, arriveBy),
            style = MaterialTheme.typography.bodyMedium,
            color = if (late) MaterialTheme.colorScheme.error else Color.Unspecified,
        )
        costSplitText(route)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        savingsText(route)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Color(0xFF188038), fontWeight = FontWeight.Medium) }
    }
}

// a timeline row: its time on the left, a marker, then what happens
@Composable
internal fun TimelineItem(row: TimelineRow, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            row.time.orEmpty(),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(44.dp),
        )
        RowMarker(row)
        Column(Modifier.weight(1f)) {
            if (row.kind == RowKind.BOARD) {
                LineBadge(row.title, lineColour(row.colour))
            } else {
                Text(row.title, style = MaterialTheme.typography.bodyMedium, fontWeight = if (row.kind in BOLD_ROWS) FontWeight.Bold else null)
            }
            row.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

private val BOLD_ROWS = setOf(RowKind.LEAVE, RowKind.ARRIVE, RowKind.PARK)

// a small marker per kind of row: a dot in the leg's colour, or P for parking
@Composable
private fun RowMarker(row: TimelineRow) {
    Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
        when (row.kind) {
            RowKind.BICYCLE, RowKind.BICYCLE_TRANSFER -> Icon(
                painter = painterResource(com.example.cpen321application.R.drawable.ic_bicycle),
                contentDescription = if (row.kind == RowKind.BICYCLE) "Bicycle" else "Bicycle transfer",
                tint = BICYCLE_GREEN,
                modifier = Modifier.size(20.dp),
            )
            RowKind.PARK -> Box(
                Modifier.size(18.dp).background(DRIVE_BLUE, RoundedCornerShape(3.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text("P", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
            }
            else -> Box(Modifier.size(DOT_SIZE).background(markerColour(row), CircleShape))
        }
    }
}

internal fun markerColour(row: TimelineRow): Color = when (row.kind) {
    RowKind.DRIVE -> DRIVE_BLUE
    RowKind.BICYCLE, RowKind.BICYCLE_TRANSFER -> BICYCLE_GREEN
    RowKind.BOARD, RowKind.ALIGHT -> lineColour(row.colour)
    RowKind.WALK -> WALK_GREY
    RowKind.ARRIVE -> Color(0xFFEA4335)
    else -> Color(0xFF5F6368)
}
