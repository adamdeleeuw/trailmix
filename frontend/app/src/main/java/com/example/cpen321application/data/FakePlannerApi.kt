package com.example.cpen321application.data

import com.google.android.gms.maps.model.LatLng
import java.time.Duration
import java.time.Instant
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

private const val SECONDS_PER_MINUTE = 60
private const val FAKE_DELAY_MS = 800L // about as long as the real Planner takes
private const val EXPO_LINE_BLUE = "#0060A9"
private const val CANADA_LINE_TEAL = "#009AC8"
private const val DRIVE_ALL_THE_WAY_CENTS = 390 // fuel for the Fastest route, also the "cheaper than driving" baseline

/**
 * A deterministic stand-in for the Planner endpoint, used by tests that need sample routes.
 *
 * Always answers with the same 3 sample routes between the requested places:
 * - Cheapest: transit only, with one transfer, and a bus with no colour (to show the fallback)
 * - Fastest: drive the whole way (parking at the destination unknown, so "(est.)")
 * - Balanced: drive to a sample parking spot, then SkyTrain (Drive → Transit)
 *
 * Routes needing a mode the request turned off are left out, like the real Planner.
 * With an arrive-by time the routes are scheduled backward from it, otherwise they leave now.
 */
class FakePlannerApi(private val delayMs: Long = FAKE_DELAY_MS, private val clock: () -> Instant = Instant::now) : PlannerApi {

    override suspend fun planTrip(sessionToken: String?, trip: PlanRequest): TripPlan {
        delay(delayMs)
        val routes = listOf(cheapest(trip), fastest(trip), balanced(trip))
            .filter { route -> route.legs.all { it.mode == TripMode.WALK || it.mode in trip.modes } }
        return TripPlan(routes, warnings = emptyList())
    }

    /** One leg as the sample needs it: mode, end point, minutes, km, cost, and the line ridden if any. */
    private data class LegSpec(
        val mode: TripMode,
        val to: PlanPlace,
        val minutes: Int,
        val km: Double,
        val costCents: Int = 0,
        val line: TransitLine? = null,
    )

    private fun cheapest(trip: PlanRequest): RouteOption {
        val stop = PlanPlace("Sample Bus Stop", pointAlong(trip, 0.05, sideways = -0.002))
        val transfer = PlanPlace("Broadway-City Hall", pointAlong(trip, 0.6, sideways = -0.003))
        val endStation = PlanPlace("Waterfront Station", pointAlong(trip, 0.95))
        val bus = TransitLine("99 B-Line", "Bus", null, "Commercial-Broadway", stop.label, transfer.label, 12)
        val canada = TransitLine("Canada Line", "SkyTrain", CANADA_LINE_TEAL, "Waterfront", transfer.label, endStation.label, 5)
        return route(
            trip, RouteLabel.CHEAPEST, earlyMinutes = 2, parkingCents = 0, fareCents = 335, estimated = false,
            transferPoints = emptyList(),
            specs = listOf(
                LegSpec(TripMode.WALK, stop, minutes = 5, km = 0.4),
                LegSpec(TripMode.TRANSIT, transfer, minutes = 30, km = 9.5, costCents = 335, line = bus),
                LegSpec(TripMode.TRANSIT, endStation, minutes = 12, km = 4.1, line = canada),
                LegSpec(TripMode.WALK, trip.destination, minutes = 4, km = 0.3),
            ),
        )
    }

    private fun fastest(trip: PlanRequest) = route(
        trip, RouteLabel.FASTEST, earlyMinutes = 0, parkingCents = 0, fareCents = 0, estimated = true, // parking unknown
        transferPoints = emptyList(),
        specs = listOf(LegSpec(TripMode.DRIVE, trip.destination, minutes = 28, km = 18.4, costCents = DRIVE_ALL_THE_WAY_CENTS)),
    )

