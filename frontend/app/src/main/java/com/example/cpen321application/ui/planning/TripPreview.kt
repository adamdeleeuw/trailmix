package com.example.cpen321application.ui.planning

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
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
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.PlanLeg
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.ui.route.decodePolyline
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.Dot
import com.google.android.gms.maps.model.Gap
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import kotlinx.coroutines.launch

private val WALK_GREY = Color(0xFF80868B)
private const val DRIVE_WIDTH = 16f
private const val TRANSIT_WIDTH = 12f
private const val WALK_WIDTH = 10f
private const val WALK_GAP_PX = 12f
private const val ROUTE_PADDING_PX = 120
private const val ROW_ZOOM = 16f // close enough to see the stop or the parkade
private const val START_MESSAGE = "Navigation is coming soon."
private const val SAVE_MESSAGE = "Save for later is coming soon."
private val TIMELINE_MAX_HEIGHT = 300.dp
private val DOT_SIZE = 12.dp

/**
 * Trip Preview (#73): one route in detail. Each leg on the map in its own colour (drive
 * blue, transit in its line's colour, walking dotted grey) with markers at the start,
 * the parking spot, each stop and the destination; underneath, a summary and a timeline
 * of the trip. Tapping a timeline row pans the map there.
 *
 * Start and Save for later belong to #74; until then they say they're coming soon.
 * Back returns to Planning with the same routes.
 */
@Composable
fun TripPreview(planner: PlanningViewModel, modifier: Modifier = Modifier) {
    val route = planner.selectedRoute ?: return
    val camera = rememberCameraPositionState { position = CameraPosition.fromLatLngZoom(VANCOUVER, 12f) }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var message by remember { mutableStateOf<String?>(null) }
    var bottomPx by remember { mutableIntStateOf(0) }
    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            message = null
        }
    }

    Box(modifier.fillMaxSize()) {
        PreviewMap(route, camera, bottom = with(LocalDensity.current) { bottomPx.toDp() })
        SmallFloatingActionButton(
            onClick = planner::closePreview,
            modifier = Modifier.align(Alignment.TopStart).statusBarsPadding().padding(12.dp),
        ) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back to routes")
        }
        Column(Modifier.align(Alignment.BottomCenter).onSizeChanged { bottomPx = it.height }) {
            SnackbarHost(snackbar)
            PreviewPanel(
                route,
                planner.arriveBy,
                onRow = { row -> scope.launch { camera.animate(CameraUpdateFactory.newLatLngZoom(row.at, ROW_ZOOM)) } },
                onStart = { message = START_MESSAGE },
                onSave = { message = SAVE_MESSAGE },
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
    }
}

// one leg's line: drive solid blue, transit solid in its line's colour, walking dotted grey
@Composable
private fun LegLine(leg: PlanLeg) {
    val points = remember(leg.polyline) { decodePolyline(leg.polyline) }
    when (leg.mode) {
        TripMode.DRIVE -> Polyline(points = points, color = DRIVE_BLUE, width = DRIVE_WIDTH)
        TripMode.TRANSIT -> Polyline(points = points, color = lineColour(leg.transitLines.firstOrNull()?.colour), width = TRANSIT_WIDTH, zIndex = 1f)
        TripMode.WALK -> Polyline(points = points, color = WALK_GREY, width = WALK_WIDTH, pattern = listOf(Dot(), Gap(WALK_GAP_PX)))
    }
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

// the summary, the timeline, and Start / Save for later
@Composable
private fun PreviewPanel(
    route: RouteOption,
    arriveBy: java.time.Instant?,
    onRow: (TimelineRow) -> Unit,
    onStart: () -> Unit,
    onSave: () -> Unit,
) {
    val rows = remember(route, arriveBy) { timelineRows(route, arriveBy) }
    Surface(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        tonalElevation = 3.dp,
        shadowElevation = 8.dp,
    ) {
        Column(Modifier.navigationBarsPadding().padding(top = 16.dp)) {
            Summary(route, arriveBy)
            HorizontalDivider(Modifier.padding(top = 12.dp))
            LazyColumn(Modifier.heightIn(max = TIMELINE_MAX_HEIGHT)) {
                itemsIndexed(rows) { _, row -> TimelineItem(row) { onRow(row) } }
            }
            HorizontalDivider()
            Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = onStart, modifier = Modifier.weight(1f)) { Text("Start") }
                OutlinedButton(onClick = onSave, modifier = Modifier.weight(1f)) { Text("Save for later") }
            }
        }
    }
}

// "40 min · $3.58", the arrival against the deadline, the cost split and any savings
@Composable
private fun Summary(route: RouteOption, arriveBy: java.time.Instant?) {
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text("${minutes(route.totalDurationSeconds)} min", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(
                "  ·  ${costText(route.totalCostCents, route.costEstimated)}",
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                "  ${labelText(route.label)}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
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
private fun TimelineItem(row: TimelineRow, onClick: () -> Unit) {
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

private fun markerColour(row: TimelineRow): Color = when (row.kind) {
    RowKind.DRIVE -> DRIVE_BLUE
    RowKind.BOARD, RowKind.ALIGHT -> lineColour(row.colour)
    RowKind.WALK -> WALK_GREY
    RowKind.ARRIVE -> Color(0xFFEA4335)
    else -> Color(0xFF5F6368)
}
