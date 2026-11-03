package com.example.cpen321application.data

import com.google.android.gms.maps.model.LatLng
import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject

/*
 * The Planner's API contract (POST /api/routes/plan, see issue #70), as the app sees it.
 * Money is in whole cents, distances in metres, durations in seconds, and times are
 * Instants (sent and received as ISO 8601 UTC strings).
 */

/** How a leg is travelled. A trip may only ask for [DRIVE] and [TRANSIT]; legs can also be [WALK]. */
enum class TripMode { DRIVE, TRANSIT, WALK }

/** Which of the 3 routes this is. */
enum class RouteLabel { CHEAPEST, FASTEST, BALANCED }

/** Something the user should fix for better results. Shown as a banner, never instead of routes. */
enum class PlanWarning { NO_PARKING_SPOTS, GAS_PRICE_MISSING, VEHICLE_MISSING }

/** A place on a trip, in the backend's `{ label, lat, lng, placeId }` shape. */
data class PlanPlace(val label: String, val location: LatLng, val placeId: String? = null)

/** What the user asked for. A `null` [arriveBy] means leave now; a `null` [costVsTime] uses their saved preference. */
data class PlanRequest(
    val origin: PlanPlace,
    val destination: PlanPlace,
    val arriveBy: Instant?,
    val modes: Set<TripMode>,
    val costVsTime: Int? = null, // 0 = cheapest only, 100 = fastest only
    val maxWalkMinutes: Int? = null, // longest single walk allowed; null uses the saved preference
)

/** Default modes for a trip a user isn't sure about yet; the backend's default too. */
val DEFAULT_TRIP_MODES = setOf(TripMode.DRIVE, TripMode.TRANSIT)
const val DEFAULT_MAX_WALK_MINUTES = 10
const val DEFAULT_COST_VS_TIME = 50

/** The user's saved Planner defaults. */
data class PlanningPreferences(
    val costVsTime: Int,
    val defaultModes: Set<TripMode>,
    val maxWalkMinutes: Int,
)

/** What a new account starts with, and what Planning uses when the saved ones can't be loaded. */
val DEFAULT_PLANNING_PREFERENCES = PlanningPreferences(DEFAULT_COST_VS_TIME, DEFAULT_TRIP_MODES, DEFAULT_MAX_WALK_MINUTES)

/** Where a route's money goes. */
data class CostBreakdown(val fuelCents: Int, val parkingCents: Int, val fareCents: Int)

/**
 * A bus or train a transit leg rides. [colour] is a hex string like "#0060A9", or `null` if Google gives none.
 * [shortName] is what the line is signed as, like "99" or "R4", or `null` when it has none (SkyTrain lines).
 */
data class TransitLine(
    val name: String,
    val vehicle: String,
    val colour: String?,
    val headsign: String,
    val departureStop: String,
    val arrivalStop: String,
    val stopCount: Int,
    val shortName: String? = null,
) {
    /** The name for badges: the short name when there is one, like Google Maps. */
    val badgeName: String get() = shortName ?: name
}

/** One leg of a route. [polyline] is in Google's encoded polyline format (see `decodePolyline`). */
data class PlanLeg(
    val mode: TripMode,
    val from: PlanPlace,
    val to: PlanPlace,
    val departAt: Instant,
    val arriveAt: Instant,
    val durationSeconds: Int,
    val distanceMeters: Int,
    val costCents: Int,
    val polyline: String,
    val transitLines: List<TransitLine>,
)

/** One of the Planner's suggested routes. */
data class RouteOption(
    val label: RouteLabel,
    val leaveAt: Instant,
    val arriveAt: Instant,
    val lateByMinutes: Int, // 0 when it meets the arrive-by time
    val totalDurationSeconds: Int,
    val totalDistanceMeters: Int,
    val totalCostCents: Int,
    val costBreakdown: CostBreakdown,
    val costEstimated: Boolean, // true when part of the cost used a default, shown as "(est.)"
    val baselineDriveCostCents: Int?, // what driving the whole way would cost, for "cheaper than driving"
    val transferPoints: List<PlanPlace>, // the parking spot for Drive → Transit, else empty
    val transfers: Int,
    val legs: List<PlanLeg>,
)

/** The Planner's answer: up to 3 routes, ordered Cheapest, Fastest, Balanced. */
data class TripPlan(val options: List<RouteOption>, val warnings: List<PlanWarning>)

/**
 * The backend's trip planning endpoint. Throws [UnauthorizedException] on a 401,
 * [HttpException] when the backend is reached but fails (503 when it couldn't reach
 * Google), and [java.io.IOException] for no network or a malformed response.
 */
interface PlannerApi {
    suspend fun planTrip(sessionToken: String?, trip: PlanRequest): TripPlan
}

/** Reads and saves the user's [PlanningPreferences]. Throws like [PlannerApi]. */
interface PlanningPreferencesApi {
    suspend fun getPlanningPreferences(sessionToken: String?): PlanningPreferences

