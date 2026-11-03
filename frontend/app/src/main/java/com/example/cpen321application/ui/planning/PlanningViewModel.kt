package com.example.cpen321application.ui.planning

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.cpen321application.data.DEFAULT_MAX_WALK_MINUTES
import com.example.cpen321application.data.DEFAULT_PLANNING_PREFERENCES
import com.example.cpen321application.data.DEFAULT_TRIP_MODES
import com.example.cpen321application.data.PlanPlace
import com.example.cpen321application.data.PlanRequest
import com.example.cpen321application.data.PlanWarning
import com.example.cpen321application.data.PlannerApi
import com.example.cpen321application.data.PlanningPreferences
import com.example.cpen321application.data.PlanningPreferencesApi
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.TripPlan
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.data.UnauthorizedException
import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

const val REPLAN_DELAY_MS = 500L // wait for the user to stop changing things before asking again
const val ROUTE_SERVICE_DOWN = "Couldn't reach the route service."

/** The max walk choices offered, in minutes. */
val MAX_WALK_CHOICES = listOf(5, 10, 15, 20, 30)

/** One end of the trip, for changing it by search. */
enum class TripEnd { START, DESTINATION }

/** Where planning is up to. */
enum class PlanStatus {
    NEEDS_ORIGIN, // no start point yet (location off and none chosen)
    LOADING,
    READY,
    NO_ROUTES,
    FAILED,
}

/**
 * Planning and Trip Preview (#73): what the user asked for, the Planner's routes, and
 * which one they're looking at.
 *
 * Every change to the trip (places, modes, arrive-by) asks the Planner again after a
 * short pause, cancelling any request still running, so quick changes are one request.
 * While a new plan loads, the old routes stay on screen. Sorting, and opening or closing
 * Preview, never replan. The Planner weighs cost against time with the user's saved
 * preference; Sort by only reorders its routes.
 *
 * The first time Planning opens, it loads the user's saved preferences and starts from
 * their default modes and max walk. Changing the max walk saves it as the new default;
 * changing modes only affects this trip.
 *
 * The ViewModel outlives screen rotation, so rotating keeps everything without a request.
 */
