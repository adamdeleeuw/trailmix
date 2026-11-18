package com.example.cpen321application.data

import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject

/*
 * The live update message Navigation polls for (#87), as agreed in #85. This file is the app's only copy of it: the
 * classes and the JSON parsing are both here. The backend's is `backend/src/models/live-update.model.ts`. Change
 * both together.
 *
 * {
 *   "live": true,
 *   "updatedAt": "2026-11-18T17:02:30.000Z",
 *   "legs": [{ "legIndex": 1, "matched": true, "departAt": "…", "arriveAt": "…", "delaySeconds": 180, "cancelled": false }],
 *   "alerts": [{ "id": "733912", "header": "…", "description": "…", "effect": "DETOUR", "legIndexes": [1], "activeUntil": null }]
 * }
 */

/**
 * The live times of one transit leg.
 *
 * @property legIndex Which of the trip's legs it is.
 * @property matched Whether TransLink predicted the run this leg rides. When it didn't, the times are the scheduled ones.
 * @property delaySeconds How late the run leaves compared with the plan, negative when early, `null` unless [matched].
 * @property cancelled Whether TransLink cancelled the run (or it skips the boarding stop). The times are then the
 *   scheduled ones. Optional in the message, where missing means `false`.
 */
data class LiveLeg(
    val legIndex: Int,
    val matched: Boolean,
    val departAt: Instant?,
    val arriveAt: Instant?,
    val delaySeconds: Int?,
    val cancelled: Boolean = false,
)

/**
 * A TransLink service alert on some of the trip's transit legs.
 *
 * @property id Stays the same while the alert lasts.
 * @property effect GTFS-RT's name for what it does, like "DETOUR" or "NO_SERVICE".
 * @property activeUntil When it ends, or `null` for until further notice.
 */
data class LiveAlert(
    val id: String,
    val header: String,
    val description: String?,
    val effect: String,
    val legIndexes: List<Int>,
    val activeUntil: Instant?,
)

/**
 * Everything the backend knows live about an active trip.
 *
 * @property live `false` when TransLink's data couldn't be used, so the times are scheduled ones.
 * @property updatedAt When TransLink made the data, `null` when not [live].
 * @property legs Each transit leg from the rider's current leg on.
 * @property alerts Active alerts on those legs.
 */
data class LiveUpdate(
    val live: Boolean,
    val updatedAt: Instant?,
    val legs: List<LiveLeg>,
    val alerts: List<LiveAlert>,
) {
    companion object {
        /** What Navigation shows when the backend can't be reached: scheduled times, nothing live. */
        val NOT_LIVE = LiveUpdate(live = false, updatedAt = null, legs = emptyList(), alerts = emptyList())
    }
}

/** The backend's live update endpoint. Fails the same way as [ProfileApi]. */
interface LiveUpdateApi {
    /**
     * Fetches the live update for the user's active trip [tripId], from leg [fromLeg] on.
     * Throws a 409 [HttpException] when the trip is no longer active, and a 404 when it's gone.
     */
    suspend fun getLiveUpdate(sessionToken: String, tripId: String, fromLeg: Int): LiveUpdate
}

/** Parses the body of `GET /api/users/me/trips/:id/live`. */
internal fun JSONObject.toLiveUpdate(): LiveUpdate {
    val legs = getJSONArray("legs")
    val alerts = getJSONArray("alerts")
    return LiveUpdate(
        live = getBoolean("live"),
        updatedAt = instantOrNull("updatedAt"),
        legs = List(legs.length()) { legs.getJSONObject(it).toLiveLeg() },
        alerts = List(alerts.length()) { alerts.getJSONObject(it).toLiveAlert() },
    )
}

private fun JSONObject.toLiveLeg() = LiveLeg(
    legIndex = getInt("legIndex"),
    matched = getBoolean("matched"),
    departAt = instantOrNull("departAt"),
    arriveAt = instantOrNull("arriveAt"),
    delaySeconds = if (isNull("delaySeconds")) null else getInt("delaySeconds"),
    cancelled = optBoolean("cancelled", false), // optional, so a backend without it still parses
)

private fun JSONObject.toLiveAlert() = LiveAlert(
    id = getString("id"),
    header = getString("header"),
    description = if (isNull("description")) null else getString("description"),
    effect = getString("effect"),
    legIndexes = getJSONArray("legIndexes").toInts(),
    activeUntil = instantOrNull("activeUntil"),
)

private fun JSONObject.instantOrNull(key: String): Instant? = if (isNull(key)) null else Instant.parse(getString(key))

private fun JSONArray.toInts() = List(length()) { getInt(it) }
