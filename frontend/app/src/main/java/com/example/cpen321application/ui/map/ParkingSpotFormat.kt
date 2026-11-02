package com.example.cpen321application.ui.map

import com.example.cpen321application.data.ParkingSpotDetails
import com.example.cpen321application.data.RateUnit
import com.google.android.gms.maps.model.LatLng
import java.util.Locale
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** The most parking spots a user can save, the same limit as the backend. */
const val MAX_PARKING_SPOTS = 20

/** The longest name a parking spot can have, the same limit as the backend. */
const val MAX_LABEL_LENGTH = 60

const val LABEL_REQUIRED = "Enter a name"
const val LABEL_TOO_LONG = "Use $MAX_LABEL_LENGTH characters or fewer"
const val COST_INVALID = "Enter a cost like 3 or 2.50, up to $999.99"
const val COST_UNKNOWN = "Cost unknown"

private const val CENTS_PER_DOLLAR = 100
private const val METRES_PER_KM = 1000
private const val EARTH_RADIUS_METRES = 6_371_000.0
private val COST_PATTERN = Regex("""^\d{1,3}(\.\d{0,2})?$""") // up to $999.99, at most two decimals

/** Checks a parking spot's name, ignoring spaces around it. Returns the error to show, or `null` if it's fine. */
fun labelError(label: String): String? = when {
    label.isBlank() -> LABEL_REQUIRED
    label.trim().length > MAX_LABEL_LENGTH -> LABEL_TOO_LONG
    else -> null
}

/** Checks a typed cost in dollars. Empty is fine, since it means the cost is unknown. */
fun costError(text: String): String? =
    if (text.isBlank() || COST_PATTERN.matches(text.trim())) null else COST_INVALID

/**
 * Converts a typed cost in dollars to whole cents, e.g. "3" to 300 and "2.5" to 250.
 *
 * @return The cents, or `null` if the field is empty or invalid (check [costError] first).
 */
fun costToCents(text: String): Int? {
    val trimmed = text.trim()
    if (!COST_PATTERN.matches(trimmed)) return null
    val dollars = trimmed.substringBefore('.').toInt()
    val cents = trimmed.substringAfter('.', missingDelimiterValue = "").padEnd(2, '0').toInt()
    return dollars * CENTS_PER_DOLLAR + cents
}

/** The text a saved cost starts as in the edit dialog, e.g. 250 as "2.50", or "" when unknown. */
fun centsToCostText(cents: Int?): String = cents?.let { dollars(it) }.orEmpty()

/** What a spot costs, e.g. "$3.00 per hour", or "Cost unknown". */
fun formatRate(details: ParkingSpotDetails): String {
    val cents = details.rateCents
    val unit = details.ratePer
    return if (cents == null || unit == null) COST_UNKNOWN else "$${dollars(cents)} per ${unitName(unit)}"
}

/** The spot's overnight rule as the sheet shows it. */
fun formatOvernight(overnightAllowed: Boolean): String =
    if (overnightAllowed) "Overnight parking allowed" else "No overnight parking"

/** The word for a rate unit in "per hour" and "per day". */
fun unitName(unit: RateUnit): String = when (unit) {
    RateUnit.HOUR -> "hour"
    RateUnit.DAY -> "day"
}

/** The straight-line (great-circle) distance between two points, in metres. */
fun distanceMetres(from: LatLng, to: LatLng): Double {
    val lat1 = Math.toRadians(from.latitude)
    val lat2 = Math.toRadians(to.latitude)
    val dLat = lat2 - lat1
    val dLng = Math.toRadians(to.longitude - from.longitude)
    val haversine = sin(dLat / 2).pow(2) + cos(lat1) * cos(lat2) * sin(dLng / 2).pow(2)
    return 2 * EARTH_RADIUS_METRES * asin(sqrt(haversine))
}

/** A distance as the sheet shows it, e.g. "350 m" under a kilometre and "2.4 km" above. */
fun formatDistance(metres: Double): String =
    if (metres < METRES_PER_KM) {
        "${metres.roundToInt()} m"
    } else {
        String.format(Locale.CANADA, "%.1f km", metres / METRES_PER_KM)
    }

private fun dollars(cents: Int) =
    String.format(Locale.CANADA, "%d.%02d", cents / CENTS_PER_DOLLAR, cents % CENTS_PER_DOLLAR)
