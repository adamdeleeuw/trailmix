package com.example.cpen321application

import com.example.cpen321application.data.HttpException
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.TRIP_ALREADY_ACTIVE_ERROR
import com.example.cpen321application.data.Trip
import com.example.cpen321application.data.TripApi
import com.example.cpen321application.data.TripStatus
import com.example.cpen321application.data.UnauthorizedException
import com.example.cpen321application.ui.main.TRIP_CANCELLED
import com.example.cpen321application.ui.main.TRIP_CHANGE_FAILED
import com.example.cpen321application.ui.main.TRIP_CHANGE_OFFLINE
import com.example.cpen321application.ui.main.TRIP_DELETED
import com.example.cpen321application.ui.main.TRIP_ENDED
import com.example.cpen321application.ui.main.TRIP_SAVED
import com.example.cpen321application.ui.main.TRIP_STARTED
import com.example.cpen321application.ui.main.TripHistoryViewModel
import java.io.IOException
import java.net.HttpURLConnection.HTTP_CONFLICT
import java.net.HttpURLConnection.HTTP_NOT_FOUND
import java.time.Instant
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** In-memory trips backend with the server's rules: one active trip, and only planned trips can be deleted. */
private class FakeTrips : TripApi {
    val trips = mutableListOf<Trip>()
    var failure: IOException? = null
    var pending: CompletableDeferred<Unit>? = null // holds a status change open until completed

    override suspend fun getTripHistory(sessionToken: String): List<Trip> {
        failure?.let { throw it }
        return trips.toList()
    }

    override suspend fun saveTrip(sessionToken: String, route: RouteOption, status: TripStatus, arriveBy: Instant?, at: Instant): Trip {
        failure?.let { throw it }
        if (status == TripStatus.ACTIVE) refuseSecondActive()
        val actualStart = if (status == TripStatus.ACTIVE) at else null
        return testTrip(id = "saved-${trips.size}", status = status).copy(route = route, actualStart = actualStart)
            .also { trips.add(0, it) }
    }

    override suspend fun changeTripStatus(sessionToken: String, id: String, status: TripStatus, at: Instant): Trip {
        pending?.await()
        failure?.let { throw it }
        val index = trips.indexOfFirst { it.id == id }
        if (index < 0) throw HttpException(HTTP_NOT_FOUND, "Trip not found")
        if (status == TripStatus.ACTIVE) refuseSecondActive()
        val times = if (status == TripStatus.ACTIVE) trips[index].copy(actualStart = at) else trips[index].copy(actualEnd = at)
        return times.copy(status = status).also { trips[index] = it }
    }

    private fun refuseSecondActive() {
        if (trips.any { it.status == TripStatus.ACTIVE }) throw HttpException(HTTP_CONFLICT, TRIP_ALREADY_ACTIVE_ERROR)
    }

    override suspend fun deleteTrip(sessionToken: String, id: String) {
        failure?.let { throw it }
        val trip = trips.find { it.id == id } ?: throw HttpException(HTTP_NOT_FOUND, "Trip not found")
        if (trip.status != TripStatus.PLANNED) throw HttpException(HTTP_CONFLICT, "Not allowed in the trip's current status")
        trips.remove(trip)
    }
}

private class TripsTokenStore(private val token: String? = "token") : SessionStore {
    override suspend fun token() = token
    override suspend fun setToken(token: String?) = Unit
    override suspend fun pendingSignOuts() = emptySet<String>()
    override suspend fun endSession() = Unit
    override suspend fun forget(token: String) = Unit
}

@OptIn(ExperimentalCoroutinesApi::class)
class TripHistoryViewModelTest {
    private val api = FakeTrips()
    private lateinit var viewModel: TripHistoryViewModel // built after the test dispatcher is set
    private var signedOut = false
    private val onUnauthorized = { signedOut = true }

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        viewModel = TripHistoryViewModel(api, TripsTokenStore())
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun load(vararg trips: Trip) {
        api.trips += trips
        viewModel.load(onUnauthorized)
    }

