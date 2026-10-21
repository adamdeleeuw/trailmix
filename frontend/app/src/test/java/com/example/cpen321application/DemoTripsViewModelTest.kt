package com.example.cpen321application

import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.Trip
import com.example.cpen321application.data.TripApi
import com.example.cpen321application.data.TripLeg
import com.example.cpen321application.data.TripPlace
import com.example.cpen321application.data.UnauthorizedException
import com.example.cpen321application.ui.route.DemoTripsViewModel
import com.example.cpen321application.ui.route.SEED_FAILED
import com.example.cpen321application.ui.route.seededMessage
import java.io.IOException
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

private fun trip(id: String) = Trip(
    id, TripPlace("Home"), TripPlace("UBC"), listOf(TripLeg("DRIVE", 600)), 600, 125, "2026-10-19T15:15:00.000Z",
)

/** In-memory trips backend. Set [failure] to make seeding throw it, or [pending] to hold a seed open. */
private class FakeTrips : TripApi {
    var failure: IOException? = null
    var pending: CompletableDeferred<Unit>? = null
    var seedCalls = 0

    override suspend fun getTripHistory(sessionToken: String) = emptyList<Trip>()

    override suspend fun seedDemoTrips(sessionToken: String): List<Trip> {
        seedCalls++
        pending?.await()
        failure?.let { throw it }
        return List(10) { trip("$it") }
    }
}

private object SeedTokenStore : SessionStore {
    override suspend fun token() = "token"
    override suspend fun setToken(token: String?) = Unit
    override suspend fun pendingSignOuts() = emptySet<String>()
    override suspend fun endSession() = Unit
    override suspend fun forget(token: String) = Unit
}

@OptIn(ExperimentalCoroutinesApi::class)
class DemoTripsViewModelTest {
    private val api = FakeTrips()
    private lateinit var viewModel: DemoTripsViewModel // built after the test dispatcher is set
    private var seeded = false
    private var signedOut = false

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        viewModel = DemoTripsViewModel(api, SeedTokenStore)
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun seed() = viewModel.seed(onSeeded = { seeded = true }, onUnauthorized = { signedOut = true })

    @Test
    fun seedingReportsTheTripCountAndReloadsHistory() {
        seed()
        assertTrue(seeded)
        assertFalse(viewModel.isSeeding)
        assertEquals(seededMessage(10), viewModel.message)
        viewModel.messageShown()
        assertNull(viewModel.message)
    }

    @Test
    fun offlineShowsTheErrorWithoutReloading() {
        api.failure = IOException()
        seed()
        assertFalse(seeded)
        assertFalse(viewModel.isSeeding)
        assertEquals(SEED_FAILED, viewModel.message)
    }

    @Test
    fun expiredSessionSignsOut() {
        api.failure = UnauthorizedException()
        seed()
        assertTrue(signedOut)
        assertFalse(seeded)
        assertNull(viewModel.message)
    }

    @Test
    fun tapsWhileSeedingAreIgnored() {
        val pending = CompletableDeferred<Unit>()
        api.pending = pending
        seed()
        assertTrue(viewModel.isSeeding)
        seed()
        assertEquals(1, api.seedCalls)
        pending.complete(Unit)
        assertTrue(seeded)
        assertFalse(viewModel.isSeeding)
    }
}
