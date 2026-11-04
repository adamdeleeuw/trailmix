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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.BottomSheetScaffold
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SheetValue
import androidx.compose.material3.rememberBottomSheetScaffoldState
import androidx.compose.material3.rememberStandardBottomSheetState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.PlanPlace
import com.example.cpen321application.ui.main.TripHistoryViewModel
import com.example.cpen321application.ui.map.MapSearchBar
import com.example.cpen321application.ui.map.MapSearchViewModel
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState


private val SELECTED_BLUE = DRIVE_BLUE
private val OTHER_GREY = Color(0xFF9AA0A6)
private const val SELECTED_WIDTH = 14f
private const val OTHER_WIDTH = 10f
internal const val LOADING_ALPHA = 0.4f // old routes fade while a new plan loads
private const val ROUTE_PADDING_PX = 120 // space around a route when the map fits to it

/**
 * Planning mode (#73), laid out like Google Maps' directions: the trip at the top (start,
 * each mode and where it changes, destination), the routes in a list at the bottom, and
 * every route on the map (the selected one blue, the others grey). Tapping a route or a
 * grey line opens Trip Preview for it.
 *
 * Tapping the start or the destination opens a search box to change it.
 *
 * @param search The search box's suggestions, separate from the Map tab's own search.
 * @param trips Where Trip Preview's Start and Save for later save the route.
 * @param onClose Back to the place sheet.
 * @param onUnauthorized Called when the session has expired.
 */
@Composable
fun PlanningScreen(
    planner: PlanningViewModel,
    search: MapSearchViewModel,
    trips: TripHistoryViewModel,
    onClose: () -> Unit,
    onUnauthorized: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(planner.sessionExpired) {
        if (planner.sessionExpired) {
            planner.sessionExpiredShown()
            onUnauthorized()
        }
    }
    if (planner.isPreviewing) {
        TripPreview(planner, trips, onUnauthorized, modifier)
        return
    }
    PlanningLayout(planner, search, onClose, modifier)
}

// the map under a draggable sheet of routes, like Google Maps: collapsed it shows the options
// and the first route, dragged up it shows them all. The map keeps its lines clear of the top
// bar and the collapsed sheet, whatever their height.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlanningLayout(planner: PlanningViewModel, search: MapSearchViewModel, onClose: () -> Unit, modifier: Modifier) {
    var topPx by remember { mutableIntStateOf(0) }
    var peekPx by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current
    val peek = with(density) { peekPx.toDp() }
    val sheet = rememberBottomSheetScaffoldState(
        rememberStandardBottomSheetState(initialValue = SheetValue.PartiallyExpanded, skipHiddenState = true),
    )
    BottomSheetScaffold(
        scaffoldState = sheet,
        sheetPeekHeight = peek,
        sheetContent = { RoutesSheet(planner, onClose, onPeekHeight = { peekPx = it }) },
        modifier = modifier,
    ) {
        Box(Modifier.fillMaxSize()) {
            PlanningMap(planner, top = with(density) { topPx.toDp() }, bottom = peek)
            TripBar(
                planner,
                onClose,
                Modifier
                    .align(Alignment.TopCenter)
                    .statusBarsPadding()
                    .padding(12.dp)
                    .onSizeChanged { topPx = it.height },
            )
            planner.editingEnd?.let { end -> EndSearch(planner, search, end) }
        }
    }
}

// the search box over Planning, for changing the start or the destination
@Composable
private fun EndSearch(planner: PlanningViewModel, search: MapSearchViewModel, end: TripEnd) {
    val close = {
        search.clear()
        planner.closeSearch()
    }
    val pickPlace = { place: PlanPlace ->
        search.clear()
        planner.pickPlace(place)
    }
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.3f))) {
        Card(Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(12.dp).fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = close) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Close search") }
                Text(
                    if (end == TripEnd.START) "Choose start point" else "Choose destination",
                    style = MaterialTheme.typography.titleMedium,
                )
            }
            planner.myLocation?.let { here ->
                TextButton(onClick = { pickPlace(here) }, modifier = Modifier.padding(horizontal = 8.dp)) {
                    Text("\u25CF  Your location") // ●
                }
            }
            MapSearchBar(
                search,
                onPick = { suggestion ->
                    search.pick(suggestion) { picked -> pickPlace(PlanPlace(picked.name, picked.location, picked.placeId)) }
                },
                onClear = search::clear,
                modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp).fillMaxWidth(),
            )
        }
    }
}

