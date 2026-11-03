package com.example.cpen321application

import com.example.cpen321application.data.FakePlannerApi
import com.example.cpen321application.data.HttpException
import com.example.cpen321application.data.PlanPlace
import com.example.cpen321application.data.PlanRequest
import com.example.cpen321application.data.PlannerApi
import com.example.cpen321application.data.RouteLabel
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.data.TripPlan
import com.example.cpen321application.data.UnauthorizedException
import com.example.cpen321application.ui.planning.PlanStatus
import com.example.cpen321application.ui.planning.PlanningViewModel
import com.example.cpen321application.ui.planning.REPLAN_DELAY_MS
import com.example.cpen321application.ui.planning.SortBy
import com.example.cpen321application.ui.planning.TripEnd
import org.junit.Assert.assertNull
import com.google.android.gms.maps.model.LatLng
import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private val HOME = PlanPlace("Home", LatLng(49.2606, -123.2460))
private val WATERFRONT = PlanPlace("Waterfront Station", LatLng(49.2858, -123.1118))
private val METROTOWN = PlanPlace("Metrotown", LatLng(49.2276, -123.0076))

/** Wraps the fake Planner, recording every request. Set [failure] to make the next plans throw it. */
private class RecordingPlanner : PlannerApi {
    private val fake = FakePlannerApi(delayMs = 0, clock = { Instant.parse("2026-11-02T15:00:00Z") })
    val requests = mutableListOf<PlanRequest>()
    var failure: IOException? = null
    var empty = false

    override suspend fun planTrip(sessionToken: String?, trip: PlanRequest): TripPlan {
        requests += trip
        failure?.let { throw it }
        return if (empty) TripPlan(emptyList(), emptyList()) else fake.planTrip(sessionToken, trip)
    }
}

private object PlanTokenStore : SessionStore {
    override suspend fun token() = "token"
    override suspend fun setToken(token: String?) = Unit
    override suspend fun pendingSignOuts() = emptySet<String>()
    override suspend fun endSession() = Unit
    override suspend fun forget(token: String) = Unit
}

@OptIn(ExperimentalCoroutinesApi::class)
class PlanningViewModelTest {
    private val dispatcher = StandardTestDispatcher() // lets the tests control the replan delay
    private val api = RecordingPlanner()
    private lateinit var viewModel: PlanningViewModel

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        viewModel = PlanningViewModel(api, PlanTokenStore)
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun openingPlansStraightAwayAndSelectsTheFirstRoute() = runTest(dispatcher) {
        viewModel.start(WATERFRONT, from = HOME)
        advanceUntilIdle()

        assertEquals(PlanStatus.READY, viewModel.status)
        assertEquals(3, viewModel.options.size)
        assertEquals(RouteLabel.CHEAPEST, viewModel.selectedRoute?.label)
        assertEquals(1, api.requests.size)
    }

    @Test
    fun withNoStartPointItAsksForOneInsteadOfPlanning() = runTest(dispatcher) {
        viewModel.start(WATERFRONT, from = null)
        advanceUntilIdle()

        assertEquals(PlanStatus.NEEDS_ORIGIN, viewModel.status)
        assertTrue(api.requests.isEmpty())

        viewModel.changeOrigin(HOME)
        advanceUntilIdle()
        assertEquals(PlanStatus.READY, viewModel.status)
    }

    @Test
    fun quickChangesAreOneRequestWithTheLatestValues() = runTest(dispatcher) {
        viewModel.start(WATERFRONT, from = HOME)
        advanceUntilIdle()

        val nine = Instant.parse("2026-11-02T16:00:00Z")
        viewModel.changeArriveBy(Instant.parse("2026-11-02T15:00:00Z"))
        advanceTimeBy(REPLAN_DELAY_MS / 2)
        viewModel.changeArriveBy(nine)
        advanceTimeBy(REPLAN_DELAY_MS / 2)
        viewModel.toggleMode(TripMode.DRIVE)
        advanceUntilIdle()

        assertEquals(2, api.requests.size) // the opening plan, then one for all three changes
        assertEquals(nine, api.requests.last().arriveBy)
        assertEquals(setOf(TripMode.TRANSIT), api.requests.last().modes)
    }

    @Test
    fun theOldRoutesStayWhileANewPlanLoads() = runTest(dispatcher) {
        viewModel.start(WATERFRONT, from = HOME)
        advanceUntilIdle()

        viewModel.changeArriveBy(Instant.parse("2026-11-02T17:00:00Z"))

        assertEquals(PlanStatus.LOADING, viewModel.status)
        assertEquals(3, viewModel.options.size)
    }

    @Test
    fun sortingReordersWithoutReplanningAndKeepsTheSelection() = runTest(dispatcher) {
        viewModel.start(WATERFRONT, from = HOME)
        advanceUntilIdle()
        assertEquals(RouteLabel.CHEAPEST, viewModel.options.first().label) // sorted by cost by default

        viewModel.changeSort(SortBy.TIME)
        advanceUntilIdle()

        assertEquals(RouteLabel.FASTEST, viewModel.options.first().label)
        assertEquals(RouteLabel.CHEAPEST, viewModel.selectedRoute?.label) // still the one that was selected
        assertEquals(1, api.requests.size)
    }

