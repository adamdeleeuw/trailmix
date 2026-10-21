package com.example.cpen321application.ui.route

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.TripApi
import com.example.cpen321application.data.UnauthorizedException
import java.io.IOException
import kotlinx.coroutines.launch

const val SEED_FAILED = "Couldn't add demo trips. Check your connection and try again."

/** What the snackbar says after the demo trips are added. */
fun seededMessage(tripCount: Int) = "Demo trips added. History now has $tripCount trips."

/** Runs the Map tab's "Load demo trips" button, which fills History and Commute Insights for any user. */
class DemoTripsViewModel(private val api: TripApi, private val store: SessionStore) : ViewModel() {
    var isSeeding by mutableStateOf(false)
        private set

    /** The snackbar message, until [messageShown] clears it. */
    var message by mutableStateOf<String?>(null)
        private set

    /** Replaces the user's demo trips. Taps while it's already running are ignored. */
    fun seed(onSeeded: () -> Unit, onUnauthorized: () -> Unit) {
        if (isSeeding) return
        isSeeding = true
        message = null
        viewModelScope.launch {
            try {
                val trips = api.seedDemoTrips(store.token() ?: throw UnauthorizedException())
                message = seededMessage(trips.size)
                onSeeded()
            } catch (e: UnauthorizedException) {
                onUnauthorized()
            } catch (e: IOException) {
                message = SEED_FAILED
            } finally {
                isSeeding = false
            }
        }
    }

    fun messageShown() {
        message = null
    }
}
