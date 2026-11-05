package com.example.cpen321application.ui.navigation

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.LOCATION_PERMISSIONS
import com.example.cpen321application.data.PlanLeg
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.data.Trip
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.data.hasLocationPermission
import com.example.cpen321application.data.locationUpdates
import com.example.cpen321application.ui.main.TripHistoryViewModel
import com.example.cpen321application.ui.main.rememberTripSnackbar
import com.example.cpen321application.ui.planning.DRIVE_BLUE
import com.example.cpen321application.ui.planning.VANCOUVER
import com.example.cpen321application.ui.planning.legPoints
import com.example.cpen321application.ui.planning.lineColour
import com.example.cpen321application.ui.planning.routePoints
import com.example.cpen321application.ui.planning.showAll
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.CameraMoveStartedReason
import com.google.maps.android.compose.CameraPositionState
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import java.time.Instant

private const val FOLLOW_ZOOM = 17f
private const val FOLLOW_TILT = 45f // looking ahead down the road, like Google Maps
private const val ROUTE_PADDING_PX = 120
private const val CURRENT_WIDTH = 16f
private const val OTHER_WIDTH = 10f
private const val UPCOMING_ALPHA = 0.5f // legs still to come are drawn faded
private val DONE_GREY = Color(0xFF9AA0A6)
private val CARD_SPACE = 180.dp // the leg card's height, so the map keeps the user clear of it
private val BAR_SPACE = 120.dp // the bottom bar's height
private val ARROW_SIZE = 40.dp

/**
 * Navigation (#74), shown whenever the user has an active trip, so reopening the app mid-trip
 * comes back here. Every leg is navigated in the app, nothing hands off to another app.
 *
 * The map follows the user heading-up, with the current leg highlighted and finished legs grey.
 * Dragging the map stops following until **Re-centre**. On a drive or walk leg the top card shows
 * the next turn and how far away it is. On a transit leg it says what to board, then where to get
 * off once the user is riding. **Next leg** is there in case GPS is wrong. Reaching a leg's end
 * moves to the next leg, and reaching the destination completes the trip. The bottom bar shows
 * the arrival, the distance left and **End**, which asks first when the user is far from the
 * destination and cancels the trip if they confirm. After a completed trip, a summary shows
 * until **Done**.
 *
 * Without location permission everything works except the turns and the automatic steps. The
 * screen stays on.
 *
 * @param onUnauthorized Called when the session is no longer valid.
 */
@Composable
fun NavigationScreen(trips: TripHistoryViewModel, onUnauthorized: () -> Unit) {
    val snackbar = rememberTripSnackbar(trips)
    KeepScreenOn()
    Box(Modifier.fillMaxSize()) {
        val active = trips.activeTrip
        val finished = trips.finishedTrip
        when {
            active != null -> ActiveTrip(trips, active, onUnauthorized)
            finished != null -> FinishedTrip(finished, onDone = trips::finishedShown)
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = BAR_SPACE))
    }
}

// the current leg's line, its length and where its turns are, worked out once per leg
private class LegLine(leg: PlanLeg) {
    val points = legPoints(leg)
    val length = lineLength(points)
    val turns = turnPositions(leg.steps, points)
}

