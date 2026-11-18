package com.example.cpen321application.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.android.gms.maps.model.LatLng
import com.example.cpen321application.ui.planning.legPoints
import com.example.cpen321application.ui.planning.routePoints
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

private val BIKE_API_ORIGIN = PlanPlace("Origin", LatLng(49.26, -123.12))
private val BIKE_API_DESTINATION = PlanPlace("Destination", LatLng(49.28, -123.11))
private val BIKE_API_NOW = Instant.parse("2026-11-18T21:00:00Z")

@RunWith(AndroidJUnit4::class)
class PlanningBicycleApiTest {
    @Test
    fun bicycleModeIsSerializedInPlanningRequests() {
        val request = PlanRequest(
            BIKE_API_ORIGIN,
            BIKE_API_DESTINATION,
            arriveBy = null,
            modes = setOf(TripMode.BICYCLE),
        )

        assertEquals(listOf("BICYCLE"), request.toJson().getJSONArray("modes").let { modes ->
            List(modes.length()) { modes.getString(it) }
        })
    }

    @Test
    fun bicycleAndTransitModesAreBothSerializedInPlanningRequests() {
        val request = PlanRequest(
            BIKE_API_ORIGIN,
            BIKE_API_DESTINATION,
            arriveBy = null,
            modes = setOf(TripMode.BICYCLE, TripMode.TRANSIT),
        )

        assertEquals(
            setOf("BICYCLE", "TRANSIT"),
            request.toJson().getJSONArray("modes").let { modes ->
                List(modes.length()) { modes.getString(it) }.toSet()
            },
        )
    }

    @Test
    fun savedBicyclePreferencesAreParsed() {
        val preferences = JSONObject()
            .put("costVsTime", 50)
            .put("defaultModes", JSONArray(listOf("BICYCLE", "TRANSIT")))
            .put("maxWalkMinutes", 10)
            .toPlanningPreferences()

        assertEquals(setOf(TripMode.BICYCLE, TripMode.TRANSIT), preferences.defaultModes)
    }

    @Test
    fun bicycleLegsAreParsedFromPlannerResponses() = runBlocking {
        val route = FakePlannerApi(delayMs = 0, clock = { BIKE_API_NOW })
            .planTrip(
                sessionToken = null,
                PlanRequest(BIKE_API_ORIGIN, BIKE_API_DESTINATION, null, setOf(TripMode.DRIVE)),
            )
            .options
            .first { it.label == RouteLabel.FASTEST }
        val response = JSONObject()
            .put("options", JSONArray().put(route.copy(legs = route.legs.map { it.copy(mode = TripMode.BICYCLE) }).toJson()))
            .put("warnings", JSONArray())
            .toTripPlan()

        assertEquals(TripMode.BICYCLE, response.options.single().legs.single().mode)
    }

    @Test
    fun bicycleLegResponsePreservesGeometryDistanceDurationCostAndEndpoints() {
        val response = JSONObject()
            .put(
                "options",
                JSONArray().put(
                    JSONObject()
                        .put("label", "FASTEST")
                        .put("leaveAt", "2026-11-18T21:00:00Z")
                        .put("arriveAt", "2026-11-18T21:15:00Z")
                        .put("lateByMinutes", 0)
                        .put("totalDurationSeconds", 900)
                        .put("totalDistanceMeters", 3200)
                        .put("totalCostCents", 0)
                        .put("costBreakdown", JSONObject().put("fuelCents", 0).put("parkingCents", 0).put("fareCents", 0))
                        .put("costEstimated", false)
                        .put("baselineDriveCostCents", JSONObject.NULL)
                        .put("transferPoints", JSONArray())
                        .put("transfers", 0)
                        .put(
                            "legs",
                            JSONArray().put(
                                JSONObject()
                                    .put("mode", "BICYCLE")
                                    .put("from", JSONObject().put("label", "Origin").put("lat", 49.26).put("lng", -123.12).put("placeId", JSONObject.NULL))
                                    .put("to", JSONObject().put("label", "Destination").put("lat", 49.28).put("lng", -123.11).put("placeId", JSONObject.NULL))
                                    .put("departAt", "2026-11-18T21:00:00Z")
                                    .put("arriveAt", "2026-11-18T21:15:00Z")
                                    .put("durationSeconds", 900)
                                    .put("distanceMeters", 3200)
                                    .put("costCents", 0)
                                    .put("polyline", "_p~iF~ps|U_ulLnnqC_mqNvxq`@")
                                    .put("transitLines", JSONArray())
                                    .put("steps", JSONArray()),
                            ),
                        ),
                ),
            )
            .put("warnings", JSONArray())
            .toTripPlan()
            .options
            .single()
            .legs
            .single()

        assertEquals(TripMode.BICYCLE, response.mode)
        assertEquals(BIKE_API_ORIGIN, response.from)
        assertEquals(BIKE_API_DESTINATION, response.to)
        assertEquals(900, response.durationSeconds)
        assertEquals(3200, response.distanceMeters)
        assertEquals(0, response.costCents)
        assertEquals("_p~iF~ps|U_ulLnnqC_mqNvxq`@", response.polyline)
    }

    @Test
    fun bicycleLegWithoutPolylineParsesAndKeepsItsEndpointsForMapBounds() = runBlocking {
        val route = FakePlannerApi(delayMs = 0, clock = { BIKE_API_NOW })
            .planTrip(
                sessionToken = null,
                PlanRequest(BIKE_API_ORIGIN, BIKE_API_DESTINATION, null, setOf(TripMode.DRIVE)),
            )
            .options
            .first { it.label == RouteLabel.FASTEST }
        val responseJson = route.copy(legs = route.legs.map { it.copy(mode = TripMode.BICYCLE) })
            .toJson()
        responseJson.getJSONArray("legs").getJSONObject(0).remove("polyline")
        val response = JSONObject()
            .put("options", JSONArray().put(responseJson))
            .put("warnings", JSONArray())
            .toTripPlan()
        val parsed = response.options.single()

        assertEquals("", parsed.legs.single().polyline)
        assertTrue(legPoints(parsed.legs.single()).isEmpty())
        assertEquals(
            listOf(BIKE_API_ORIGIN.location, BIKE_API_DESTINATION.location),
            routePoints(parsed),
        )
    }
}
