package com.example.cpen321application.data

import com.example.cpen321application.BuildConfig
import com.google.android.gms.maps.model.LatLng
import java.io.IOException
import java.net.HttpURLConnection
import java.net.HttpURLConnection.HTTP_CREATED
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

/**
 * Thrown when the backend responds with an error status other than 401, so it was reached but failed.
 *
 * @property error The `error` message from the response body, or `null` if it had none.
 */
class HttpException(val code: Int, val error: String? = null) : IOException("HTTP $code")

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

/** What a parking spot's cost is charged per. The names match the backend's `ratePer` values. */
enum class RateUnit { HOUR, DAY }

/** What a user enters for a parking spot, and can edit later. */
data class ParkingSpotDetails(
    val label: String, // 1 to 60 characters
    val rateCents: Int?, // null when the cost is unknown
    val ratePer: RateUnit?, // null exactly when rateCents is null
    val overnightAllowed: Boolean,
)

/** A place the user parks before switching to transit, shown on the Map as a P marker. */
data class ParkingSpot(
    val id: String,
    val location: LatLng,
    val placeId: String?, // Google place ID when saved from search, null for a dropped pin
    val details: ParkingSpotDetails,
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

/**
 * The signed-in user's parking spot endpoints. Fails the same way as [ProfileApi]; a
 * 409 [HttpException] carries [PARKING_LIMIT_ERROR] or [PARKING_DUPLICATE_ERROR].
 */
interface ParkingSpotApi {
    /** Fetches the user's parking spots, newest first. */
    suspend fun getParkingSpots(sessionToken: String): List<ParkingSpot>

    /** Saves a new spot and returns it with its ID. */
    suspend fun saveParkingSpot(
        sessionToken: String,
        location: LatLng,
        placeId: String?,
        details: ParkingSpotDetails,
    ): ParkingSpot

    /** Changes a spot's name, cost and overnight rule, and returns the updated spot. */
    suspend fun updateParkingSpot(sessionToken: String, id: String, details: ParkingSpotDetails): ParkingSpot

    /** Deletes a spot. Throws [HttpException] with code 404 if the user has no such spot. */
    suspend fun deleteParkingSpot(sessionToken: String, id: String)
}

/** The backend's 409 error when the user already has 20 parking spots. */
const val PARKING_LIMIT_ERROR = "Parking spot limit reached"

/** The backend's 409 error when the user already saved this Google place. */
const val PARKING_DUPLICATE_ERROR = "Parking spot already saved"

/** [AuthApi], [ProfileApi], [AccountApi], [TripApi], [RoutesApi] and [ParkingSpotApi] over HTTP. */
object BackendApi : AuthApi, ProfileApi, AccountApi, TripApi, RoutesApi, ParkingSpotApi {
    private const val PARKING_SPOTS_PATH = "/api/users/me/parking-spots"

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

    override suspend fun saveGasPrice(sessionToken: String, centsPerLitre: Double) =
        request("PUT", "/api/users/me/gas-price", sessionToken, JSONObject().put("centsPerLitre", centsPerLitre)) {
            parseUser(it.getJSONObject("user"))
        }

    override suspend fun deleteAccount(sessionToken: String) =
        request("DELETE", "/api/users/me", sessionToken) {}

    override suspend fun getParkingSpots(sessionToken: String) =
        request("GET", PARKING_SPOTS_PATH, sessionToken) {
            val spots = it.getJSONArray("parkingSpots")
            List(spots.length()) { index -> spots.getJSONObject(index).toParkingSpot() }
        }

    override suspend fun saveParkingSpot(
        sessionToken: String,
        location: LatLng,
        placeId: String?,
        details: ParkingSpotDetails,
    ) = request(
        "POST",
        PARKING_SPOTS_PATH,
        sessionToken,
        details.toJson().put("location", location.toJson()).put("placeId", placeId ?: JSONObject.NULL),
    ) { it.getJSONObject("parkingSpot").toParkingSpot() }

    override suspend fun updateParkingSpot(sessionToken: String, id: String, details: ParkingSpotDetails) =
        request("PUT", "$PARKING_SPOTS_PATH/${encodePathSegment(id)}", sessionToken, details.toJson()) {
            it.getJSONObject("parkingSpot").toParkingSpot()
        }

    override suspend fun deleteParkingSpot(sessionToken: String, id: String) =
        request("DELETE", "$PARKING_SPOTS_PATH/${encodePathSegment(id)}", sessionToken) {}

    // JSONObject.NULL so an unknown cost is sent as an explicit null
    private fun ParkingSpotDetails.toJson() = JSONObject()
        .put("label", label)
        .put("rateCents", rateCents ?: JSONObject.NULL)
        .put("ratePer", ratePer?.name ?: JSONObject.NULL)
        .put("overnightAllowed", overnightAllowed)

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
                HTTP_OK, HTTP_CREATED, HTTP_NO_CONTENT -> {
                    val text = connection.inputStream.bufferedReader().use { it.readText() }
                    parse(JSONObject(text.ifEmpty { "{}" })) // a 204 has no body
                }
                HTTP_UNAUTHORIZED -> throw UnauthorizedException()
                else -> throw HttpException(code, connection.errorMessage())
            }
        } catch (e: JSONException) {
            throw IOException("Malformed response", e)
        } catch (e: IllegalArgumentException) {
            throw IOException("Unknown enum value", e) // FareType or RateUnit valueOf on a value this app doesn't know
        } catch (e: DateTimeParseException) {
            throw IOException("Malformed date", e)
        } finally {
            connection.disconnect()
        }
    }
}

// the `error` of an error response's { error } body, or null if there's none or it isn't JSON
private fun HttpURLConnection.errorMessage(): String? = try {
    errorStream?.bufferedReader()?.use { it.readText() }?.let { JSONObject(it).optString("error").ifEmpty { null } }
} catch (e: JSONException) {
    null
} catch (e: IOException) {
    null
}

// a spot from the parking spot endpoints
private fun JSONObject.toParkingSpot(): ParkingSpot {
    val location = getJSONObject("location")
    return ParkingSpot(
        id = getString("id"),
        location = LatLng(location.getDouble("lat"), location.getDouble("lng")),
        placeId = stringOrNull("placeId"),
        details = ParkingSpotDetails(
            label = getString("label"),
            rateCents = intOrNull("rateCents"),
            ratePer = stringOrNull("ratePer")?.let { RateUnit.valueOf(it) },
            overnightAllowed = getBoolean("overnightAllowed"),
        ),
    )
}

// the { trips } body of GET /api/users/me/trips
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
