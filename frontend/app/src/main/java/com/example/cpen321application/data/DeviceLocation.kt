package com.example.cpen321application.data

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import com.google.android.gms.maps.model.LatLng
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

private const val FRESH_FIX_TIMEOUT_MS = 5_000L // then fall back to the last-known location

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

// GPS is the most precise; the network provider still works indoors and on approximate location
private val PREFERRED_PROVIDERS = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)

@SuppressLint("MissingPermission")
@RequiresApi(Build.VERSION_CODES.R)
private suspend fun freshLocation(context: Context, manager: LocationManager, provider: String): Location? =
    suspendCancellableCoroutine { continuation ->
        manager.getCurrentLocation(provider, null, ContextCompat.getMainExecutor(context)) { continuation.resume(it) }
    }