    private fun statusOf(id: String) = viewModel.trips?.find { it.id == id }?.status

    @Test
    fun startsAPlannedTrip() {
        val planned = testTrip(id = "p", status = TripStatus.PLANNED)
        load(planned)

        viewModel.startPlanned(planned, onUnauthorized)

        assertEquals(TripStatus.ACTIVE, statusOf("p"))
        assertEquals(TRIP_STARTED, viewModel.message)
        assertFalse(viewModel.isConfirmingEndActive)
    }

    @Test
    fun saveForLaterAddsAPlannedTrip() {
        load(testTrip(id = "done"))

        viewModel.save(testRoute(), arriveBy = null, onUnauthorized)

        assertEquals(TripStatus.PLANNED, viewModel.trips?.first()?.status)
        assertEquals(2, viewModel.trips?.size)
        assertEquals(TRIP_SAVED, viewModel.message)
        assertNull(viewModel.activeTrip)
    }

    @Test
    fun startingARouteMakesItTheActiveTrip() {
        load()

        viewModel.startRoute(testRoute(), arriveBy = null, onUnauthorized)

        assertEquals(testRoute(), viewModel.activeTrip?.route)
        assertEquals(TRIP_STARTED, viewModel.message)
    }

    @Test
    fun startingARouteWhileAnotherTripIsActiveAsksFirst() {
        load(testTrip(id = "a", status = TripStatus.ACTIVE))

        viewModel.startRoute(testRoute(), arriveBy = null, onUnauthorized)
        assertTrue(viewModel.isConfirmingEndActive)
        viewModel.endActiveAndStart(onUnauthorized)

        assertEquals(TripStatus.CANCELLED, statusOf("a"))
        assertEquals(testRoute(), viewModel.activeTrip?.route)
    }

    @Test
    fun startingBeforeHistoryLoadedLoadsItWithTheNewTrip() {
        api.failure = IOException()
        viewModel.load(onUnauthorized) // offline at launch
        api.failure = null

        viewModel.startRoute(testRoute(), arriveBy = null, onUnauthorized)

        assertEquals(testRoute(), viewModel.activeTrip?.route)
    }

    @Test
    fun startingWhileAnotherTripIsActiveAsksFirst() {
        val planned = testTrip(id = "p", status = TripStatus.PLANNED)
        load(planned, testTrip(id = "a", status = TripStatus.ACTIVE))

        viewModel.startPlanned(planned, onUnauthorized)

        assertTrue(viewModel.isConfirmingEndActive)
        assertEquals(TripStatus.PLANNED, statusOf("p"))
        assertEquals(TripStatus.ACTIVE, statusOf("a"))
        assertNull(viewModel.message)
    }

    @Test
    fun confirmingCancelsTheActiveTripAndStartsTheNewOne() {
        val planned = testTrip(id = "p", status = TripStatus.PLANNED)
        load(planned, testTrip(id = "a", status = TripStatus.ACTIVE))
        viewModel.startPlanned(planned, onUnauthorized)

        viewModel.endActiveAndStart(onUnauthorized)

        assertFalse(viewModel.isConfirmingEndActive)
        assertEquals(TripStatus.CANCELLED, statusOf("a"))
        assertEquals(TripStatus.ACTIVE, statusOf("p"))
        assertEquals(TRIP_STARTED, viewModel.message)
    }

    @Test
    fun confirmingFindsATripStartedOnAnotherDevice() {
        val planned = testTrip(id = "p", status = TripStatus.PLANNED)
        load(planned)
        api.trips += testTrip(id = "elsewhere", status = TripStatus.ACTIVE) // started after History loaded
        viewModel.startPlanned(planned, onUnauthorized)

        viewModel.endActiveAndStart(onUnauthorized)

        assertEquals(TripStatus.CANCELLED, statusOf("elsewhere"))
        assertEquals(TripStatus.ACTIVE, statusOf("p"))
    }