    @Test
    fun aNewPlanKeepsTheChosenOrder() = runTest(dispatcher) {
        viewModel.changeSort(SortBy.TIME)
        viewModel.start(WATERFRONT, from = HOME)
        advanceUntilIdle()

        assertEquals(RouteLabel.FASTEST, viewModel.selectedRoute?.label)
    }

    @Test
    fun searchingForANewStartReplansFromIt() = runTest(dispatcher) {
        viewModel.start(WATERFRONT, from = HOME)
        advanceUntilIdle()

        viewModel.openSearch(TripEnd.START)
        assertEquals(TripEnd.START, viewModel.editingEnd)
        viewModel.pickPlace(METROTOWN)
        advanceUntilIdle()

        assertNull(viewModel.editingEnd)
        assertEquals(METROTOWN, viewModel.origin)
        assertEquals(METROTOWN, api.requests.last().origin)
        assertEquals(HOME, viewModel.myLocation) // still offered to switch back to
    }

    @Test
    fun searchingForANewDestinationReplansToIt() = runTest(dispatcher) {
        viewModel.start(WATERFRONT, from = HOME)
        viewModel.openSearch(TripEnd.DESTINATION)
        viewModel.pickPlace(METROTOWN)
        advanceUntilIdle()

        assertEquals(METROTOWN, api.requests.last().destination)
    }

    @Test
    fun closingTheSearchChangesNothing() = runTest(dispatcher) {
        viewModel.start(WATERFRONT, from = HOME)
        advanceUntilIdle()
        viewModel.openSearch(TripEnd.START)
        viewModel.closeSearch()
        viewModel.pickPlace(METROTOWN) // with the search closed, there's nothing to set
        advanceUntilIdle()

        assertEquals(HOME, viewModel.origin)
        assertEquals(1, api.requests.size)
    }

    @Test
    fun theLastModeCantBeTurnedOff() = runTest(dispatcher) {
        viewModel.start(WATERFRONT, from = HOME)
        viewModel.toggleMode(TripMode.DRIVE)
        viewModel.toggleMode(TripMode.TRANSIT)

        assertEquals(setOf(TripMode.TRANSIT), viewModel.modes)
    }

    @Test
    fun swappingSwapsAndReplans() = runTest(dispatcher) {
        viewModel.start(WATERFRONT, from = HOME)
        advanceUntilIdle()
        viewModel.swap()
        advanceUntilIdle()

        assertEquals(WATERFRONT, viewModel.origin)
        assertEquals(HOME, viewModel.destination)
        assertEquals(HOME, api.requests.last().destination)
    }

    @Test
    fun selectingOpensPreviewAndBackKeepsTheRoutesWithoutReplanning() = runTest(dispatcher) {
        viewModel.start(WATERFRONT, from = HOME)
        advanceUntilIdle()

        viewModel.select(1) // by cost: Cheapest $3.35, Balanced $3.58, Fastest $3.90
        assertTrue(viewModel.isPreviewing)
        assertEquals(RouteLabel.BALANCED, viewModel.selectedRoute?.label)

        viewModel.closePreview()
        advanceUntilIdle()
        assertFalse(viewModel.isPreviewing)
        assertEquals(RouteLabel.BALANCED, viewModel.selectedRoute?.label)
        assertEquals(1, api.requests.size)
    }

    @Test
    fun noRoutesSaysSo() = runTest(dispatcher) {
        api.empty = true
        viewModel.start(WATERFRONT, from = HOME)
        advanceUntilIdle()

        assertEquals(PlanStatus.NO_ROUTES, viewModel.status)
    }

    @Test
    fun aFailureCanBeRetried() = runTest(dispatcher) {
        api.failure = HttpException(503)
        viewModel.start(WATERFRONT, from = HOME)
        advanceUntilIdle()
        assertEquals(PlanStatus.FAILED, viewModel.status)

        api.failure = null
        viewModel.retry()
        advanceUntilIdle()
        assertEquals(PlanStatus.READY, viewModel.status)
    }

    @Test
    fun anExpiredSessionIsReported() = runTest(dispatcher) {
        api.failure = UnauthorizedException()
        viewModel.start(WATERFRONT, from = HOME)
        advanceUntilIdle()

        assertTrue(viewModel.sessionExpired)
        viewModel.sessionExpiredShown()
        assertFalse(viewModel.sessionExpired)
    }

    @Test
    fun aChangeBeforeThePlanRunsReplacesIt() = runTest(dispatcher) {
        viewModel.start(WATERFRONT, from = HOME)
        viewModel.changeDestination(METROTOWN) // before the first plan has run
        advanceUntilIdle()

        assertEquals(METROTOWN, viewModel.selectedRoute?.legs?.last()?.to)
    }
}
