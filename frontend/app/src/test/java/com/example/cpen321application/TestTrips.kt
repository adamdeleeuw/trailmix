package com.example.cpen321application

import com.example.cpen321application.data.CostBreakdown
import com.example.cpen321application.data.PlanLeg
import com.example.cpen321application.data.PlanPlace
import com.example.cpen321application.data.RouteLabel
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.data.TransitLine
import com.example.cpen321application.data.Trip
import com.example.cpen321application.data.TripLeg
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.data.TripPlace
import com.example.cpen321application.data.TripStatus
import com.google.android.gms.maps.model.LatLng
import java.time.Instant

/** When [testRoute] leaves. */
val ROUTE_LEAVES: Instant = Instant.parse("2026-10-19T08:00:00Z")

val ROUTE_HOME = PlanPlace("Home", LatLng(49.2827, -123.1207))
val ROUTE_PARKADE = PlanPlace("North Parkade", LatLng(49.2488, -123.0016))
val ROUTE_STATION = PlanPlace("Transit connection", LatLng(49.2484, -123.0011))
val ROUTE_UBC = PlanPlace("UBC", LatLng(49.2606, -123.2460))
val EXPO_LINE = TransitLine("Expo Line", "SUBWAY", "#0060A9", "King George", "Commercial-Broadway", "Main Street", 6)

// a leg from minute `from` to minute `to` after ROUTE_LEAVES
private fun leg(mode: TripMode, start: PlanPlace, end: PlanPlace, from: Long, to: Long, line: TransitLine? = null) = PlanLeg(
    mode, start, end, ROUTE_LEAVES.plusSeconds(from * 60), ROUTE_LEAVES.plusSeconds(to * 60),
    ((to - from) * 60).toInt(), 1000, 0, "", listOfNotNull(line),
)

/** Drive 10 min to the parkade, walk 5 min to the station, wait 4 min, then ride the Expo Line 20 min. */
fun testRoute() = RouteOption(
    label = RouteLabel.CHEAPEST,
    leaveAt = ROUTE_LEAVES,
    arriveAt = ROUTE_LEAVES.plusSeconds(39 * 60),
    lateByMinutes = 0,
    totalDurationSeconds = 39 * 60,
    totalDistanceMeters = 3000,
    totalCostCents = 765,
    costBreakdown = CostBreakdown(250, 200, 315),
    costEstimated = false,
    baselineDriveCostCents = 1200,
    transferPoints = listOf(ROUTE_PARKADE),
    transfers = 0,
    legs = listOf(
        leg(TripMode.DRIVE, ROUTE_HOME, ROUTE_PARKADE, 0, 10),
        leg(TripMode.WALK, ROUTE_PARKADE, ROUTE_STATION, 10, 15),
        leg(TripMode.TRANSIT, ROUTE_STATION, ROUTE_UBC, 19, 39, EXPO_LINE),
    ),
)

/** Builds a saved trip for tests, from Home to Work, with an even cost split unless given. */
fun testTrip(
    id: String = "trip",
    status: TripStatus = TripStatus.COMPLETED,
    duration: Int = 600,
    cost: Int = 300,
    legs: List<TripLeg> = emptyList(),
    baselineDriveCostCents: Int? = null,
    tripDate: String = "2026-10-19T08:00:00Z",
    route: RouteOption? = null,
) = Trip(
    id = id,
    status = status,
    origin = TripPlace("Home"),
    destination = TripPlace("Work"),
    legs = legs,
    totalDurationSeconds = duration,
    totalCostCents = cost,
    fuelCents = cost / 3,
    parkingCents = cost / 3,
    fareCents = cost - 2 * (cost / 3),
    baselineDriveCostCents = baselineDriveCostCents,
    tripDate = tripDate,
    route = route,
)
