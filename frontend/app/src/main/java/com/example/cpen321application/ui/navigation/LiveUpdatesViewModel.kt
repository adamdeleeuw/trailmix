package com.example.cpen321application.ui.navigation

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import com.example.cpen321application.data.HttpException
import com.example.cpen321application.data.LiveUpdate
import com.example.cpen321application.data.LiveUpdateApi
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.UnauthorizedException
import java.io.IOException
import java.net.HttpURLConnection.HTTP_CONFLICT
import java.net.HttpURLConnection.HTTP_NOT_FOUND
import kotlinx.coroutines.delay

/** How often Navigation asks the backend for live times (#87). The backend polls TransLink every 30 s. */
const val LIVE_POLL_MS = 15_000L

/**
 * TransLink's live times and alerts for the active trip (#87), polled while Navigation is on screen.
 *
 * [poll] runs until it's cancelled, so Navigation runs it in an effect tied to the trip, the current leg and the
 * screen being started: leaving Navigation, moving to another leg or putting the app in the background stops it,
 * and the backend stops polling TransLink two minutes later. The last update is kept here, so rotating the screen
 * doesn't lose it.
 */
class LiveUpdatesViewModel(private val api: LiveUpdateApi, private val store: SessionStore) : ViewModel() {
    private var tripId: String? = null

    /** The latest update for the trip [poll] was last called with, or `null` before the first answer. */
    var update by mutableStateOf<LiveUpdate?>(null)
        private set

    /**
     * Asks for the live update of [tripId] from leg [fromLeg] on, now and every [LIVE_POLL_MS], until cancelled.
     *
     * When the backend can't be reached, the update says not live but keeps the alerts already shown, so a dropped
     * request doesn't make the banner flicker. Stops when the session is invalid (calling [onUnauthorized]) or the
     * trip is no longer active.
     */
    suspend fun poll(tripId: String, fromLeg: Int, onUnauthorized: () -> Unit) {
        if (this.tripId != tripId) {
            this.tripId = tripId
            update = null // another trip's times and alerts don't apply
        }
        while (true) {
            val token = store.token()
            if (token == null) {
                onUnauthorized()
                return
            }
            try {
                update = api.getLiveUpdate(token, tripId, fromLeg)
            } catch (e: UnauthorizedException) {
                onUnauthorized()
                return
            } catch (e: HttpException) {
                if (e.code == HTTP_NOT_FOUND || e.code == HTTP_CONFLICT) {
                    update = null
                    return // the trip ended elsewhere, and History's next load leaves Navigation
                }
                update = notLive() // a server error, which the next poll may not have
            } catch (e: IOException) {
                update = notLive()
            }
            delay(LIVE_POLL_MS)
        }
    }

    // scheduled times, keeping the alerts already shown
    private fun notLive() = (update ?: LiveUpdate.NOT_LIVE).copy(live = false, updatedAt = null, legs = emptyList())

    /** Forgets the trip, e.g. after signing out. */
    fun reset() {
        tripId = null
        update = null
    }
}
