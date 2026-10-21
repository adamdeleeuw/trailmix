package com.example.cpen321application.data

import com.example.cpen321application.BuildConfig
import com.google.android.gms.maps.model.LatLng
import java.io.IOException
import java.net.HttpURLConnection
import java.net.HttpURLConnection.HTTP_NO_CONTENT
import java.net.HttpURLConnection.HTTP_OK
import java.net.HttpURLConnection.HTTP_UNAUTHORIZED
import java.net.URL
import java.net.URLEncoder
import java.time.Instant
import java.time.format.DateTimeParseException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** Thrown when the backend responds 401, meaning the token or session is not valid. */
class UnauthorizedException : IOException("Unauthorized")

/** Thrown when the backend responds with an error status other than 401, so it was reached but failed. */
class HttpException(val code: Int) : IOException("HTTP $code")

/**
 * The signed-in user's account, as returned by the backend.
 *
 * The commute fields are `null` until the questionnaire is submitted, and a `null`
 * [vehicle] or [transit] after that means the user doesn't drive or take transit.
 */
data class User(
    val id: String,
    val email: String,
    val name: String,
    val photoUrl: String?,
    val profileComplete: Boolean, // whether the commute questionnaire has been submitted
    val timezone: String? = null, // IANA name, e.g. "America/Vancouver"
    val vehicle: Vehicle? = null,
    val transit: Transit? = null,
    val lastGasPrice: GasPrice? = null, // null until a price is saved
)

/** A place recorded in a trip. */
data class TripPlace(val label: String)

/** A leg of a saved trip. */
data class TripLeg(val mode: String, val durationSeconds: Int)

/** A saved commute returned by the backend. */
data class Trip(
    val id: String,
    val origin: TripPlace,
    val destination: TripPlace,
    val legs: List<TripLeg>,
    val totalDurationSeconds: Int,
    val totalCostCents: Int,
    val tripDate: String,
)

/** The last gas price a user saved, and when the backend saved it. */
data class GasPrice(val centsPerLitre: Double, val savedAt: Instant)

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

/** One leg of a commute. [polyline] is in Google's encoded polyline format (see `decodePolyline`). */
data class RouteLeg(
    val mode: String, // "DRIVE" or "TRANSIT"
    val durationSeconds: Int,
    val distanceMeters: Int,
    val polyline: String,
)

/** A planned chained commute: the drive leg, then the transit leg. */
data class ChainedRoute(val legs: List<RouteLeg>, val totalDurationSeconds: Int)

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

/** The signed-in user's saved-trip endpoints. Fails the same way as [ProfileApi]. */
interface TripApi {
    /** Fetches the signed-in user's trip history, newest first. */
    suspend fun getTripHistory(sessionToken: String): List<Trip>

    /** Replaces the user's demo trips with a fresh set, and returns the whole history, newest first. */
    suspend fun seedDemoTrips(sessionToken: String): List<Trip>
}

/** The backend's account endpoints used by the Profile tab. Fails the same way as [ProfileApi]. */
interface AccountApi {
    /** Saves the user's last gas price, stamped with the current time, and returns the updated account. */
    suspend fun saveGasPrice(sessionToken: String, centsPerLitre: Double): User

    /** Permanently deletes the account and ends its sessions on every device. */
    suspend fun deleteAccount(sessionToken: String)
}

/** The backend's route planning endpoints. Throws like [AuthApi], and [HttpException] with code 404 when there is no route. */
interface RoutesApi {
    /** Plans driving from [start] to [split], then transit from [split] to [destination]. */
    suspend fun planChainedRoute(sessionToken: String?, start: LatLng, split: LatLng, destination: LatLng): ChainedRoute
}

/** [AuthApi], [ProfileApi], [AccountApi], [TripApi] and [RoutesApi] over HTTP. */
object BackendApi : AuthApi, ProfileApi, AccountApi, TripApi, RoutesApi {
    private const val TIMEOUT_MS = 10_000 // route planning waits on two Google requests
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

    override suspend fun getTripHistory(sessionToken: String) =
        request("GET", "/api/users/me/trips", sessionToken) { it.toTrips() }

