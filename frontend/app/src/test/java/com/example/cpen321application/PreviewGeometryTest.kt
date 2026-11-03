package com.example.cpen321application

import com.example.cpen321application.data.FakePlannerApi
import com.example.cpen321application.data.PlanPlace
import com.example.cpen321application.data.PlanRequest
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.ui.planning.legPoints
import com.example.cpen321application.ui.planning.routePoints
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
    }
}
