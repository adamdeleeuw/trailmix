package com.example.cpen321application.ui.map

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberBottomSheetScaffoldState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
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
import kotlinx.coroutines.launch

private const val DOWNTOWN_LAT = 49.2827
private const val DOWNTOWN_LNG = -123.1207
private const val CITY_ZOOM = 12f
private const val STREET_ZOOM = 16f
private val SHEET_PEEK = 200.dp

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
    val sheetState = rememberBottomSheetScaffoldState()
    val snackbar = remember { SnackbarHostState() }
    val selected = spots.selected
    val sheetHeight = if (selected != null) SHEET_PEEK else 0.dp

    CameraEffects(location, camera, spots)
    LaunchedEffect(selected != null) { sheetState.bottomSheetState.partialExpand() } // peek, or tuck away
    ShowMessage(snackbar, spots.message, spots::messageShown)
    ShowMessage(snackbar, models.demoTrips.message, models.demoTrips::messageShown)

    BottomSheetScaffold(
        scaffoldState = sheetState,
        sheetPeekHeight = sheetHeight,
        sheetSwipeEnabled = selected != null,
        sheetContent = { SheetContent(spots, location, onDirections) },
        snackbarHost = { SnackbarHost(snackbar) },
        modifier = modifier,
    ) {
        Box(Modifier.fillMaxSize()) {
            ParkingMap(camera, location.granted, spots, bottomPadding = sheetHeight) {
                search.clear() // a long-press starts over from a pin, like Google Maps
                spots.dropPin(it)
            }
            MapSearchBar(
                search,
                onPick = { suggestion -> search.pick(suggestion, spots::showPlace) },
                onClear = {
                    search.clear()
                    spots.closeSheet()
                },
                modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(16.dp).fillMaxWidth(),
            )
            if (selected == null) {
                MapButtons(
                    location,
                    camera,
                    models.demoTrips,
                    onTripsSeeded,
                    onUnauthorized,
                    Modifier.align(Alignment.BottomCenter),
                )
            }
        }
    }
}

// the place sheet, or nothing while no place is selected
@Composable
private fun SheetContent(spots: ParkingSpotsViewModel, location: LocationState, onDirections: () -> Unit) {
    val selected = spots.selected
    if (selected == null) {
        Spacer(Modifier.height(1.dp)) // the sheet needs some content even while it's tucked away
        return
    }
    val actions = PlaceSheetActions(onDirections, spots::openSaveDialog, spots::openEditDialog, spots::askToRemove)
    PlaceSheet(selected, spots.selectedSpot, location.distanceTo(selected.location), actions)
}

// pans to the user once, the first time location is allowed, and to each place picked from search
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
        spots.focus?.let { camera.animate(CameraUpdateFactory.newLatLngZoom(it, STREET_ZOOM)) }
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

// recenter at the bottom right, and Load demo trips at the bottom centre, clear of the Google logo
@Composable
private fun MapButtons(
    location: LocationState,
    camera: CameraPositionState,
    demoTrips: DemoTripsViewModel,
    onTripsSeeded: () -> Unit,
    onUnauthorized: () -> Unit,
    modifier: Modifier,
) {
    val scope = rememberCoroutineScope()
    Column(
        modifier.fillMaxWidth().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.End,
    ) {
        SmallFloatingActionButton(onClick = {
            scope.launch {
                location.recenter()?.let { camera.animate(CameraUpdateFactory.newLatLngZoom(it, STREET_ZOOM)) }
            }
        }) {
            Icon(Icons.Filled.LocationOn, contentDescription = "Recenter on my location")
        }
        ExtendedFloatingActionButton(
            onClick = { demoTrips.seed(onTripsSeeded, onUnauthorized) },
            modifier = Modifier.align(Alignment.CenterHorizontally),
            icon = {
                if (demoTrips.isSeeding) {
                    CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                } else {
                    Icon(Icons.Filled.DateRange, contentDescription = null) // the History tab's icon
                }
            },
            text = { Text("Load demo trips") },
        )
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
