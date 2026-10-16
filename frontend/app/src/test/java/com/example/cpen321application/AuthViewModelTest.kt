package com.example.cpen321application

import androidx.credentials.exceptions.GetCredentialCancellationException
import com.example.cpen321application.data.AuthApi
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.SignInResponse
import com.example.cpen321application.data.UnauthorizedException
import com.example.cpen321application.data.User
import com.example.cpen321application.ui.AppState
import com.example.cpen321application.ui.AuthViewModel
import com.example.cpen321application.ui.SIGN_IN_FAILED
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private fun user(profileComplete: Boolean) = User("1", "a@b.c", "Ada", null, profileComplete)

/** In-memory backend. Set [offline] to fail every call, or [user] to `null` to reject every session. */
private class FakeApi : AuthApi {
    var offline = false
    var user: User? = user(profileComplete = true)
    val sessions = mutableSetOf("old") // server sessions that are still active

    override suspend fun signIn(idToken: String): SignInResponse {
        if (offline) throw IOException()
        sessions += "new"
        return SignInResponse("new", user ?: throw UnauthorizedException())
    }

    override suspend fun getMe(sessionToken: String): User {
        if (offline) throw IOException()
        return user?.takeIf { sessionToken in sessions } ?: throw UnauthorizedException()
    }

    override suspend fun signOut(sessionToken: String) {
        if (offline) throw IOException()
        if (!sessions.remove(sessionToken)) throw UnauthorizedException()
    }
}

private class FakeStore(var token: String?) : SessionStore {
    val pending = mutableSetOf<String>()
    override suspend fun token() = token
    override suspend fun setToken(token: String?) { this.token = token }
    override suspend fun pendingSignOuts() = pending.toSet()
    override suspend fun endSession() {
        token?.let { pending += it }
        token = null
    }
    override suspend fun forget(token: String) { pending -= token }
}

@OptIn(ExperimentalCoroutinesApi::class)
class AuthViewModelTest {
    private val api = FakeApi()
    private var googleForgotten = false

    private fun viewModel(store: FakeStore) = AuthViewModel(api, store) { googleForgotten = true }

    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun noTokenShowsSignIn() {
        assertEquals(AppState.SignIn, viewModel(FakeStore(null)).state)
    }

    @Test
    fun profileCompleteChoosesMainOrQuestionnaire() {
        assertEquals(AppState.Main(user(true)), viewModel(FakeStore("old")).state)
        api.user = user(false)
        assertEquals(AppState.Questionnaire(user(false)), viewModel(FakeStore("old")).state)
    }

    @Test
    fun rejectedSessionClearsTokenAndShowsSignIn() {
        val store = FakeStore("fake")
        assertEquals(AppState.SignIn, viewModel(store).state)
        assertNull(store.token)
    }

    @Test
    fun offlineLaunchKeepsTokenAndRetryRecovers() {
        api.offline = true
        val store = FakeStore("old")
        val viewModel = viewModel(store)
        assertEquals(AppState.Offline, viewModel.state)
        assertEquals("old", store.token)

        api.offline = false
        viewModel.load()
        assertEquals(AppState.Main(user(true)), viewModel.state)
    }

    @Test
    fun signInSavesTokenAndRoutes() {
        val store = FakeStore(null)
        val viewModel = viewModel(store)
        viewModel.signIn { "google" }
        assertEquals("new", store.token)
        assertEquals(AppState.Main(user(true)), viewModel.state)
    }

    @Test
    fun closingGooglePickerShowsNoError() {
        val viewModel = viewModel(FakeStore(null))
        viewModel.signIn { throw GetCredentialCancellationException() }
        assertEquals(AppState.SignIn, viewModel.state)
        assertNull(viewModel.signInError)
    }

    @Test
    fun signInWithoutNetworkShowsError() {
        api.offline = true
        val viewModel = viewModel(FakeStore(null))
        viewModel.signIn { "google" }
        assertEquals(AppState.SignIn, viewModel.state)
        assertEquals(SIGN_IN_FAILED, viewModel.signInError)
    }

    @Test
    fun signOutEndsServerSessionAndForgetsGoogleAccount() {
        val store = FakeStore("old")
        val viewModel = viewModel(store)
        viewModel.signOut()
        assertEquals(AppState.SignIn, viewModel.state)
        assertTrue(api.sessions.isEmpty() && store.pending.isEmpty() && store.token == null && googleForgotten)
    }

    @Test
    fun offlineSignOutEndsServerSessionOnNextLaunch() {
        val store = FakeStore("old")
        val viewModel = viewModel(store)
        api.offline = true
        viewModel.signOut()
        assertEquals(AppState.SignIn, viewModel.state)
        assertTrue(store.token == null && store.pending == setOf("old") && "old" in api.sessions)

        api.offline = false
        viewModel(store) // next launch
        assertTrue(store.pending.isEmpty() && api.sessions.isEmpty())
    }
}