    @Test
    fun keepingTheActiveTripChangesNothing() {
        val planned = testTrip(id = "p", status = TripStatus.PLANNED)
        load(planned, testTrip(id = "a", status = TripStatus.ACTIVE))
        viewModel.startPlanned(planned, onUnauthorized)

        viewModel.keepActive()

        assertFalse(viewModel.isConfirmingEndActive)
        assertEquals(TripStatus.PLANNED, statusOf("p"))
        assertEquals(TripStatus.ACTIVE, statusOf("a"))
    }

    @Test
    fun endsTheActiveTripAsCompletedWithASummary() {
        val active = testTrip(id = "a", status = TripStatus.ACTIVE)
        load(active)

        viewModel.end(active, completed = true, onUnauthorized)

        assertEquals(TripStatus.COMPLETED, statusOf("a"))
        assertEquals(TRIP_ENDED, viewModel.message)
        assertNull(viewModel.activeTrip)
        assertEquals("a", viewModel.finishedTrip?.id)

        viewModel.finishedShown()
        assertNull(viewModel.finishedTrip)
    }

    @Test
    fun endingEarlyCancelsTheTripWithoutASummary() {
        val active = testTrip(id = "a", status = TripStatus.ACTIVE)
        load(active)

        viewModel.end(active, completed = false, onUnauthorized)

        assertEquals(TripStatus.CANCELLED, statusOf("a"))
        assertEquals(TRIP_CANCELLED, viewModel.message)
        assertNull(viewModel.finishedTrip)
    }

    @Test
    fun deletesAPlannedTrip() {
        val planned = testTrip(id = "p", status = TripStatus.PLANNED)
        load(planned, testTrip(id = "done"))

        viewModel.delete(planned, onUnauthorized)

        assertEquals(listOf("done"), viewModel.trips?.map { it.id })
        assertEquals(TRIP_DELETED, viewModel.message)
    }

    @Test
    fun aRefusedChangeRefreshesTheList() {
        val planned = testTrip(id = "p", status = TripStatus.PLANNED)
        load(planned)
        api.trips[0] = planned.copy(status = TripStatus.ACTIVE) // started on another device, so it can't be deleted

        viewModel.delete(planned, onUnauthorized)

        assertEquals(TRIP_CHANGE_FAILED, viewModel.message)
        assertEquals(TripStatus.ACTIVE, statusOf("p"))
    }

    @Test
    fun noNetworkKeepsTheTripAndSaysSo() {
        val planned = testTrip(id = "p", status = TripStatus.PLANNED)
        load(planned)
        api.failure = IOException()

        viewModel.startPlanned(planned, onUnauthorized)

        assertEquals(TRIP_CHANGE_OFFLINE, viewModel.message)
        assertEquals(TripStatus.PLANNED, statusOf("p"))
        assertFalse(viewModel.isChanging)
    }

    @Test
    fun anExpiredSessionSignsOut() {
        val planned = testTrip(id = "p", status = TripStatus.PLANNED)
        load(planned)
        api.failure = UnauthorizedException()

        viewModel.delete(planned, onUnauthorized)

        assertTrue(signedOut)
    }

    @Test
    fun tapsWhileAChangeIsRunningAreIgnored() {
        val active = testTrip(id = "a", status = TripStatus.ACTIVE)
        load(active, testTrip(id = "p", status = TripStatus.PLANNED))
        api.pending = CompletableDeferred()

        viewModel.end(active, completed = true, onUnauthorized)
        viewModel.delete(testTrip(id = "p", status = TripStatus.PLANNED), onUnauthorized)
        api.pending?.complete(Unit)

        assertEquals(TripStatus.COMPLETED, statusOf("a"))
        assertEquals(TripStatus.PLANNED, statusOf("p")) // the delete was ignored
    }

    @Test
    fun signingOutDropsAChangeStillRunning() {
        val active = testTrip(id = "a", status = TripStatus.ACTIVE)
        load(active)
        api.pending = CompletableDeferred()
        viewModel.end(active, completed = true, onUnauthorized)

        viewModel.reset()
        api.pending?.complete(Unit)

        assertNull(viewModel.trips)
        assertNull(viewModel.message)
    }
}
