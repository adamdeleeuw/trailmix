package com.example.cpen321application.ui.planning

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.example.cpen321application.data.PlanPlace
import com.example.cpen321application.data.PlanRequest
import com.example.cpen321application.data.PlannerApi
import com.example.cpen321application.data.PlanningPreferences
import com.example.cpen321application.data.PlanningPreferencesApi
import com.example.cpen321application.data.RouteLabel
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.data.TripPlan
import com.example.cpen321application.data.toJson
import com.example.cpen321application.data.toTripPlan
import com.google.android.gms.maps.model.LatLng
import java.io.IOException
import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

private val BIKE_HOME = PlanPlace("Home", LatLng(49.26, -123.12))
private val BIKE_DESTINATION = PlanPlace("Downtown", LatLng(49.28, -123.11))
private const val BIKE_POLYLINE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
private val BIKE_DEPARTURE = Instant.parse("2026-11-18T21:00:00Z")

private enum class BicycleJourney { DIRECT, BIKE_TRANSIT, TRANSIT_BIKE, MULTIPLE_BIKE_LEGS }

private class PlanningBoundaryFixture(
    var bicycleJourney: BicycleJourney = BicycleJourney.BIKE_TRANSIT,
    var preferences: PlanningPreferences? = null,
) : PlannerApi, PlanningPreferencesApi {
    val requests = mutableListOf<JSONObject>()
    var failure: IOException? = null
    var empty = false

    override suspend fun planTrip(sessionToken: String?, trip: PlanRequest): TripPlan {
        requests += trip.toJson()
        failure?.let { throw it }
        return if (empty) {
            JSONObject().put("options", JSONArray()).put("warnings", JSONArray()).toTripPlan()
        } else {
            plannerResponse(trip.modes).toTripPlan()
        }
    }

    override suspend fun getPlanningPreferences(sessionToken: String?) =
        preferences ?: PlanningPreferences(
            50,
            setOf(TripMode.DRIVE, TripMode.TRANSIT),
            10,
        )

    override suspend fun savePlanningPreferences(sessionToken: String?, preferences: PlanningPreferences) = preferences

    private fun plannerResponse(modes: Set<TripMode>): JSONObject {
        val legs = when {
            bicycleJourney == BicycleJourney.MULTIPLE_BIKE_LEGS -> listOf(
                leg(TripMode.BICYCLE, "Home", "Waterfront Station", 600, 900, 3200, 0),
                leg(TripMode.TRANSIT, "Waterfront Station", "Broadway-City Hall", 1620, 1200, 8000, 275),
                leg(TripMode.BICYCLE, "Broadway-City Hall", "Downtown", 2940, 600, 1800, 0),
            )
            TripMode.BICYCLE in modes && TripMode.TRANSIT in modes &&
                bicycleJourney == BicycleJourney.TRANSIT_BIKE -> listOf(
                leg(TripMode.TRANSIT, "Home", "Waterfront Station", 600, 1200, 8000, 275),
                leg(TripMode.BICYCLE, "Waterfront Station", "Downtown", 1920, 900, 3200, 0),
            )
            TripMode.DRIVE in modes && TripMode.TRANSIT in modes -> listOf(
                leg(TripMode.DRIVE, "Home", "Parkade", 600, 900, 7000, 250),
                leg(TripMode.TRANSIT, "Parkade", "Downtown", 1620, 1200, 8000, 275),
            )
            TripMode.BICYCLE in modes && TripMode.TRANSIT in modes -> listOf(
                leg(TripMode.BICYCLE, "Home", "Waterfront Station", 600, 900, 3200, 0),
                leg(TripMode.TRANSIT, "Waterfront Station", "Downtown", 1620, 1200, 8000, 275),
            )
            TripMode.BICYCLE in modes -> listOf(
                leg(TripMode.BICYCLE, "Home", "Downtown", 600, 900, 3200, 0),
            )
            TripMode.TRANSIT in modes -> listOf(
                leg(TripMode.TRANSIT, "Home", "Downtown", 600, 1200, 8000, 275),
            )
            else -> listOf(leg(TripMode.DRIVE, "Home", "Downtown", 600, 900, 7000, 525))
        }
        val transferBuffer = legs.zipWithNext().fold(0) { total, (from, to) ->
            val fromMode = from.getString("mode")
            val toMode = to.getString("mode")
            total + when {
                fromMode == TripMode.BICYCLE.name && toMode == TripMode.TRANSIT.name -> 120
                fromMode == TripMode.TRANSIT.name && toMode == TripMode.BICYCLE.name -> 120
                fromMode == TripMode.DRIVE.name && toMode == TripMode.TRANSIT.name -> 300
                else -> 0
            }
        }
        val duration = legs.sumOf { it.getInt("durationSeconds") } + transferBuffer
        val fuel = legs.filter { it.getString("mode") == TripMode.DRIVE.name }.sumOf { it.getInt("costCents") }
        val fare = legs.filter { it.getString("mode") == TripMode.TRANSIT.name }.sumOf { it.getInt("costCents") }
        val totalCost = legs.sumOf { it.getInt("costCents") }
        val leaveAt = legs.first().getString("departAt")
        return JSONObject().put(
            "options",
            JSONArray().put(
                JSONObject()
                    .put("label", RouteLabel.FASTEST.name)
                    .put("leaveAt", leaveAt)
                    .put("arriveAt", Instant.parse(leaveAt).plusSeconds(duration.toLong()).toString())
                    .put("lateByMinutes", 0)
                    .put("totalDurationSeconds", duration)
                    .put("totalDistanceMeters", legs.sumOf { it.getInt("distanceMeters") })
                    .put("totalCostCents", totalCost)
                    .put("costBreakdown", JSONObject().put("fuelCents", fuel).put("parkingCents", 0).put("fareCents", fare))
                    .put("costEstimated", false)
                    .put("baselineDriveCostCents", JSONObject.NULL)
                    .put("transferPoints", JSONArray())
                    .put("transfers", legs.count { it.getString("mode") == TripMode.TRANSIT.name })
                    .put("legs", JSONArray(legs)),
            ),
        ).put("warnings", JSONArray())
    }

    private fun leg(
        mode: TripMode,
        from: String,
        to: String,
        departureOffset: Long,
        duration: Int,
        distance: Int,
        cost: Int,
    ) = JSONObject()
        .put("mode", mode.name)
        .put("from", place(from))
        .put("to", place(to))
        .put("departAt", BIKE_DEPARTURE.plusSeconds(departureOffset).toString())
        .put("arriveAt", BIKE_DEPARTURE.plusSeconds(departureOffset + duration).toString())
        .put("durationSeconds", duration)
        .put("distanceMeters", distance)
        .put("costCents", cost)
        .put("polyline", BIKE_POLYLINE)
        .put(
            "transitLines",
            if (mode == TripMode.TRANSIT) JSONArray().put(
                JSONObject()
                    .put("name", "Canada Line")
                    .put("shortName", "Canada Line")
                    .put("vehicle", "SkyTrain")
                    .put("colour", "#0067A0")
                    .put("headsign", "Waterfront")
                    .put("departureStop", from)
                    .put("arrivalStop", to)
                    .put("stopCount", 6),
            ) else JSONArray(),
        )
        .put("steps", JSONArray())

    private fun place(label: String) = JSONObject()
        .put("label", label)
        .put("lat", when (label) {
            "Home" -> BIKE_HOME.location.latitude
            "Downtown" -> BIKE_DESTINATION.location.latitude
            "Waterfront Station" -> 49.2858
            else -> 49.263
        })
        .put("lng", when (label) {
            "Home" -> BIKE_HOME.location.longitude
            "Downtown" -> BIKE_DESTINATION.location.longitude
            "Waterfront Station" -> -123.1118
            else -> -123.114
        })
        .put("placeId", JSONObject.NULL)
}

