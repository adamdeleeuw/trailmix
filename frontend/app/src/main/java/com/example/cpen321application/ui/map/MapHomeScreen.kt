package com.example.cpen321application.ui.map

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.BottomSheetScaffold
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SheetState
import androidx.compose.material3.SheetValue
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberBottomSheetScaffoldState
import androidx.compose.material3.rememberStandardBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.cpen321application.data.BackendApi
import com.example.cpen321application.data.DataStoreSessionStore
import com.example.cpen321application.data.GooglePlaceSearch
import com.example.cpen321application.data.LOCATION_PERMISSIONS
import com.example.cpen321application.data.currentLocation
import com.example.cpen321application.data.hasLocationPermission
import com.example.cpen321application.ui.route.DemoTripsViewModel
import com.example.cpen321application.ui.route.RouteScreen
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.CameraPositionState
import com.google.maps.android.compose.rememberCameraPositionState
import kotlin.math.max
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch

private const val DOWNTOWN_LAT = 49.2827
private const val DOWNTOWN_LNG = -123.1207
private const val CITY_ZOOM = 12f
private const val STREET_ZOOM = 16f
private val SEARCH_BAR_SPACE = 88.dp // the search bar and its margins, so the compass shows below it

/** The Map tab's view models, made once per tab so they survive switching tabs. */
private class MapModels(
    val search: MapSearchViewModel,
    val spots: ParkingSpotsViewModel,
    val demoTrips: DemoTripsViewModel,
)

/**
 * The Map tab's home, like Google Maps: a search bar, the user's parking spots as P
 * markers, a sheet for the chosen place, and the location dot with a recenter button.
 *
 * Directions opens the chained-route planner until Planning (#73) replaces it. Back
 * closes the sheet first, then clears the search, then leaves it to the nav bar's rules.
 * Also keeps the "Load demo trips" button, so anyone can fill History and Commute Insights.
 *
 * @param onTripsSeeded Called after demo trips are added, so History reloads.
 * @param onUnauthorized Called when the session is no longer valid.
 */
@Composable
fun MapHomeScreen(onTripsSeeded: () -> Unit, onUnauthorized: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current.applicationContext
    val places = remember { GooglePlaceSearch(context) }
    val models = MapModels(
        search = viewModel { MapSearchViewModel(places) },
        spots = viewModel { ParkingSpotsViewModel(BackendApi, places, DataStoreSessionStore(context)) },
        demoTrips = viewModel { DemoTripsViewModel(BackendApi, DataStoreSessionStore(context)) },
    )
    var planning by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) { models.spots.loadSpots(onUnauthorized) }

    if (planning) {
        BackHandler { planning = false }
        RouteScreen(onClose = { planning = false }, modifier)
        return
    }
    val spots = models.spots
    BackHandler(enabled = spots.selected != null || models.search.isActive) {
        if (spots.selected != null) spots.closeSheet() else models.search.clear()
    }
    MapHome(models, onDirections = { planning = true }, onTripsSeeded, onUnauthorized, modifier)
    spots.form?.let { ParkingSpotDialog(spots, it, onUnauthorized) }
    if (spots.isConfirmingRemove) RemoveSpotDialog(spots, onUnauthorized)
}

