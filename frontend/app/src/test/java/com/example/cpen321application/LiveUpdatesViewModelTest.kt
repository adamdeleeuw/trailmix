package com.example.cpen321application

import com.example.cpen321application.data.HttpException
import com.example.cpen321application.data.LiveAlert
import com.example.cpen321application.data.LiveUpdate
import com.example.cpen321application.data.LiveUpdateApi
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.UnauthorizedException
import com.example.cpen321application.ui.navigation.LIVE_POLL_MS
import com.example.cpen321application.ui.navigation.LiveUpdatesViewModel
import java.io.IOException
import java.net.HttpURLConnection.HTTP_CONFLICT
import java.net.HttpURLConnection.HTTP_INTERNAL_ERROR
import java.net.HttpURLConnection.HTTP_NOT_FOUND
import java.time.Instant
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private val DETOUR = LiveAlert("detour", "99 detour", null, "DETOUR", listOf(0), activeUntil = null)
private val LIVE = LiveUpdate(live = true, updatedAt = Instant.parse("2026-11-18T17:00:00Z"), legs = emptyList(), alerts = listOf(DETOUR))

/** A backend that answers each live update request with the next of [answers], then repeats the last one. */
private class FakeLiveApi(vararg answers: Any) : LiveUpdateApi {
    private val answers = answers.toMutableList()
    val calls = mutableListOf<Pair<String, Int>>()

    override suspend fun getLiveUpdate(sessionToken: String, tripId: String, fromLeg: Int): LiveUpdate {
        calls.add(tripId to fromLeg)
        val answer = if (answers.size > 1) answers.removeAt(0) else answers.first()
        if (answer is IOException) throw answer
        return answer as LiveUpdate
    }
}

private class LiveTokenStore(private val token: String? = "token") : SessionStore {
    override suspend fun token() = token
    override suspend fun setToken(token: String?) = Unit
    override suspend fun pendingSignOuts() = emptySet<String>()
    override suspend fun endSession() = Unit
    override suspend fun forget(token: String) = Unit
}

@OptIn(ExperimentalCoroutinesApi::class)
class LiveUpdatesViewModelTest {
    @Test
    fun pollsAtOnceThenEvery15Seconds() = runTest {
        val api = FakeLiveApi(LIVE)
        val viewModel = LiveUpdatesViewModel(api, LiveTokenStore())

        val job = launch { viewModel.poll("trip", 1) {} }
        runCurrent()
        assertEquals(listOf("trip" to 1), api.calls)
        assertEquals(LIVE, viewModel.update)

        advanceTimeBy(LIVE_POLL_MS - 1)
        runCurrent()
        assertEquals(1, api.calls.size) // not before 15 s
        advanceTimeBy(1)
        runCurrent()
        assertEquals(2, api.calls.size)
        advanceTimeBy(LIVE_POLL_MS * 2)
        runCurrent()
        assertEquals(4, api.calls.size)
        job.cancel()
    }

    @Test
    fun stopsWhenCancelled() = runTest {
        val api = FakeLiveApi(LIVE)
        val viewModel = LiveUpdatesViewModel(api, LiveTokenStore())

        val job = launch { viewModel.poll("trip", 0) {} }
        runCurrent()
        job.cancel()
        advanceTimeBy(LIVE_POLL_MS * 10)
        runCurrent()

        assertEquals(1, api.calls.size)
        assertEquals(LIVE, viewModel.update) // the last answer stays for when Navigation comes back
    }

    @Test
    fun aFailedRequestShowsScheduledTimesButKeepsTheAlerts() = runTest {
        val api = FakeLiveApi(LIVE.copy(legs = listOf()), IOException("offline"), HttpException(HTTP_INTERNAL_ERROR), LIVE)
        val viewModel = LiveUpdatesViewModel(api, LiveTokenStore())

        val job = launch { viewModel.poll("trip", 0) {} }
        runCurrent()
        advanceTimeBy(LIVE_POLL_MS)
        runCurrent()
        assertEquals(LIVE.copy(live = false, updatedAt = null), viewModel.update)

        advanceTimeBy(LIVE_POLL_MS)
        runCurrent()
        assertFalse(viewModel.update?.live ?: true) // a server error is the same, and polling carries on
        advanceTimeBy(LIVE_POLL_MS)
        runCurrent()
        assertEquals(LIVE, viewModel.update)
        job.cancel()
    }

    @Test
    fun aFailedFirstRequestShowsScheduledTimes() = runTest {
        val viewModel = LiveUpdatesViewModel(FakeLiveApi(IOException("offline")), LiveTokenStore())

        val job = launch { viewModel.poll("trip", 0) {} }
        runCurrent()

        assertEquals(LiveUpdate.NOT_LIVE, viewModel.update)
        job.cancel()
    }

    @Test
    fun anInvalidSessionSignsOutAndStops() = runTest {
        for (viewModel in listOf(
            LiveUpdatesViewModel(FakeLiveApi(UnauthorizedException()), LiveTokenStore()),
            LiveUpdatesViewModel(FakeLiveApi(LIVE), LiveTokenStore(token = null)),
        )) {
            var signedOut = false

            viewModel.poll("trip", 0) { signedOut = true } // returns instead of looping

            assertTrue(signedOut)
        }
    }

    @Test
    fun aTripThatEndedElsewhereStopsPolling() = runTest {
        for (code in listOf(HTTP_CONFLICT, HTTP_NOT_FOUND)) {
            val api = FakeLiveApi(HttpException(code))
            val viewModel = LiveUpdatesViewModel(api, LiveTokenStore())

            viewModel.poll("trip", 0) {} // returns instead of looping

            assertNull(viewModel.update)
            assertEquals(1, api.calls.size)
        }
    }

    @Test
    fun aNewLegKeepsTheUpdateButAnotherTripStartsEmpty() = runTest {
        lateinit var viewModel: LiveUpdatesViewModel
        val shownAtRequest = mutableListOf<Pair<String, LiveUpdate?>>()
        val api = object : LiveUpdateApi {
            override suspend fun getLiveUpdate(sessionToken: String, tripId: String, fromLeg: Int): LiveUpdate {
                shownAtRequest.add("$tripId/$fromLeg" to viewModel.update)
                return LIVE
            }
        }
        viewModel = LiveUpdatesViewModel(api, LiveTokenStore())

        for ((trip, leg) in listOf("first" to 0, "first" to 1, "second" to 0)) {
            val job = launch { viewModel.poll(trip, leg) {} } // Navigation restarts polling on each new leg
            runCurrent()
            job.cancel()
        }

        // a new leg of the same trip keeps showing the last update while it asks; another trip's never shows
        assertEquals(listOf("first/0" to null, "first/1" to LIVE, "second/0" to null), shownAtRequest)
        viewModel.reset()
        assertNull(viewModel.update)
    }
}