// the map, the current leg on top and the arrival with End below, following the user's location
@Composable
private fun ActiveTrip(trips: TripHistoryViewModel, trip: Trip, onUnauthorized: () -> Unit) {
    val route = trip.route
    var legIndex by rememberSaveable(trip.id) {
        mutableIntStateOf(route?.let { currentLegAt(it, trip.actualStart, Instant.now()) } ?: 0)
    }
    var here by remember { mutableStateOf<LatLng?>(null) }
    var confirmingEarly by remember { mutableStateOf(false) }
    var arrived by remember { mutableStateOf(false) } // so arriving ends the trip once, and a failed end is left to End
    val end = { completed: Boolean -> trips.end(trip, completed, onUnauthorized) }
    val leg = route?.legs?.get(legIndex)
    val line = remember(leg) { leg?.let(::LegLine) }
    val position = line?.let { l -> here?.let { linePosition(l.points, it) } }

    if (route != null && line != null) {
        FollowLocation { fix ->
            here = fix
            legIndex = legAfterFix(route, legIndex, fix)
            if (!arrived && hasArrived(route, fix)) {
                arrived = true
                end(true)
            }
        }
        NavigationMap(route, legIndex, here, position?.bearing)
        LegCard(route, legIndex, line, position?.alongMetres, onNext = { legIndex++ }, Modifier.statusBarsPadding().padding(12.dp))
    }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Bottom) {
        BottomBar(
            arrival = route?.let { etaText(it, trip.actualStart, trip.arriveBy) } ?: "Trip in progress",
            remaining = if (route != null && line != null && position != null) {
                remainingText(route, legIndex, line.length - position.alongMetres)
            } else {
                null // the distance left needs a fix on the route
            },
            enabled = !trips.isChanging,
            onEnd = { if (route != null && isFarFromDestination(route, here)) confirmingEarly = true else end(true) },
        )
    }
    if (confirmingEarly) {
        EndEarlyDialog(
            onConfirm = {
                confirmingEarly = false
                end(false)
            },
            onDismiss = { confirmingEarly = false },
        )
    }
}

// asks for location once if it isn't allowed, then passes each fix to onFix while the screen is open
@Composable
private fun FollowLocation(onFix: (LatLng) -> Unit) {
    val context = LocalContext.current.applicationContext
    var granted by remember { mutableStateOf(hasLocationPermission(context)) }
    val launcher = rememberLauncherForActivityResult(RequestMultiplePermissions()) { result ->
        granted = result.values.any { it }
    }
    val latestOnFix by rememberUpdatedState(onFix)
    LaunchedEffect(Unit) { if (!granted) launcher.launch(LOCATION_PERMISSIONS) }
    LaunchedEffect(granted) {
        if (granted) locationUpdates(context).collect { latestOnFix(it) }
    }
}

// finished legs grey, the current one bold in its colour, later ones faded, and the camera on the user
@Composable
private fun NavigationMap(route: RouteOption, legIndex: Int, here: LatLng?, bearing: Float?) {
    val context = LocalContext.current.applicationContext
    val camera = rememberCameraPositionState { position = CameraPosition.fromLatLngZoom(VANCOUVER, FOLLOW_ZOOM) }
    var loaded by remember { mutableStateOf(false) }
    var following by rememberSaveable { mutableStateOf(true) }
    LaunchedEffect(camera.isMoving) {
        // a drag or pinch looks around, so the camera stops following until Re-centre
        if (camera.isMoving && camera.cameraMoveStartedReason == CameraMoveStartedReason.GESTURE) following = false
    }
    FollowCamera(camera, route, here, bearing, active = loaded && following)
    Box(Modifier.fillMaxSize()) {
        GoogleMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = camera,
            properties = MapProperties(isMyLocationEnabled = hasLocationPermission(context)),
            contentPadding = PaddingValues(top = CARD_SPACE, bottom = BAR_SPACE),
            onMapLoaded = { loaded = true },
        ) {
            route.legs.forEachIndexed { i, leg ->
                key(i) { NavigationLegLine(leg, done = i < legIndex, current = i == legIndex) }
            }
            val destination = route.legs.last().to
            Marker(state = remember(destination) { MarkerState(destination.location) }, title = destination.label)
        }
        if (!following) {
            ExtendedFloatingActionButton(
                onClick = { following = true },
                icon = { Icon(Icons.Filled.LocationOn, contentDescription = null) },
                text = { Text("Re-centre") },
                modifier = Modifier.align(Alignment.BottomStart).navigationBarsPadding().padding(start = 16.dp, bottom = BAR_SPACE + 16.dp),
            )
        }
    }
}