    override suspend fun seedDemoTrips(sessionToken: String) =
        request("POST", "/api/users/me/trips/seed", sessionToken) { it.toTrips() }

    override suspend fun saveGasPrice(sessionToken: String, centsPerLitre: Double) =
        request("PUT", "/api/users/me/gas-price", sessionToken, JSONObject().put("centsPerLitre", centsPerLitre)) {
            parseUser(it.getJSONObject("user"))
        }

    override suspend fun deleteAccount(sessionToken: String) =
        request("DELETE", "/api/users/me", sessionToken) {}

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

    override suspend fun planChainedRoute(sessionToken: String?, start: LatLng, split: LatLng, destination: LatLng) =
        request(
            "POST",
            "/api/routes/chained",
            sessionToken,
            body = JSONObject().put("start", start.toJson()).put("split", split.toJson()).put("destination", destination.toJson()),
        ) {
            ChainedRoute(
                legs = parseLegs(it.getJSONArray("legs")),
                totalDurationSeconds = it.getInt("totalDurationSeconds"),
            )
        }

    private fun LatLng.toJson() = JSONObject().put("lat", latitude).put("lng", longitude)

    private fun parseLegs(json: JSONArray) = (0 until json.length()).map { i ->
        val leg = json.getJSONObject(i)
        RouteLeg(
            mode = leg.getString("mode"),
            durationSeconds = leg.getInt("durationSeconds"),
            distanceMeters = leg.getInt("distanceMeters"),
            polyline = leg.getString("polyline"),
        )
    }

    private fun parseUser(json: JSONObject) = User(
        id = json.getString("id"),
        email = json.getString("email"),
        name = json.getString("name"),
        photoUrl = json.stringOrNull("photoUrl"),
        profileComplete = json.getBoolean("profileComplete"),
        timezone = json.stringOrNull("timezone"),
        vehicle = json.objectOrNull("vehicle")?.let {
            Vehicle(
                make = it.getString("make"),
                model = it.getString("model"),
                colour = it.stringOrNull("colour"),
                litresPer100km = it.getDouble("litresPer100km"),
            )
        },
        transit = json.objectOrNull("transit")?.let {
            Transit(FareType.valueOf(it.getString("fareType")), it.intOrNull("monthlyPassZones"))
        },
        lastGasPrice = json.objectOrNull("lastGasPrice")?.let {
            GasPrice(it.getDouble("centsPerLitre"), Instant.parse(it.getString("savedAt")))
        },
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
        } catch (e: IllegalArgumentException) {
            throw IOException("Unknown fare type", e) // FareType.valueOf on a value this app doesn't know
        } catch (e: DateTimeParseException) {
            throw IOException("Malformed date", e)
        } finally {
            connection.disconnect()
        }
    }
}

// the { trips } body of GET /api/users/me/trips and POST /api/users/me/trips/seed
private fun JSONObject.toTrips(): List<Trip> {
    val trips = getJSONArray("trips")
    return List(trips.length()) { trips.getJSONObject(it).toTrip() }
}

// a trip from GET /api/users/me/trips, keeping only the fields the History tab shows
private fun JSONObject.toTrip(): Trip {
    val legs = getJSONArray("legs")
    return Trip(
        id = getString("id"),
        origin = TripPlace(getJSONObject("origin").getString("label")),
        destination = TripPlace(getJSONObject("destination").getString("label")),
        legs = List(legs.length()) { index ->
            val leg = legs.getJSONObject(index)
            TripLeg(leg.getString("mode"), leg.getInt("durationSeconds"))
        },
        totalDurationSeconds = getInt("totalDurationSeconds"),
        totalCostCents = getInt("totalCostCents"),
        tripDate = getString("tripDate"),
    )
}

private fun JSONObject.stringOrNull(key: String) = if (isNull(key)) null else getString(key)

private fun JSONObject.intOrNull(key: String) = if (isNull(key)) null else getInt(key)

private fun JSONObject.objectOrNull(key: String) = if (isNull(key)) null else getJSONObject(key)