// the map with the sheet under it and the search bar and buttons over it
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MapHome(
    models: MapModels,
    onDirections: () -> Unit,
    onTripsSeeded: () -> Unit,
    onUnauthorized: () -> Unit,
    modifier: Modifier,
) {
    val search = models.search
    val spots = models.spots
    val location = rememberLocationState()
    val camera = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(LatLng(DOWNTOWN_LAT, DOWNTOWN_LNG), CITY_ZOOM)
    }
    val sheetState = rememberBottomSheetScaffoldState(
        rememberStandardBottomSheetState(initialValue = SheetValue.Hidden, skipHiddenState = false),
    )
    val snackbar = remember { SnackbarHostState() }
    var summaryHeightPx by remember { mutableIntStateOf(0) }
    val isOpen = spots.selected != null
    val peekHeight = if (isOpen) with(LocalDensity.current) { summaryHeightPx.toDp() } else 0.dp

    CameraEffects(location, camera, spots)
    SheetEffects(sheetState.bottomSheetState, isOpen, spots::closeSheet)
    ShowMessage(snackbar, spots.message, spots::messageShown)
    ShowMessage(snackbar, models.demoTrips.message, models.demoTrips::messageShown)

    val gestures = mapGestures(search, spots, LocalFocusManager.current)
    BottomSheetScaffold(
        scaffoldState = sheetState,
        sheetPeekHeight = peekHeight,
        sheetSwipeEnabled = isOpen,
        sheetDragHandle = null, // the sheet draws its own, so the handle counts in the peek height
        sheetContent = { SheetContent(spots, location, onDirections, gestures.closePlace) { summaryHeightPx = it } },
        snackbarHost = { SnackbarHost(snackbar) },
        modifier = modifier,
    ) {
        Box(Modifier.fillMaxSize()) {
            val mapPadding = PaddingValues(top = SEARCH_BAR_SPACE, bottom = peekHeight)
            ParkingMap(camera, location.granted, spots, mapPadding, gestures.taps)
            MapSearchBar(
                search,
                onPick = { suggestion -> search.pick(suggestion, spots::showPlace) },
                onClear = gestures.closePlace,
                modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(16.dp).fillMaxWidth(),
            )
            // the buttons ride above the sheet; Load demo trips steps aside while it's open, as in Google Maps
            MapButtons(
                location,
                camera,
                demoTrips = DemoTripsButton(models.demoTrips, onTripsSeeded, onUnauthorized).takeUnless { isOpen },
                Modifier.align(Alignment.BottomCenter).padding(bottom = peekHeight),
            )
        }
    }
}

/** How the selected place is closed, by the sheet's X or the search's clear button, and what taps on the map do. */
private class MapGestures(val closePlace: () -> Unit, val taps: MapTaps)

// a new place, or none, starts over from an empty search with the keyboard closed, like Google Maps;
// tapping empty map closes the open place, or just the keyboard
private fun mapGestures(search: MapSearchViewModel, spots: ParkingSpotsViewModel, focus: FocusManager): MapGestures {
    val startOver = {
        focus.clearFocus()
        search.clear()
    }
    val closePlace = {
        startOver()
        spots.closeSheet()
    }
    val taps = MapTaps(
        onPoi = { placeId, name, at ->
            startOver()
            spots.showPoi(placeId, name, at)
        },
        onEmpty = { if (spots.selected != null) closePlace() else focus.clearFocus() },
        onLongPress = {
            startOver()
            spots.dropPin(it)
        },
    )
    return MapGestures(closePlace, taps)
}

// the place sheet, or nothing while no place is selected
@Composable
private fun SheetContent(
    spots: ParkingSpotsViewModel,
    location: LocationState,
    onDirections: () -> Unit,
    onClose: () -> Unit,
    onSummaryHeight: (Int) -> Unit,
) {
    val selected = spots.selected
    if (selected == null) {
        Spacer(Modifier.height(1.dp)) // the sheet needs some content even while it's hidden
        return
    }
    val actions = PlaceSheetActions(
        onDirections,
        spots::openSaveDialog,
        spots::openEditDialog,
        spots::askToRemove,
        onClose,
    )
    PlaceSheet(selected, spots.selectedSpot, location.distanceTo(selected.location), actions, onSummaryHeight)
}

// peeks the sheet when a place is selected and hides it when none is; a swipe down past the peek closes the place
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SheetEffects(sheet: SheetState, isOpen: Boolean, onSwipedAway: () -> Unit) {
    LaunchedEffect(isOpen) { if (isOpen) sheet.partialExpand() else sheet.hide() }
    LaunchedEffect(sheet) {
        // skips the starting value, so coming back to the tab doesn't close a place that's still open
        snapshotFlow { sheet.currentValue }.drop(1).collect { if (it == SheetValue.Hidden) onSwipedAway() }
    }
}

