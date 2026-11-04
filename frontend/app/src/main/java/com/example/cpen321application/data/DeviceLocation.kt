package com.example.cpen321application.data

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import com.google.android.gms.maps.model.LatLng
import kotlin.coroutines.resume
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

private const val FRESH_FIX_TIMEOUT_MS = 5_000L // then fall back to the last-known location
private const val UPDATE_INTERVAL_MS = 2_000L
private const val UPDATE_DISTANCE_M = 5f // smaller moves than this don't matter for reaching a stop

/** The permissions the Map tab asks for. Either one is enough for the location dot. */
val LOCATION_PERMISSIONS = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

/** Whether the user has allowed precise or approximate location. */
fun hasLocationPermission(context: Context): Boolean = LOCATION_PERMISSIONS.any {
    ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
}

/**
 * The device's location, or `null` if location is off, not allowed, or unknown.
 *
 * Uses Android's own LocationManager, so it needs no Play services location library:
 * a fresh fix where Android 11+ allows one within a few seconds, otherwise the newest
 * last-known location.
 */
@SuppressLint("MissingPermission") // checked by hasLocationPermission first
suspend fun currentLocation(context: Context): LatLng? {
    val manager = context.getSystemService(LocationManager::class.java)
    if (manager == null || !hasLocationPermission(context)) return null
    val providers = manager.getProviders(true)
    val best = PREFERRED_PROVIDERS.firstOrNull { it in providers }
    val fresh = if (best != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        withTimeoutOrNull(FRESH_FIX_TIMEOUT_MS) { freshLocation(context, manager, best) }
    } else {
        null
    }
    val location = fresh ?: providers.mapNotNull { manager.getLastKnownLocation(it) }.maxByOrNull { it.time }
    return location?.let { LatLng(it.latitude, it.longitude) }
}

/**
 * The device's location each time it moves, from every enabled provider, for as long as the
 * flow is collected (Navigation, while its screen is open). Empty if location isn't allowed.
 */
@SuppressLint("MissingPermission") // checked by hasLocationPermission first
fun locationUpdates(context: Context): Flow<LatLng> {
    val manager = context.getSystemService(LocationManager::class.java)
    if (manager == null || !hasLocationPermission(context)) return emptyFlow()
    return callbackFlow {
        val listener = LocationListener { trySend(LatLng(it.latitude, it.longitude)) }
        val precise = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        // GPS needs precise location, so approximate location only gets the network provider
        val providers = if (precise) PREFERRED_PROVIDERS else listOf(LocationManager.NETWORK_PROVIDER)
        providers.filter { manager.isProviderEnabled(it) }.forEach {
            manager.requestLocationUpdates(it, UPDATE_INTERVAL_MS, UPDATE_DISTANCE_M, listener, Looper.getMainLooper())
        }
        awaitClose { manager.removeUpdates(listener) }
    }
}

// GPS is the most precise; the network provider still works indoors and on approximate location
private val PREFERRED_PROVIDERS = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)

@SuppressLint("MissingPermission")
@RequiresApi(Build.VERSION_CODES.R)
private suspend fun freshLocation(context: Context, manager: LocationManager, provider: String): Location? =
    suspendCancellableCoroutine { continuation ->
        manager.getCurrentLocation(provider, null, ContextCompat.getMainExecutor(context)) { continuation.resume(it) }
    }
