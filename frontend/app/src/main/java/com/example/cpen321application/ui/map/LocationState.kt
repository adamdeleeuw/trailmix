package com.example.cpen321application.ui.map

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.setValue
import com.google.android.gms.maps.model.LatLng

/**
 * Location permission and the user's position for the Map tab.
 *
 * The tab asks once when it first opens. If that's denied, the recenter button asks
 * once more, and after that explains what the app does without location. Which of
 * those already happened survives switching tabs (see [saver]).
 *
 * @param checkPermission Whether location is allowed right now.
 * @param locate The device's position, or `null` if it's unknown.
 */
class LocationState(
    private val checkPermission: () -> Boolean,
    private val locate: suspend () -> LatLng?,
    askedOnOpen: Boolean = false,
    askedAgain: Boolean = false,
) {
    /** Shows the permission prompt. Set by the screen once it has a launcher. */
    var request: () -> Unit = {}

    var granted by mutableStateOf(checkPermission())
        private set

    /** The last known position, or `null` until there is one. */
    var position by mutableStateOf<LatLng?>(null)
        private set

    /** Whether to explain that location is off, after the second ask was denied too. */
    var showOffDialog by mutableStateOf(false)
        private set

    private var askedOnOpen = askedOnOpen
    private var askedAgain = askedAgain

    /** Asks for location the first time the tab opens without it. */
    fun askOnOpen() {
        granted = checkPermission()
        if (!granted && !askedOnOpen) {
            askedOnOpen = true
            request()
        }
    }

    /** Called with the user's answer to the permission prompt. */
    fun onPermissionResult(allowed: Boolean) {
        granted = allowed
        if (!allowed && askedAgain) showOffDialog = true
    }

    /**
     * What the recenter button does: with location allowed, finds the user; otherwise
     * asks again once, then explains.
     *
     * @return Where to pan to, or `null` if there's nowhere to go yet.
     */
    suspend fun recenter(): LatLng? {
        if (granted) return refresh()
        if (askedAgain) {
            showOffDialog = true
        } else {
            askedAgain = true
            request()
        }
        return null
    }

    /** Fetches the position, keeping the last one if there's no new fix. */
    suspend fun refresh(): LatLng? {
        position = locate() ?: position
        return position
    }

    fun dismissOffDialog() {
        showOffDialog = false
    }

    /** "2.4 km" from the user to [target], or `null` without a position. */
    fun distanceTo(target: LatLng): String? = position?.let { formatDistance(distanceMetres(it, target)) }

    companion object {
        /** Keeps which prompts were shown, so switching tabs doesn't ask again. */
        fun saver(checkPermission: () -> Boolean, locate: suspend () -> LatLng?): Saver<LocationState, List<Boolean>> =
            Saver(
                save = { listOf(it.askedOnOpen, it.askedAgain) },
                restore = { LocationState(checkPermission, locate, askedOnOpen = it[0], askedAgain = it[1]) },
            )
    }
}