class PlanningViewModel(
    private val api: PlannerApi,
    private val preferencesApi: PlanningPreferencesApi,
    private val store: SessionStore,
) : ViewModel() {
    var origin by mutableStateOf<PlanPlace?>(null)
        private set

    var destination by mutableStateOf<PlanPlace?>(null)
        private set

    var modes by mutableStateOf(DEFAULT_TRIP_MODES)
        private set

    /** The longest single walk a route may have, in minutes; saved as the user's default when changed. */
    var maxWalkMinutes by mutableStateOf(DEFAULT_MAX_WALK_MINUTES)
        private set

    /** When the user must arrive, or `null` to leave now. */
    var arriveBy by mutableStateOf<Instant?>(null)
        private set

    var sortBy by mutableStateOf(SortBy.COST)
        private set

    var status by mutableStateOf(PlanStatus.NEEDS_ORIGIN)
        private set

    /** The latest routes in [sortBy] order, kept while a new plan loads so the screen doesn't go blank. */
    var options by mutableStateOf<List<RouteOption>>(emptyList())
        private set

    var warnings by mutableStateOf<List<PlanWarning>>(emptyList())
        private set

    var selectedIndex by mutableStateOf(0)
        private set

    /** Whether Trip Preview is open for the selected route. */
    var isPreviewing by mutableStateOf(false)
        private set

    /** Which end of the trip the search box is open for, or `null` when it's closed. */
    var editingEnd by mutableStateOf<TripEnd?>(null)
        private set

    /** The user's location when Planning opened, offered in the search so they can switch back to it. */
    var myLocation by mutableStateOf<PlanPlace?>(null)
        private set

    /** Set when the session has expired, so the screen can send the user to sign in. */
    var sessionExpired by mutableStateOf(false)
        private set

    val selectedRoute: RouteOption?
        get() = options.getOrNull(selectedIndex)

    private var preferences: PlanningPreferences? = null // null until loaded, the first time Planning opens
    private var planJob: Job? = null
    private var planRun = 0 // bumped by each new plan, so a replaced one that finishes late is ignored

    /** Opens Planning for a destination, starting from [from] (the user's location) when known. Plans straight away. */
    fun start(to: PlanPlace, from: PlanPlace?) {
        destination = to
        origin = from
        myLocation = from
        editingEnd = null
        isPreviewing = false
        options = emptyList()
        warnings = emptyList()
        if (preferences != null) {
            replan(delayMs = 0)
            return
        }
        // loads the saved defaults before the first plan, unless the user changes something first
        planJob?.cancel()
        val run = ++planRun
        status = PlanStatus.LOADING
        planJob = viewModelScope.launch {
            val loaded = loadPreferences()
            if (run == planRun) {
                modes = loaded.defaultModes
                maxWalkMinutes = loaded.maxWalkMinutes
                replan(delayMs = 0)
            }
        }
    }

    /** Sets the longest single walk allowed, replans, and saves it as the user's default. */
    fun changeMaxWalk(minutes: Int) {
        if (minutes == maxWalkMinutes) return
        maxWalkMinutes = minutes
        replan()
        val updated = (preferences ?: DEFAULT_PLANNING_PREFERENCES).copy(maxWalkMinutes = minutes)
        preferences = updated
        viewModelScope.launch {
            try {
                preferencesApi.savePlanningPreferences(token(), updated)
            } catch (e: UnauthorizedException) {
                sessionExpired = true
            } catch (e: IOException) {
                // this trip already uses it; it just isn't the default next time
            }
        }
    }

    // the saved preferences, or the defaults when they can't be loaded (planning still works)
    private suspend fun loadPreferences(): PlanningPreferences {
        val loaded = try {
            preferencesApi.getPlanningPreferences(token())
        } catch (e: UnauthorizedException) {
            sessionExpired = true
            DEFAULT_PLANNING_PREFERENCES
        } catch (e: IOException) {
            DEFAULT_PLANNING_PREFERENCES
        }
        preferences = loaded
        return loaded
    }

    private suspend fun token() = store.token() ?: throw UnauthorizedException()

    fun changeOrigin(place: PlanPlace) {
        origin = place
        replan()
    }

    fun changeDestination(place: PlanPlace) {
        destination = place
        replan()
    }

    /** Opens the search box to change the start or the destination. */
    fun openSearch(end: TripEnd) {
        editingEnd = end
    }

    /** Closes the search box without changing anything. */
    fun closeSearch() {
        editingEnd = null
    }

    /** Sets the end being searched for to [place], closes the search and replans. */
    fun pickPlace(place: PlanPlace) {
        when (editingEnd ?: return) {
            TripEnd.START -> origin = place
            TripEnd.DESTINATION -> destination = place
        }
        editingEnd = null
        replan(delayMs = 0) // a deliberate pick, so no need to wait for more changes
    }

    /** Swaps start and destination. Does nothing until both are set. */
    fun swap() {
        val from = origin ?: return
        val to = destination ?: return
        origin = to
        destination = from
        replan()
    }

    /** Turns a mode on or off. The last mode on can't be turned off. */
    fun toggleMode(mode: TripMode) {
        val next = if (mode in modes) modes - mode else modes + mode
        if (next.isEmpty()) return
        modes = next
        replan()
    }

    /** Sets the time the user must arrive by, or `null` for "Leave now". */
    fun changeArriveBy(time: Instant?) {
        arriveBy = time
        replan()
    }

    /** Reorders the routes, keeping the same one selected. Doesn't replan. */
    fun changeSort(order: SortBy) {
        val selected = selectedRoute
        sortBy = order
        options = sortRoutes(options, order)
        selectedIndex = options.indexOf(selected).coerceAtLeast(0)
    }

    /** Selects a route and opens its Trip Preview (tapping a card or a grey line). */
    fun select(index: Int) {
        if (index !in options.indices) return
        selectedIndex = index
        isPreviewing = true
    }

    /** Back from Trip Preview to Planning, with the same routes. */
    fun closePreview() {
        isPreviewing = false
    }

    /** Plans again now. What the Retry button calls. */
    fun retry() = replan(delayMs = 0)

    /** Called once the screen has handled [sessionExpired]. */
    fun sessionExpiredShown() {
        sessionExpired = false
    }

    private fun show(plan: TripPlan) {
        options = sortRoutes(plan.options, sortBy)
        warnings = plan.warnings
        selectedIndex = 0 // the first route is selected on load
        status = if (plan.options.isEmpty()) PlanStatus.NO_ROUTES else PlanStatus.READY
    }

    private fun replan(delayMs: Long = REPLAN_DELAY_MS) {
        planJob?.cancel()
        val run = ++planRun
        val from = origin
        val to = destination
        if (from == null || to == null) {
            status = PlanStatus.NEEDS_ORIGIN
            return
        }
        status = PlanStatus.LOADING
        // no costVsTime, so the backend uses the user's saved preference
        val request = PlanRequest(from, to, arriveBy, modes, maxWalkMinutes = maxWalkMinutes)
        planJob = viewModelScope.launch {
            delay(delayMs) // cancelled here if the user changes something else first
            try {
                val plan = api.planTrip(token(), request)
                if (run == planRun) show(plan)
            } catch (e: UnauthorizedException) {
                if (run == planRun) {
                    status = PlanStatus.FAILED
                    sessionExpired = true
                }
            } catch (e: IOException) {
                if (run == planRun) status = PlanStatus.FAILED // no network, a 503, or anything else the backend refused
            }
        }
    }
}