// pans to the user once, the first time location is allowed, and to each place opened from search or a tap
@Composable
private fun CameraEffects(location: LocationState, camera: CameraPositionState, spots: ParkingSpotsViewModel) {
    var startedAtUser by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(location.granted) {
        if (!location.granted) return@LaunchedEffect
        val here = location.refresh()
        if (here != null && !startedAtUser) camera.move(CameraUpdateFactory.newLatLngZoom(here, CITY_ZOOM))
        startedAtUser = startedAtUser || here != null
    }
    LaunchedEffect(spots.focus) {
        spots.focus?.let {
            // zooms in to street level from further out, but never zooms out from closer in
            camera.animate(CameraUpdateFactory.newLatLngZoom(it, max(camera.position.zoom, STREET_ZOOM)))
        }
        spots.focusHandled()
    }
}

@Composable
private fun ShowMessage(snackbar: SnackbarHostState, message: String?, onShown: () -> Unit) {
    LaunchedEffect(message) {
        if (message != null) {
            snackbar.showSnackbar(message)
            onShown()
        }
    }
}

/** Load demo trips, kept on the Map so anyone can fill History and Commute Insights. */
private class DemoTripsButton(
    val viewModel: DemoTripsViewModel,
    val onTripsSeeded: () -> Unit,
    val onUnauthorized: () -> Unit,
)

// zoom and recenter at the bottom right, and Load demo trips (when given) at the bottom centre,
// clear of the Google logo
@Composable
private fun MapButtons(
    location: LocationState,
    camera: CameraPositionState,
    demoTrips: DemoTripsButton?,
    modifier: Modifier,
) {
    val scope = rememberCoroutineScope()
    Column(
        modifier.fillMaxWidth().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.End,
    ) {
        ZoomButtons(camera)
        SmallFloatingActionButton(onClick = {
            scope.launch {
                location.recenter()?.let { camera.animate(CameraUpdateFactory.newLatLngZoom(it, STREET_ZOOM)) }
            }
        }) {
            Icon(Icons.Filled.LocationOn, contentDescription = "Recenter on my location")
        }
        demoTrips?.let { LoadDemoTrips(it, Modifier.align(Alignment.CenterHorizontally)) }
    }
}

@Composable
private fun LoadDemoTrips(button: DemoTripsButton, modifier: Modifier) {
    ExtendedFloatingActionButton(
        onClick = { button.viewModel.seed(button.onTripsSeeded, button.onUnauthorized) },
        modifier = modifier,
        icon = {
            if (button.viewModel.isSeeding) {
                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            } else {
                Icon(Icons.Filled.DateRange, contentDescription = null) // the History tab's icon
            }
        },
        text = { Text("Load demo trips") },
    )
}

// + and -, for zooming without a pinch (e.g. with a mouse on the emulator)
@Composable
private fun ZoomButtons(camera: CameraPositionState) {
    val scope = rememberCoroutineScope()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ZoomButton("+", "Zoom in") { scope.launch { camera.animate(CameraUpdateFactory.zoomIn()) } }
        ZoomButton("\u2212", "Zoom out") { scope.launch { camera.animate(CameraUpdateFactory.zoomOut()) } }
    }
}

@Composable
private fun ZoomButton(symbol: String, description: String, onClick: () -> Unit) {
    SmallFloatingActionButton(onClick = onClick, modifier = Modifier.semantics { contentDescription = description }) {
        Text(symbol, style = MaterialTheme.typography.titleLarge)
    }
}

// asks for location the first time the tab opens, and shows the explanation when the recenter button asks for it
@Composable
private fun rememberLocationState(): LocationState {
    val context = LocalContext.current.applicationContext
    val check = { hasLocationPermission(context) }
    val locate: suspend () -> LatLng? = { currentLocation(context) }
    val state = rememberSaveable(saver = LocationState.saver(check, locate)) { LocationState(check, locate) }
    val launcher = rememberLauncherForActivityResult(RequestMultiplePermissions()) { result ->
        state.onPermissionResult(result.values.any { it })
    }
    state.request = { launcher.launch(LOCATION_PERMISSIONS) }

    LaunchedEffect(Unit) { state.askOnOpen() }
    if (state.showOffDialog) LocationOffDialog(onDismiss = state::dismissOffDialog)
    return state
}