    private fun balanced(trip: PlanRequest): RouteOption {
        val spot = PlanPlace("North Parkade (sample)", pointAlong(trip, 0.35, sideways = 0.004))
        val station = PlanPlace("Sample Station", pointAlong(trip, 0.4))
        val endStation = PlanPlace("Waterfront Station", pointAlong(trip, 0.95))
        val expo = TransitLine("Expo Line", "SkyTrain", EXPO_LINE_BLUE, "Waterfront", station.label, endStation.label, 9)
        return route(
            trip, RouteLabel.BALANCED, earlyMinutes = 4, parkingCents = 0, fareCents = 240, estimated = false,
            transferPoints = listOf(spot),
            specs = listOf(
                LegSpec(TripMode.DRIVE, spot, minutes = 14, km = 9.2, costCents = 118),
                LegSpec(TripMode.WALK, station, minutes = 3, km = 0.2),
                LegSpec(TripMode.TRANSIT, endStation, minutes = 20, km = 14.0, costCents = 240, line = expo),
                LegSpec(TripMode.WALK, trip.destination, minutes = 3, km = 0.3),
            ),
        )
    }

    // builds a route from its legs, timing them back-to-back from the leave time
    @Suppress("LongParameterList") // a sample route really has this many knobs
    private fun route(
        trip: PlanRequest,
        label: RouteLabel,
        earlyMinutes: Int,
        parkingCents: Int,
        fareCents: Int,
        estimated: Boolean,
        transferPoints: List<PlanPlace>,
        specs: List<LegSpec>,
    ): RouteOption {
        val totalMinutes = specs.sumOf { it.minutes }
        val arriveAt = trip.arriveBy?.minus(Duration.ofMinutes(earlyMinutes.toLong()))
            ?: clock().plus(Duration.ofMinutes(totalMinutes.toLong()))
        val leaveAt = arriveAt.minus(Duration.ofMinutes(totalMinutes.toLong()))

        var from = trip.origin
        var time = leaveAt
        val legs = specs.map { spec ->
            val end = time.plus(Duration.ofMinutes(spec.minutes.toLong()))
            val leg = PlanLeg(
                mode = spec.mode,
                from = from,
                to = spec.to,
                departAt = time,
                arriveAt = end,
                durationSeconds = spec.minutes * SECONDS_PER_MINUTE,
                distanceMeters = (spec.km * 1000).roundToInt(),
                costCents = spec.costCents,
                polyline = encodePolyline(listOf(from.location, spec.to.location)),
                transitLines = listOfNotNull(spec.line),
            )
            from = spec.to
            time = end
            leg
        }
        val fuelCents = legs.filter { it.mode == TripMode.DRIVE }.sumOf { it.costCents }
        return RouteOption(
            label = label,
            leaveAt = leaveAt,
            arriveAt = arriveAt,
            lateByMinutes = 0,
            totalDurationSeconds = totalMinutes * SECONDS_PER_MINUTE,
            totalDistanceMeters = legs.sumOf { it.distanceMeters },
            totalCostCents = fuelCents + parkingCents + fareCents,
            costBreakdown = CostBreakdown(fuelCents, parkingCents, fareCents),
            costEstimated = estimated,
            baselineDriveCostCents = DRIVE_ALL_THE_WAY_CENTS,
            transferPoints = transferPoints,
            transfers = legs.count { it.mode != TripMode.WALK } - 1,
            legs = legs,
        )
    }

    // a point [fraction] of the way from origin to destination, nudged [sideways] degrees off the line
    private fun pointAlong(trip: PlanRequest, fraction: Double, sideways: Double = 0.0): LatLng {
        val a = trip.origin.location
        val b = trip.destination.location
        return LatLng(
            a.latitude + (b.latitude - a.latitude) * fraction + sideways,
            a.longitude + (b.longitude - a.longitude) * fraction - sideways,
        )
    }
}

// Google's encoded polyline format, the reverse of `decodePolyline`. Only the fake needs to make these
private fun encodePolyline(points: List<LatLng>): String {
    val out = StringBuilder()
    var lastLat = 0
    var lastLng = 0
    for (point in points) {
        val lat = (point.latitude * 1e5).roundToInt()
        val lng = (point.longitude * 1e5).roundToInt()
        encodeDelta(lat - lastLat, out)
        encodeDelta(lng - lastLng, out)
        lastLat = lat
        lastLng = lng
    }
    return out.toString()
}

private fun encodeDelta(delta: Int, out: StringBuilder) {
    var value = if (delta < 0) (delta shl 1).inv() else delta shl 1 // sign goes in the lowest bit
    while (value >= 0x20) {
        out.append(((0x20 or (value and 0x1f)) + 63).toChar())
        value = value shr 5
    }
    out.append((value + 63).toChar())
}