// every route as a line, the selected one drawn blue on top, plus start and destination markers
@Composable
private fun PlanningMap(planner: PlanningViewModel, top: Dp, bottom: Dp) {
    val camera = rememberCameraPositionState { position = CameraPosition.fromLatLngZoom(VANCOUVER, 12f) }
    var loaded by remember { mutableStateOf(false) }
    val selected = planner.selectedRoute
    val fade = if (planner.status == PlanStatus.LOADING) LOADING_ALPHA else 1f

    // fits the map to the selected route once the map can measure itself
    LaunchedEffect(selected, loaded) {
        if (loaded) camera.showAll(selected?.let(::routePoints).orEmpty(), ROUTE_PADDING_PX)
    }

    GoogleMap(
        modifier = Modifier.fillMaxSize(),
        cameraPositionState = camera,
        contentPadding = PaddingValues(top = top, bottom = bottom),
        onMapLoaded = { loaded = true },
    ) {
        planner.options.forEachIndexed { index, route ->
            key(route) {
                val isSelected = index == planner.selectedIndex
                Polyline(
                    points = remember(route) { routePoints(route) },
                    color = (if (isSelected) SELECTED_BLUE else OTHER_GREY).copy(alpha = fade),
                    width = if (isSelected) SELECTED_WIDTH else OTHER_WIDTH,
                    zIndex = if (isSelected) 1f else 0f,
                    clickable = true,
                    onClick = { planner.select(index) },
                )
            }
        }
        planner.origin?.let { Marker(state = remember(it) { MarkerState(it.location) }, title = it.label) }
        planner.destination?.let {
            Marker(
                state = remember(it) { MarkerState(it.location) },
                title = it.label,
                icon = BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_RED),
            )
        }
    }
}

// back, the selected route's places and modes top to bottom, and swap
@Composable
private fun TripBar(planner: PlanningViewModel, onClose: () -> Unit, modifier: Modifier) {
    val lines = topBarLines(
        origin = planner.origin?.label ?: "Choose start point",
        destination = planner.destination?.label ?: "Choose destination",
        route = planner.selectedRoute,
    )
    Card(modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
            Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                lines.forEach { line ->
                    when (line) {
                        is TripLine.Stop -> StopLine(line, onClick = tapToSearch(planner, line.kind))
                        is TripLine.Connector -> ConnectorLine(line.text)
                    }
                }
            }
            IconButton(onClick = planner::swap, modifier = Modifier.semantics { contentDescription = "Swap start and destination" }) {
                Text("⇅", style = MaterialTheme.typography.titleLarge) // ⇅
            }
        }
    }
}

private val MARKER_SIZE = 16.dp

// the start and destination can be tapped to change them by search; a parking spot can't
private fun tapToSearch(planner: PlanningViewModel, kind: StopKind): (() -> Unit)? = when (kind) {
    StopKind.START -> { { planner.openSearch(TripEnd.START) } }
    StopKind.END -> { { planner.openSearch(TripEnd.DESTINATION) } }
    StopKind.TRANSFER -> null
}

@Composable
private fun StopLine(stop: TripLine.Stop, onClick: (() -> Unit)?) {
    val tappable = if (onClick == null) Modifier else Modifier.clickable(onClick = onClick)
    Row(
        tappable.fillMaxWidth().padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(MARKER_SIZE), contentAlignment = Alignment.Center) {
            when (stop.kind) {
                StopKind.START -> Box(Modifier.size(10.dp).background(SELECTED_BLUE, CircleShape))
                StopKind.TRANSFER -> Box(
                    Modifier.size(MARKER_SIZE).background(SELECTED_BLUE, RoundedCornerShape(3.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("P", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                }
                StopKind.END -> Icon(Icons.Filled.Place, contentDescription = null, tint = Color(0xFFEA4335))
            }
        }
        Text(stop.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// the dotted line between two places, saying how that part is travelled
@Composable
private fun ConnectorLine(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("⋮", modifier = Modifier.width(MARKER_SIZE), color = MaterialTheme.colorScheme.onSurfaceVariant) // ⋮
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
