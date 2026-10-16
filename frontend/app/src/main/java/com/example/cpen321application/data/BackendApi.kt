package com.example.cpen321application.data

import com.example.cpen321application.BuildConfig
import java.io.IOException
import java.net.HttpURLConnection
import java.net.HttpURLConnection.HTTP_NO_CONTENT
import java.net.HttpURLConnection.HTTP_OK
import java.net.HttpURLConnection.HTTP_UNAUTHORIZED
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject

/** Thrown when the backend responds 401, meaning the token or session is not valid. */
class UnauthorizedException : IOException("Unauthorized")

/** The signed-in user's account, as returned by the backend. */
data class User(
    val id: String,
    val email: String,
    val name: String,
    val photoUrl: String?,
    val profileComplete: Boolean, // whether the commute questionnaire has been submitted
)

/** A new session from signing in. */
data class SignInResponse(val sessionToken: String, val user: User)

/**
 * The backend's auth endpoints.
 *
 * Every call throws [UnauthorizedException] on a 401 and [IOException] on any
 * other failure, including no network and a malformed response.
 */
interface AuthApi {
    /** Trades a Google ID token for a session, creating the account on first sign-in. */
    suspend fun signIn(idToken: String): SignInResponse

    /** Fetches the account a session belongs to. */
    suspend fun getMe(sessionToken: String): User

    /** Ends one session, leaving the user's other devices signed in. */
    suspend fun signOut(sessionToken: String)
}

/** [AuthApi] over HTTP. */
object BackendApi : AuthApi {
    private const val TIMEOUT_MS = 5_000
    private val baseUrl = BuildConfig.API_BASE_URL.trimEnd('/')

    override suspend fun signIn(idToken: String) =
        request("POST", "/api/auth/google", body = JSONObject().put("idToken", idToken)) {
            SignInResponse(it.getString("sessionToken"), parseUser(it.getJSONObject("user")))
        }

    override suspend fun getMe(sessionToken: String) =
        request("GET", "/api/users/me", sessionToken) { parseUser(it.getJSONObject("user")) }

    override suspend fun signOut(sessionToken: String) =
        request("POST", "/api/auth/sign-out", sessionToken) {}

    private fun parseUser(json: JSONObject) = User(
        id = json.getString("id"),
        email = json.getString("email"),
        name = json.getString("name"),
        photoUrl = if (json.isNull("photoUrl")) null else json.getString("photoUrl"),
        profileComplete = json.getBoolean("profileComplete"),
    )

    // parses inside the try so a malformed body (e.g. a captive portal page) becomes an IOException
    private suspend fun <T> request(
        method: String,
        path: String,
        sessionToken: String? = null,
        body: JSONObject? = null,
        parse: (JSONObject) -> T,
    ): T = withContext(Dispatchers.IO) {
        val connection = URL(baseUrl + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            sessionToken?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            body?.let {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { out -> out.write(it.toString().toByteArray()) }
            }

            when (val code = connection.responseCode) {
                HTTP_OK, HTTP_NO_CONTENT -> {
                    val text = connection.inputStream.bufferedReader().use { it.readText() }
                    parse(JSONObject(text.ifEmpty { "{}" })) // a 204 has no body
                }
                else -> throw if (code == HTTP_UNAUTHORIZED) UnauthorizedException() else IOException("HTTP $code")
            }
        } catch (e: JSONException) {
            throw IOException("Malformed response", e)
        } finally {
            connection.disconnect()
        }
    }
}
