package com.example.cpen321application.ui.main

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.Trip
import com.example.cpen321application.data.TripApi
import com.example.cpen321application.data.UnauthorizedException
import java.io.IOException
import kotlinx.coroutines.launch

const val TRIP_HISTORY_FAILED = "Couldn't load trip history. Check your connection and try again."

/** Loads the signed-in user's saved trips when the history is opened. */
class TripHistoryViewModel(private val api: TripApi, private val store: SessionStore) : ViewModel() {
    var trips by mutableStateOf<List<Trip>?>(null)
        private set

    var isLoading by mutableStateOf(false)
        private set

    var loadError by mutableStateOf<String?>(null)
        private set

    private var requestId = 0

    fun load(onUnauthorized: () -> Unit) {
        if (isLoading || trips != null) return
        val currentRequest = ++requestId
        isLoading = true
        loadError = null
        viewModelScope.launch {
            try {
                trips = api.getTripHistory(store.token() ?: throw UnauthorizedException())
            } catch (e: UnauthorizedException) {
                if (currentRequest == requestId) onUnauthorized()
            } catch (e: IOException) {
                if (currentRequest == requestId) loadError = TRIP_HISTORY_FAILED
            } finally {
                if (currentRequest == requestId) isLoading = false
            }
        }
    }

    fun reset() {
        requestId++
        trips = null
        isLoading = false
        loadError = null
    }
}