    suspend fun savePlanningPreferences(sessionToken: String?, preferences: PlanningPreferences): PlanningPreferences
}

// ---- JSON, used by BackendApi.planTrip ----

private fun PlanPlace.toJson() = JSONObject()
    .put("label", label)
    .put("lat", location.latitude)
    .put("lng", location.longitude)
    .put("placeId", placeId ?: JSONObject.NULL)

/** The request body for POST /api/routes/plan. */
internal fun PlanRequest.toJson(): JSONObject {
    val json = JSONObject()
        .put("origin", origin.toJson())
        .put("destination", destination.toJson())
        .put("arriveBy", arriveBy?.toString() ?: JSONObject.NULL) // Instant.toString() is ISO 8601 UTC
        .put("modes", JSONArray(modes.map { it.name }))
    costVsTime?.let { json.put("costVsTime", it) } // left out so the backend uses the saved preference
    maxWalkMinutes?.let { json.put("maxWalkMinutes", it) }
    return json
}

private fun JSONObject.toPlace() = PlanPlace(
    label = getString("label"),
    location = LatLng(getDouble("lat"), getDouble("lng")),
    placeId = if (isNull("placeId")) null else getString("placeId"),
)

private fun JSONObject.toTransitLine() = TransitLine(
    name = getString("name"),
    vehicle = getString("vehicle"),
    colour = if (isNull("colour")) null else optString("colour").ifEmpty { null },
    headsign = getString("headsign"),
    departureStop = getString("departureStop"),
    arrivalStop = getString("arrivalStop"),
    stopCount = getInt("stopCount"),
    shortName = if (isNull("shortName")) null else optString("shortName").ifEmpty { null },
)

private fun JSONObject.toLeg() = PlanLeg(
    mode = TripMode.valueOf(getString("mode")),
    from = getJSONObject("from").toPlace(),
    to = getJSONObject("to").toPlace(),
    departAt = Instant.parse(getString("departAt")),
    arriveAt = Instant.parse(getString("arriveAt")),
    durationSeconds = getInt("durationSeconds"),
    distanceMeters = getInt("distanceMeters"),
    costCents = getInt("costCents"),
    polyline = getString("polyline"),
    transitLines = optJSONArray("transitLines").objects().map { it.toTransitLine() },
)

private fun JSONObject.toRouteOption(): RouteOption {
    val costs = getJSONObject("costBreakdown")
    return RouteOption(
        label = RouteLabel.valueOf(getString("label")),
        leaveAt = Instant.parse(getString("leaveAt")),
        arriveAt = Instant.parse(getString("arriveAt")),
        lateByMinutes = getInt("lateByMinutes"),
        totalDurationSeconds = getInt("totalDurationSeconds"),
        totalDistanceMeters = getInt("totalDistanceMeters"),
        totalCostCents = getInt("totalCostCents"),
        costBreakdown = CostBreakdown(costs.getInt("fuelCents"), costs.getInt("parkingCents"), costs.getInt("fareCents")),
        costEstimated = getBoolean("costEstimated"),
        baselineDriveCostCents = if (isNull("baselineDriveCostCents")) null else getInt("baselineDriveCostCents"),
        transferPoints = getJSONArray("transferPoints").objects().map { it.toPlace() },
        transfers = getInt("transfers"),
        legs = getJSONArray("legs").objects().map { it.toLeg() },
    )
}

/** The body for PUT /api/users/me/planning-preferences. */
internal fun PlanningPreferences.toJson(): JSONObject = JSONObject()
    .put("costVsTime", costVsTime)
    .put("defaultModes", JSONArray(TripMode.entries.filter { it in defaultModes }.map { it.name }))
    .put("maxWalkMinutes", maxWalkMinutes)

/**
 * Reads the Planner defaults from an account (`GET /api/users/me`'s `user`). Fields an older
 * backend doesn't send fall back to the defaults, and modes this app doesn't know are skipped.
 */
internal fun JSONObject.toPlanningPreferences(): PlanningPreferences {
    val modes = optJSONArray("defaultModes").strings().mapNotNull { name -> TripMode.entries.find { it.name == name } }
    return PlanningPreferences(
        costVsTime = optInt("costVsTime", DEFAULT_COST_VS_TIME),
        defaultModes = modes.toSet().ifEmpty { DEFAULT_TRIP_MODES },
        maxWalkMinutes = optInt("maxWalkMinutes", DEFAULT_MAX_WALK_MINUTES),
    )
}

/** Reads a 200 response from POST /api/routes/plan. Warnings this app doesn't know yet are skipped. */
internal fun JSONObject.toTripPlan() = TripPlan(
    options = getJSONArray("options").objects().map { it.toRouteOption() },
    warnings = optJSONArray("warnings").strings().mapNotNull { name -> PlanWarning.entries.find { it.name == name } },
)

private fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else List(length()) { getJSONObject(it) }

private fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else List(length()) { getString(it) }
