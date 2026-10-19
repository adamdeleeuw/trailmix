package com.example.cpen321application.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.cpen321application.data.AuthApi
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.UnauthorizedException
import com.example.cpen321application.data.User
import java.io.IOException
import kotlinx.coroutines.launch

const val SIGN_IN_FAILED = "Sign-in failed. Check your connection and try again."

/**
 * Which screen the app shows. Each one is the only screen, so Back exits the app,
 * except on the questionnaire, where it asks before signing out.
 */
sealed interface AppState {
    data object Loading : AppState
    data object SignIn : AppState
    data object Offline : AppState // signed in, but the account couldn't be loaded
    data class Questionnaire(val user: User) : AppState
    data class Main(val user: User) : AppState
}

/**
 * Owns the session and decides which screen the app shows.
 *
 * The user is only signed out by signing out or when the server rejects the
 * session. If the server can't be reached they stay signed in on [AppState.Offline].
 *
 * @param forgetGoogleAccount Makes Android forget the Google account, so the picker shows on the next sign-in.
 */
class AuthViewModel(
    private val api: AuthApi,
    private val store: SessionStore,
    private val forgetGoogleAccount: suspend () -> Unit,
) : ViewModel() {
    var state by mutableStateOf<AppState>(AppState.Loading)
        private set

    var isSigningIn by mutableStateOf(false)
        private set

    var signInError by mutableStateOf<String?>(null)
        private set

    init {
        load()
    }

    /** Routes from the stored session. Also what the Retry button calls. */
    fun load() {
        state = AppState.Loading
        endPendingSessions()
        viewModelScope.launch {
            val token = store.token()
            state = if (token == null) AppState.SignIn else try {
                signedIn(api.getMe(token))
            } catch (e: UnauthorizedException) {
                store.setToken(null)
                AppState.SignIn
            } catch (e: IOException) {
                AppState.Offline
            }
        }
    }

    /**
     * Signs in with Google and routes the user. Closing the picker is not an error.
     *
     * @param getIdToken Shows the Google account picker and returns the chosen account's ID token.
     */
    fun signIn(getIdToken: suspend () -> String) {
        if (isSigningIn) return
        isSigningIn = true
        signInError = null
        endPendingSessions()
        viewModelScope.launch {
            try {
                val response = api.signIn(getIdToken())
                store.setToken(response.sessionToken)
                state = signedIn(response.user)
            } catch (e: GetCredentialException) {
                if (e !is GetCredentialCancellationException) signInError = SIGN_IN_FAILED
            } catch (e: IOException) {
                signInError = SIGN_IN_FAILED
            } finally {
                isSigningIn = false
            }
        }
    }

    /** Signs out right away, even offline. The server session ends now or on the next launch or sign-in. */
    fun signOut() {
        viewModelScope.launch {
            store.endSession()
            state = AppState.SignIn
            endPendingSessions()
            forgetGoogleAccount()
        }
    }

    /** Moves to Main once the questionnaire is saved. Main replaces it, so Back can't return to it. */
    fun profileSaved(user: User) {
        state = AppState.Main(user)
    }

    private fun signedIn(user: User) = if (user.profileComplete) AppState.Main(user) else AppState.Questionnaire(user)

    // a 401 means the session is already gone, and a network failure keeps the token for next time
    private fun endPendingSessions() = viewModelScope.launch {
        for (token in store.pendingSignOuts()) {
            val ended = try {
                api.signOut(token)
                true
            } catch (e: IOException) {
                e is UnauthorizedException
            }
            if (ended) store.forget(token)
        }
    }
}
