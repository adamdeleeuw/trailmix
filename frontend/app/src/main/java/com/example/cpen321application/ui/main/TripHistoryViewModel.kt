package com.example.cpen321application.ui.main

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.cpen321application.data.HttpException
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.TRIP_ALREADY_ACTIVE_ERROR
import com.example.cpen321application.data.Trip
import com.example.cpen321application.data.TripApi
import com.example.cpen321application.data.TripStatus
import com.example.cpen321application.data.UnauthorizedException
import java.io.IOException
import java.net.HttpURLConnection.HTTP_CONFLICT
import java.time.Instant
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

const val TRIP_HISTORY_FAILED = "Couldn't load trip history. Check your connection and try again."
const val TRIP_SAVED = "Saved to History"
const val TRIP_STARTED = "Trip started"
const val TRIP_ENDED = "Trip ended"
const val TRIP_CANCELLED = "Trip cancelled"
const val TRIP_DELETED = "Trip deleted"
const val TRIP_CHANGE_OFFLINE = "Couldn't update the trip. Check your connection and try again."
const val TRIP_CHANGE_FAILED = "Couldn't update this trip, so History was refreshed."

/**
 * The signed-in user's saved trips, and the actions on them: save or start a planned route,
 * start a planned trip, end the active one, and delete a planned one.
 *
 * Only one trip can be active. When the backend says another one is, [isConfirmingEndActive]
 * asks the user to end it, and confirming cancels it and retries the start.
 *
 * The activity owns one instance, so History, Trip Preview and Navigation share one list.
 */
class TripHistoryViewModel(private val api: TripApi, private val store: SessionStore) : ViewModel() {
    var trips by mutableStateOf<List<Trip>?>(null)
        private set

    var isLoading by mutableStateOf(false)
        private set

    var loadError by mutableStateOf<String?>(null)
        private set

    /** Whether a start, end or delete is running, so the buttons can ignore more taps. */
    var isChanging by mutableStateOf(false)
        private set

    /** The snackbar message, until [messageShown] clears it. */
    var message by mutableStateOf<String?>(null)
        private set

    /** The trip just completed, for Navigation's summary, until [finishedShown] clears it. */
    var finishedTrip by mutableStateOf<Trip?>(null)
        private set

    /** The trip being travelled, which Navigation shows. */
    val activeTrip: Trip?
        get() = trips?.firstOrNull { it.status == TripStatus.ACTIVE }

    private var pendingStart by mutableStateOf<(suspend (token: String) -> Trip)?>(null)

    /** Whether "End your current trip?" is open, because a start was refused while another trip is active. */
    val isConfirmingEndActive: Boolean
        get() = pendingStart != null

    private var requestId = 0
    private var changeJob: Job? = null

    fun load(onUnauthorized: () -> Unit) {
        if (isLoading || trips != null) return
        val currentRequest = ++requestId
        isLoading = true
        loadError = null
        viewModelScope.launch {
            try {
                trips = api.getTripHistory(token())
            } catch (e: UnauthorizedException) {
                if (currentRequest == requestId) onUnauthorized()
            } catch (e: IOException) {
                if (currentRequest == requestId) loadError = TRIP_HISTORY_FAILED
            } finally {
                if (currentRequest == requestId) isLoading = false
            }
        }
    }

    /** Saves a route from Trip Preview to History as a planned trip. */
    fun save(route: RouteOption, arriveBy: Instant?, onUnauthorized: () -> Unit) = change(onUnauthorized) { token ->
        put(api.saveTrip(token, route, TripStatus.PLANNED, arriveBy, Instant.now()))
        TRIP_SAVED
    }

    /** Saves a route from Trip Preview as a trip started now. */
    fun startRoute(route: RouteOption, arriveBy: Instant?, onUnauthorized: () -> Unit) =
        start(onUnauthorized) { token -> api.saveTrip(token, route, TripStatus.ACTIVE, arriveBy, Instant.now()) }

