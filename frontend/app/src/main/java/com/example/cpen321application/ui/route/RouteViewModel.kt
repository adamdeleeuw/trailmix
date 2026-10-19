package com.example.cpen321application.ui.route

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.cpen321application.data.ChainedRoute
import com.example.cpen321application.data.HttpException
import com.example.cpen321application.data.RoutesApi
import com.example.cpen321application.data.SessionStore
import com.google.android.gms.maps.model.LatLng
import java.io.IOException
import java.net.HttpURLConnection.HTTP_NOT_FOUND
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

const val STOP_COUNT = 3 // start, split point, destination
const val NO_ROUTE = "No route found. Try moving the split point closer to transit."
const val PLAN_FAILED = "Couldn't plan the route. Check your connection and try again."

/** Holds the points the user picked and plans the route once all three are set. */
class RouteViewModel(
    private val api: RoutesApi,
    private val store: SessionStore,
) : ViewModel() {
    /** The tapped points in order: start, split point, destination. */
    val points = mutableStateListOf<LatLng>()

    var route by mutableStateOf<ChainedRoute?>(null)
        private set

    var isPlanning by mutableStateOf(false)
        private set

    var error by mutableStateOf<String?>(null)
        private set

    private var planJob: Job? = null

    /** Adds the next point. The third one plans the route. */
    fun addPoint(point: LatLng) {
        if (points.size >= STOP_COUNT) return
        points.add(point)
        if (points.size == STOP_COUNT) plan()
    }

    /** Clears everything so the user can pick again. */
    fun reset() {
        planJob?.cancel()
        points.clear()
        route = null
        error = null
        isPlanning = false
    }

    /** Plans the route for the three points. Also what the Retry button calls. */
    fun plan() {
        if (points.size != STOP_COUNT || isPlanning) return
        isPlanning = true
        error = null
        planJob = viewModelScope.launch {
            try {
                route = api.planChainedRoute(store.token(), points[0], points[1], points[2])
            } catch (e: HttpException) {
                error = if (e.code == HTTP_NOT_FOUND) NO_ROUTE else PLAN_FAILED
            } catch (e: IOException) {
                error = PLAN_FAILED
            } finally {
                isPlanning = false
            }
        }
    }
}
