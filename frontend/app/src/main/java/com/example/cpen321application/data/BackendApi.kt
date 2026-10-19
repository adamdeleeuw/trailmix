package com.example.cpen321application.data

import com.example.cpen321application.BuildConfig
import java.io.IOException
import java.net.HttpURLConnection
import java.net.HttpURLConnection.HTTP_NO_CONTENT
import java.net.HttpURLConnection.HTTP_OK
import java.net.HttpURLConnection.HTTP_UNAUTHORIZED
import java.net.URL
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** Thrown when the backend responds 401, meaning the token or session is not valid. */
class UnauthorizedException : IOException("Unauthorized")

/** Thrown when the backend responds with an error status other than 401, so it was reached but failed. */
class HttpException(code: Int) : IOException("HTTP $code")

/** The signed-in user's account, as returned by the backend. */
data class User(
    val id: String,
    val email: String,
    val name: String,
    val photoUrl: String?,
    val profileComplete: Boolean, // whether the commute questionnaire has been submitted
)

/** How a user pays for transit. The names match the backend's `fareType` values. */
enum class FareType {
    ADULT_STORED_VALUE,
    CONCESSION_STORED_VALUE,
    CONTACTLESS,
    ADULT_MONTHLY_PASS,
    CONCESSION_MONTHLY_PASS,
    UPASS,
}

/** The car a user drives. */
data class Vehicle(val make: String, val model: String, val colour: String?, val litresPer100km: Double)

/** How a user pays for transit. [monthlyPassZones] is only set for [FareType.ADULT_MONTHLY_PASS]. */
data class Transit(val fareType: FareType, val monthlyPassZones: Int?)

/** The commute questionnaire's answers. A `null` vehicle or transit means the user doesn't drive or take transit. */
data class Profile(val timezone: String, val vehicle: Vehicle?, val transit: Transit?)

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

/**
 * The backend's commute profile endpoints. Fails the same way as [AuthApi], and
 * throws [HttpException] when the backend is reached but responds with an error.
 */
interface ProfileApi {
    /** Fetches every car make, sorted alphabetically. */
    suspend fun getMakes(sessionToken: String): List<String>

    /** Fetches the base models of one make, sorted alphabetically. */
    suspend fun getModels(sessionToken: String, make: String): List<String>

    /** Saves the questionnaire answers, replacing any saved ones, and returns the updated account. */
    suspend fun saveProfile(sessionToken: String, profile: Profile): User
}

/** [AuthApi] and [ProfileApi] over HTTP. */
object BackendApi : AuthApi, ProfileApi {
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

    override suspend fun getMakes(sessionToken: String) =
        request("GET", "/api/vehicles/makes", sessionToken) { it.getJSONArray("makes").toStrings() }

    override suspend fun getModels(sessionToken: String, make: String) =
        request("GET", "/api/vehicles/makes/${encodePathSegment(make)}/models", sessionToken) {
            it.getJSONArray("models").toStrings()
        }

    override suspend fun saveProfile(sessionToken: String, profile: Profile) =
        request("PUT", "/api/users/me/profile", sessionToken, profile.toJson()) { parseUser(it.getJSONObject("user")) }

    // URLEncoder is for query strings, so its "+" for a space is swapped for the path form
    private fun encodePathSegment(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    private fun JSONArray.toStrings() = List(length()) { getString(it) }

    // JSONObject.NULL because put(key, null) would drop the key, and the backend needs an explicit null
    private fun Profile.toJson() = JSONObject()
        .put("timezone", timezone)
        .put("vehicle", vehicle?.let {
            JSONObject()
                .put("make", it.make)
                .put("model", it.model)
                .put("colour", it.colour ?: JSONObject.NULL)
                .put("litresPer100km", it.litresPer100km)
        } ?: JSONObject.NULL)
        .put("transit", transit?.let {
            JSONObject()
                .put("fareType", it.fareType.name)
                .put("monthlyPassZones", it.monthlyPassZones ?: JSONObject.NULL)
        } ?: JSONObject.NULL)

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
                else -> throw if (code == HTTP_UNAUTHORIZED) UnauthorizedException() else HttpException(code)
            }
        } catch (e: JSONException) {
            throw IOException("Malformed response", e)
        } finally {
            connection.disconnect()
        }
    }
}