// shows the whole route until the first fix, then keeps the user in the middle, facing the way the route goes
@Composable
private fun FollowCamera(camera: CameraPositionState, route: RouteOption, here: LatLng?, bearing: Float?, active: Boolean) {
    LaunchedEffect(active, here, bearing) {
        when {
            !active -> Unit
            here == null -> camera.showAll(routePoints(route), ROUTE_PADDING_PX)
            else -> {
                val facing = bearing ?: camera.position.bearing // off the line's end, keep the last direction
                camera.animate(CameraUpdateFactory.newCameraPosition(CameraPosition(here, FOLLOW_ZOOM, FOLLOW_TILT, facing)))
            }
        }
    }
}

@Composable
private fun NavigationLegLine(leg: PlanLeg, done: Boolean, current: Boolean) {
    val points = remember(leg.polyline) { legPoints(leg) }
    val colour = when {
        done -> DONE_GREY
        leg.mode == TripMode.TRANSIT -> lineColour(leg.transitLines.firstOrNull()?.colour)
        leg.mode == TripMode.WALK -> DONE_GREY.copy(alpha = UPCOMING_ALPHA)
        else -> DRIVE_BLUE
    }
    Polyline(
        points = points,
        color = if (current || done) colour else colour.copy(alpha = UPCOMING_ALPHA),
        width = if (current) CURRENT_WIDTH else OTHER_WIDTH,
        zIndex = if (current) 1f else 0f,
    )
}

// the next turn on a drive or walk leg, else what to do on this leg, with Next leg before the last one
@Composable
private fun LegCard(route: RouteOption, legIndex: Int, line: LegLine, along: Double?, onNext: () -> Unit, modifier: Modifier) {
    val leg = route.legs[legIndex]
    val turn = along?.takeIf { leg.mode != TripMode.TRANSIT }?.let { upcomingTurn(leg.steps, line.turns, it) }
    Card(modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                "Leg ${legIndex + 1} of ${route.legs.size}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (turn != null) {
                TurnRow(turn)
            } else {
                Text(cardTitle(route, legIndex, along), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            if (legIndex < route.legs.lastIndex) {
                OutlinedButton(onClick = onNext) { Text("Next leg") }
            }
        }
    }
}

// an arrow pointing the way to turn, the distance to the turn, and Google's instruction for it
@Composable
private fun TurnRow(turn: UpcomingTurn) {
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
        Surface(shape = CircleShape, color = DRIVE_BLUE) {
            Icon(
                Icons.Filled.KeyboardArrowUp,
                contentDescription = null, // the instruction beside it says the same
                tint = Color.White,
                modifier = Modifier.padding(8.dp).size(ARROW_SIZE).rotate(maneuverAngle(turn.step.maneuver)),
            )
        }
        Column {
            Text(turnDistanceText(turn.metres), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(turn.step.instruction, style = MaterialTheme.typography.titleMedium)
        }
    }
}

// "Arrive 8:56 · 4 min early", the distance left when known, and End
@Composable
private fun BottomBar(arrival: String, remaining: String?, enabled: Boolean, onEnd: () -> Unit) {
    Surface(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        tonalElevation = 3.dp,
        shadowElevation = 8.dp,
    ) {
        Row(
            Modifier.navigationBarsPadding().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(arrival, style = MaterialTheme.typography.titleMedium)
                remaining?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Button(onClick = onEnd, enabled = enabled) { Text("End") }
        }
    }
}

@Composable
private fun EndEarlyDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("End trip early?") },
        text = { Text("You're not at your destination yet. The trip will be cancelled, so it won't count in your totals.") },
        confirmButton = { TextButton(onClick = onConfirm) { Text("End trip") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Keep going") } },
    )
}

// the time and cost of the trip just completed, until Done
@Composable
private fun FinishedTrip(trip: Trip, onDone: () -> Unit) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("You've arrived", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("${trip.origin.label} → ${trip.destination.label}")
                Text(finishedText(trip), style = MaterialTheme.typography.titleMedium)
                Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text("Done") }
            }
        }
    }
}

// keeps the screen on while Navigation is open
@Composable
private fun KeepScreenOn() {
    val view = LocalView.current
    DisposableEffect(view) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }
}
