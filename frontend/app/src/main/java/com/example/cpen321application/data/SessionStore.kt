package com.example.cpen321application.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first

/**
 * Keeps the session token on the device so the user stays signed in.
 *
 * Signing out moves the token to a pending list instead of deleting it, so a
 * sign-out made offline can still end the server session later. A token is only
 * dropped once the server confirms its session is gone.
 */
interface SessionStore {
    /** The current session token, or `null` if signed out. */
    suspend fun token(): String?

    /** Saves a new session token, or clears it with `null`. */
    suspend fun setToken(token: String?)

    /** Tokens whose server session still has to be ended. */
    suspend fun pendingSignOuts(): Set<String>

    /** Signs out on the device by moving the current token to the pending list in one write. */
    suspend fun endSession()

    /** Drops a pending token once its server session is gone. */
    suspend fun forget(token: String)
}

private val Context.dataStore by preferencesDataStore("session") // excluded from backups in res/xml
private val TOKEN = stringPreferencesKey("token")
private val PENDING_SIGN_OUTS = stringSetPreferencesKey("pendingSignOuts")

/** [SessionStore] backed by DataStore. */
class DataStoreSessionStore(private val context: Context) : SessionStore {
    override suspend fun token() = context.dataStore.data.first()[TOKEN]

    override suspend fun setToken(token: String?) {
        context.dataStore.edit { if (token == null) it.remove(TOKEN) else it[TOKEN] = token }
    }

    override suspend fun pendingSignOuts() = context.dataStore.data.first()[PENDING_SIGN_OUTS].orEmpty()

    override suspend fun endSession() {
        context.dataStore.edit { prefs ->
            prefs[TOKEN]?.let { token ->
                prefs.remove(TOKEN)
                prefs[PENDING_SIGN_OUTS] = prefs[PENDING_SIGN_OUTS].orEmpty() + token
            }
        }
    }

    override suspend fun forget(token: String) {
        context.dataStore.edit { it[PENDING_SIGN_OUTS] = it[PENDING_SIGN_OUTS].orEmpty() - token }
    }
}
