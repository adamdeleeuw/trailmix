package com.example.cpen321application

import com.example.cpen321application.data.FakePlannerApi
import com.example.cpen321application.data.PlanPlace
import com.example.cpen321application.data.PlanRequest
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.ui.planning.legPoints
import com.example.cpen321application.ui.planning.mapLegStyle
import com.example.cpen321application.ui.planning.routePoints
import com.example.cpen321application.ui.planning.BICYCLE_GREEN
import com.example.cpen321application.ui.planning.bicycleMarkerLocation
import com.google.android.gms.maps.model.LatLng
import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PreviewGeometryTest {
    @Test
    fun previewUsesEveryDecodedPointForLinesAndRouteBounds() = runTest {
        val request = PlanRequest(
            origin = PlanPlace("Origin", LatLng(38.5, -120.2)),
            destination = PlanPlace("Destination", LatLng(43.252, -126.453)),
            arriveBy = null,
            modes = setOf(TripMode.DRIVE),
        )
        val route = FakePlannerApi(delayMs = 0, clock = { Instant.EPOCH }).planTrip("token", request).options.single()
        val option = route.copy(legs = route.legs.map { it.copy(polyline = "_p~iF~ps|U_ulLnnqC_mqNvxq`@") })
        val leg = option.legs.single()
        val points = legPoints(leg)

        assertEquals(3, points.size)
        assertTrue(points.size > 2)
        assertEquals(points, routePoints(option))

        val bicycle = leg.copy(mode = TripMode.BICYCLE)
        assertEquals(points, legPoints(bicycle))
    }

    @Test
    fun bicycleMapStyleIsDistinctAndUsesSolidVisibleLine() {
        val bicycle = mapLegStyle(TripMode.BICYCLE, transitColour = null)
        val driving = mapLegStyle(TripMode.DRIVE, transitColour = null)
        val walking = mapLegStyle(TripMode.WALK, transitColour = null)

        assertEquals(BICYCLE_GREEN, bicycle.colour)
        assertTrue(bicycle.colour != driving.colour)
        assertTrue(bicycle.colour != walking.colour)
        assertTrue(!bicycle.dotted)
        assertTrue(bicycle.width > walking.width)
        assertTrue(bicycle.zIndex > driving.zIndex)
    }

    @Test
    fun missingBicycleGeometryStillFitsMapBoundsAndPlacesItsTransferMarker() = runTest {
        val request = PlanRequest(
            origin = PlanPlace("Origin", LatLng(49.0, -123.0)),
            destination = PlanPlace("Destination", LatLng(49.1, -123.1)),
            arriveBy = null,
            modes = setOf(TripMode.DRIVE),
        )
        val route = FakePlannerApi(delayMs = 0, clock = { Instant.EPOCH }).planTrip("token", request).options
            .single()
        val bicycle = route.legs.single().copy(mode = TripMode.BICYCLE, polyline = "")
        val routeWithBicycle = route.copy(legs = listOf(bicycle))

        assertTrue(legPoints(bicycle).isEmpty())
        assertEquals(listOf(bicycle.from.location, bicycle.to.location), routePoints(routeWithBicycle))
        assertEquals(bicycle.from.location, bicycleMarkerLocation(routeWithBicycle, 0))
    }

    @Test
    fun bicycleMarkerSitsAtTheTransitHandoff() = runTest {
        val request = PlanRequest(
            origin = PlanPlace("Origin", LatLng(49.0, -123.0)),
            destination = PlanPlace("Destination", LatLng(49.1, -123.1)),
            arriveBy = null,
            modes = setOf(TripMode.DRIVE, TripMode.TRANSIT),
        )
        val route = FakePlannerApi(delayMs = 0, clock = { Instant.EPOCH }).planTrip("token", request).options
            .first { it.legs.any { leg -> leg.mode == TripMode.TRANSIT } }
        val transit = route.legs.first { it.mode == TripMode.TRANSIT }
        val bicycle = route.legs.first().copy(mode = TripMode.BICYCLE, to = transit.from)
        val mixed = route.copy(legs = listOf(bicycle, transit))

        assertEquals(transit.from.location, bicycleMarkerLocation(mixed, 0))
    }

    @Test
    fun multipleBicycleLegsKeepTheirOwnTransferLocations() = runTest {
        val request = PlanRequest(
            origin = PlanPlace("Origin", LatLng(49.0, -123.0)),
            destination = PlanPlace("Destination", LatLng(49.1, -123.1)),
            arriveBy = null,
            modes = setOf(TripMode.DRIVE, TripMode.TRANSIT),
        )
        val route = FakePlannerApi(delayMs = 0, clock = { Instant.EPOCH }).planTrip("token", request).options
            .first { it.legs.any { leg -> leg.mode == TripMode.TRANSIT } }
        val transit = route.legs.first { it.mode == TripMode.TRANSIT }
        val before = route.legs.first().copy(mode = TripMode.BICYCLE, to = transit.from)
        val after = route.legs.last().copy(mode = TripMode.BICYCLE, from = transit.to)
        val mixed = route.copy(legs = listOf(before, transit, after))

        assertEquals(transit.from.location, bicycleMarkerLocation(mixed, 0))
        assertEquals(transit.to.location, bicycleMarkerLocation(mixed, 2))
    }
}