    /** Starts a planned trip now. */
    fun startPlanned(trip: Trip, onUnauthorized: () -> Unit) =
        start(onUnauthorized) { token -> api.changeTripStatus(token, trip.id, TripStatus.ACTIVE, Instant.now()) }

    /** Ends the active trip now, as completed (counted in the totals) or cancelled (kept for the record). */
    fun end(trip: Trip, completed: Boolean, onUnauthorized: () -> Unit) = change(onUnauthorized) { token ->
        val status = if (completed) TripStatus.COMPLETED else TripStatus.CANCELLED
        val ended = api.changeTripStatus(token, trip.id, status, Instant.now())
        put(ended)
        if (completed) finishedTrip = ended
        if (completed) TRIP_ENDED else TRIP_CANCELLED
    }

    /** Closes Navigation's summary of the trip just completed. */
    fun finishedShown() {
        finishedTrip = null
    }

    /** Deletes a planned trip. */
    fun delete(trip: Trip, onUnauthorized: () -> Unit) = change(onUnauthorized) { token ->
        api.deleteTrip(token, trip.id)
        trips = trips?.filterNot { it.id == trip.id }
        TRIP_DELETED
    }

    /**
     * Cancels the active trip and retries the refused start, after the user confirms.
     *
     * The active trip comes from a fresh list rather than [trips], since it may have been
     * started on another device.
     */
    fun endActiveAndStart(onUnauthorized: () -> Unit) {
        val startTrip = pendingStart ?: return
        pendingStart = null
        start(onUnauthorized) { token ->
            val latest = api.getTripHistory(token)
            trips = latest
            latest.firstOrNull { it.status == TripStatus.ACTIVE }?.let {
                put(api.changeTripStatus(token, it.id, TripStatus.CANCELLED, Instant.now()))
            }
            startTrip(token)
        }
    }

    /** Closes "End your current trip?" without changing anything. */
    fun keepActive() {
        pendingStart = null
    }

    fun messageShown() {
        message = null
    }

    fun reset() {
        requestId++
        changeJob?.cancel() // so a change that finishes after sign-out can't bring back this user's trips
        trips = null
        isLoading = false
        loadError = null
        isChanging = false
        message = null
        finishedTrip = null
        pendingStart = null
    }

    private suspend fun token() = store.token() ?: throw UnauthorizedException()

    // runs startTrip, and when another trip is active, keeps it to retry once the user confirms
    private fun start(onUnauthorized: () -> Unit, startTrip: suspend (token: String) -> Trip) =
        change(onUnauthorized) { token ->
            try {
                put(startTrip(token))
                TRIP_STARTED
            } catch (e: HttpException) {
                if (e.code != HTTP_CONFLICT || e.error != TRIP_ALREADY_ACTIVE_ERROR) throw e
                pendingStart = startTrip
                null
            }
        }

    // runs one change at a time and shows how it went, where action returns its success message or null for none
    private fun change(onUnauthorized: () -> Unit, action: suspend (token: String) -> String?) {
        if (isChanging) return
        isChanging = true
        changeJob = viewModelScope.launch {
            try {
                message = action(token())
                if (trips == null) load(onUnauthorized) // History hadn't loaded (e.g. offline at launch), so the new trip comes with it
            } catch (e: UnauthorizedException) {
                onUnauthorized()
            } catch (e: HttpException) {
                // e.g. the trip was ended or deleted on another device, so the list is out of date
                message = TRIP_CHANGE_FAILED
                trips = null
                load(onUnauthorized)
            } catch (e: IOException) {
                message = TRIP_CHANGE_OFFLINE
            } finally {
                isChanging = false
            }
        }
    }

    // puts the updated trip in place of the old copy, or first in the list when it's new
    private fun put(updated: Trip) {
        val current = trips ?: return
        trips = if (current.any { it.id == updated.id }) {
            current.map { if (it.id == updated.id) updated else it }
        } else {
            listOf(updated) + current
        }
    }
}