private object PlanningTestSession : SessionStore {
    override suspend fun token() = "fixture-session"
    override suspend fun setToken(token: String?) = Unit
    override suspend fun pendingSignOuts() = emptySet<String>()
    override suspend fun endSession() = Unit
    override suspend fun forget(token: String) = Unit
}

class BicyclePlanningIntegrationTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun selectingBikeWithTransitSendsBothModesAndRendersTheReturnedJourney() {
        val api = PlanningBoundaryFixture()
        val planner = PlanningViewModel(api, api, PlanningTestSession)
        showPlanning(planner)
        planner.start(BIKE_DESTINATION, BIKE_HOME, tripModes = setOf(TripMode.TRANSIT))
        awaitReady(planner)

        rule.onNodeWithText("Modes ▾").performClick()
        rule.onNodeWithText("Bike").performClick()
        rule.waitUntil(10_000) {
            planner.status == PlanStatus.READY &&
                api.requests.lastOrNull()?.getJSONArray("modes")?.let(::modesFrom) ==
                setOf(TripMode.BICYCLE, TripMode.TRANSIT)
        }
        rule.onNodeWithText("Modes ▾").performClick()

        assertEquals(
            setOf(TripMode.BICYCLE, TripMode.TRANSIT),
            modesFrom(api.requests.last().getJSONArray("modes")),
        )
        val route = planner.selectedRoute ?: error("Expected a route from the fixture")
        assertEquals(listOf(TripMode.BICYCLE, TripMode.TRANSIT), route.legs.map { it.mode })
        assertEquals(3200, route.legs.first().distanceMeters)
        assertEquals(900, route.legs.first().durationSeconds)
        assertEquals(0, route.legs.first().costCents)
        assertEquals(BIKE_POLYLINE, route.legs.first().polyline)
        assertEquals(275, route.legs.last().costCents)
        assertTrue(legPoints(route.legs.first()).size > 2)
        assertTrue(routePoints(route).size > 2)
        assertEquals(BICYCLE_GREEN, mapLegStyle(route.legs.first().mode, null).colour)
        assertEquals(route.legs.first().to.location, bicycleMarkerLocation(route, 0))
        rule.onNodeWithText("Bike 15").assertIsDisplayed()
        rule.onNodeWithText("Canada Line").assertIsDisplayed()

        rule.onNodeWithText("Fastest").performClick()
        rule.onNodeWithText("Bike to Waterfront Station").assertIsDisplayed()
        rule.onNodeWithText("Lock bike at Waterfront Station").assertIsDisplayed()
        rule.onNodeWithText("Canada Line").assertIsDisplayed()
        rule.onNodeWithText("Arrive at Downtown").assertIsDisplayed()
    }

    @Test
    fun bicycleOnlyRequestAndResponseSurviveThePlanningFlow() {
        val api = PlanningBoundaryFixture(bicycleJourney = BicycleJourney.DIRECT)
        val planner = PlanningViewModel(api, api, PlanningTestSession)
        showPlanning(planner)
        planner.start(BIKE_DESTINATION, BIKE_HOME, tripModes = setOf(TripMode.TRANSIT))
        awaitReady(planner)

        rule.onNodeWithText("Modes ▾").performClick()
        rule.onNodeWithText("Bike").performClick()
        rule.onNodeWithText("Transit").performClick()
        rule.waitUntil(10_000) {
            planner.status == PlanStatus.READY &&
                api.requests.lastOrNull()?.getJSONArray("modes")?.let(::modesFrom) == setOf(TripMode.BICYCLE)
        }
        rule.onNodeWithText("Modes ▾").performClick()

        assertEquals(setOf(TripMode.BICYCLE), modesFrom(api.requests.last().getJSONArray("modes")))
        val route = planner.selectedRoute ?: error("Expected bicycle-only route")
        assertEquals(TripMode.BICYCLE, route.legs.single().mode)
        assertEquals(3200, route.legs.single().distanceMeters)
        assertEquals(900, route.legs.single().durationSeconds)
        assertEquals(0, route.legs.single().costCents)
        assertEquals(BIKE_POLYLINE, route.legs.single().polyline)
        rule.onNodeWithText("Bike 15").assertIsDisplayed()
        rule.onNodeWithText("Fastest").performClick()
        rule.onNodeWithText("Bike to Downtown").assertIsDisplayed()
        rule.onNodeWithText("15 min · 3.2 km").assertIsDisplayed()
    }

    @Test
    fun transitToBikeAndMultipleBikeLegsKeepTheirSequenceAndMapGeometry() {
        val api = PlanningBoundaryFixture(bicycleJourney = BicycleJourney.TRANSIT_BIKE)
        val planner = PlanningViewModel(api, api, PlanningTestSession)
        showPlanning(planner)
        planner.start(
            BIKE_DESTINATION,
            BIKE_HOME,
            tripModes = setOf(TripMode.BICYCLE, TripMode.TRANSIT),
        )
        awaitReady(planner)

        var route = planner.selectedRoute ?: error("Expected transit-to-bike route")
        assertEquals(listOf(TripMode.TRANSIT, TripMode.BICYCLE), route.legs.map { it.mode })
        assertEquals("Waterfront Station", route.legs.last().from.label)
        assertEquals("Downtown", route.legs.last().to.label)
        assertEquals(0, route.legs.last().costCents)
        assertEquals(
            listOf("Canada Line · 20 min", "Bike 15 min"),
            topBarLines("Home", "Downtown", route)
            .filterIsInstance<TripLine.Connector>()
            .map { it.text },
        )
        rule.onNodeWithText("Fastest").performClick()
        rule.onNodeWithText("Pick up bike at Waterfront Station").assertIsDisplayed()
        rule.onNodeWithText("Bike to Downtown").assertIsDisplayed()
        planner.closePreview()

        api.bicycleJourney = BicycleJourney.MULTIPLE_BIKE_LEGS
        planner.retry()
        rule.waitUntil(10_000) {
            planner.status == PlanStatus.READY &&
                planner.selectedRoute?.legs?.count { it.mode == TripMode.BICYCLE } == 2
        }
        route = planner.selectedRoute ?: error("Expected route with two bicycle legs")
        val bikeLegs = route.legs.filter { it.mode == TripMode.BICYCLE }
        assertEquals(2, bikeLegs.size)
        assertEquals(listOf("Home", "Broadway-City Hall"), bikeLegs.map { it.from.label })
        assertEquals(listOf("Waterfront Station", "Downtown"), bikeLegs.map { it.to.label })
        assertTrue(bikeLegs.all { legPoints(it).size > 2 })
        assertEquals(route.legs[2].from.location, bicycleMarkerLocation(route, 2))

        rule.onNodeWithText("Fastest").performClick()
        rule.onNodeWithText("Bike to Waterfront Station").assertIsDisplayed()
        rule.onNodeWithText("Bike to Downtown").assertIsDisplayed()
    }

    @Test
    fun driveAndTransitResponsesRenderAndSavedBicyclePreferencesAreApplied() {
        val saved = PlanningPreferences(50, setOf(TripMode.BICYCLE, TripMode.TRANSIT), 10)
        val api = PlanningBoundaryFixture(preferences = saved)
        val planner = PlanningViewModel(api, api, PlanningTestSession)
        showPlanning(planner)
        planner.start(BIKE_DESTINATION, BIKE_HOME)
        awaitReady(planner)

        assertEquals(saved.defaultModes, planner.modes)
        assertEquals(saved.defaultModes, modesFrom(api.requests.single().getJSONArray("modes")))
        assertTrue(planner.selectedRoute!!.legs.any { it.mode == TripMode.BICYCLE })
        rule.onNodeWithText("Bike 15").assertIsDisplayed()
        rule.onNodeWithText("Canada Line").assertIsDisplayed()

        planner.start(BIKE_DESTINATION, BIKE_HOME, tripModes = setOf(TripMode.DRIVE))
        awaitReady(planner)
        assertEquals(listOf(TripMode.DRIVE), planner.selectedRoute!!.legs.map { it.mode })
        assertEquals(setOf(TripMode.DRIVE), modesFrom(api.requests.last().getJSONArray("modes")))
        rule.onNodeWithText("Drive 15").assertIsDisplayed()

        planner.start(BIKE_DESTINATION, BIKE_HOME, tripModes = setOf(TripMode.TRANSIT))
        awaitReady(planner)
        assertEquals(listOf(TripMode.TRANSIT), planner.selectedRoute!!.legs.map { it.mode })
        assertEquals(setOf(TripMode.TRANSIT), modesFrom(api.requests.last().getJSONArray("modes")))
        rule.onNodeWithText("Canada Line").assertIsDisplayed()
    }

    @Test
    fun existingDriveTransitJourneyKeepsItsLegOrderAndPresentation() {
        val api = PlanningBoundaryFixture()
        val planner = PlanningViewModel(api, api, PlanningTestSession)
        showPlanning(planner)
        planner.start(BIKE_DESTINATION, BIKE_HOME, tripModes = setOf(TripMode.DRIVE, TripMode.TRANSIT))
        awaitReady(planner)

        assertEquals(
            listOf(TripMode.DRIVE, TripMode.TRANSIT),
            planner.selectedRoute!!.legs.map { it.mode },
        )
        assertEquals(525, planner.selectedRoute!!.totalCostCents)
        rule.onNodeWithText("Drive 15").assertIsDisplayed()
        rule.onNodeWithText("Canada Line").assertIsDisplayed()
    }

    @Test
    fun failedAndEmptyPlanningRequestsShowTheirExpectedStates() {
        val api = PlanningBoundaryFixture().apply { failure = IOException("offline") }
        val planner = PlanningViewModel(api, api, PlanningTestSession)
        showPlanning(planner)
        planner.start(BIKE_DESTINATION, BIKE_HOME, tripModes = setOf(TripMode.BICYCLE))
        rule.waitUntil(10_000) { planner.status == PlanStatus.FAILED }
        rule.onNodeWithText(ROUTE_SERVICE_DOWN).assertIsDisplayed()

        api.failure = null
        api.empty = true
        planner.retry()
        rule.waitUntil(10_000) { planner.status == PlanStatus.NO_ROUTES }
        rule.onNodeWithText("No routes found between these places.").assertIsDisplayed()
    }

    private fun showPlanning(planner: PlanningViewModel) {
        rule.setContent {
            MaterialTheme {
                if (planner.isPreviewing) {
                    planner.selectedRoute?.let { route ->
                        timelineRows(route, planner.arriveBy).forEach { row -> TimelineItem(row) {} }
                    }
                } else {
                    Column {
                        ModesMenu(planner)
                        RoutesSheet(planner, onClose = {}, onPeekHeight = {})
                    }
                }
            }
        }
    }

    private fun awaitReady(planner: PlanningViewModel) {
        rule.waitUntil(10_000) { planner.status == PlanStatus.READY }
    }

    private fun modesFrom(modes: JSONArray): Set<TripMode> =
        List(modes.length()) { TripMode.valueOf(modes.getString(it)) }.toSet()
}
