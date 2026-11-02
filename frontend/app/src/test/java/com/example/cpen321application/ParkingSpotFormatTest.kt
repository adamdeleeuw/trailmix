package com.example.cpen321application

import com.example.cpen321application.data.ParkingSpotDetails
import com.example.cpen321application.data.RateUnit
import com.example.cpen321application.ui.map.COST_INVALID
import com.example.cpen321application.ui.map.COST_UNKNOWN
import com.example.cpen321application.ui.map.LABEL_REQUIRED
import com.example.cpen321application.ui.map.LABEL_TOO_LONG
import com.example.cpen321application.ui.map.centsToCostText
import com.example.cpen321application.ui.map.costError
import com.example.cpen321application.ui.map.costToCents
import com.example.cpen321application.ui.map.distanceMetres
import com.example.cpen321application.ui.map.formatDistance
import com.example.cpen321application.ui.map.formatOvernight
import com.example.cpen321application.ui.map.formatRate
import com.example.cpen321application.ui.map.labelError
import com.google.android.gms.maps.model.LatLng
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ParkingSpotFormatTest {
    @Test
    fun labelMustHaveOneToSixtyCharactersAfterTrimming() {
        assertEquals(LABEL_REQUIRED, labelError(""))
        assertEquals(LABEL_REQUIRED, labelError("   "))
        assertNull(labelError("P"))
        assertNull(labelError("  " + "x".repeat(60) + "  "))
        assertEquals(LABEL_TOO_LONG, labelError("x".repeat(61)))
    }

    @Test
    fun costAcceptsDollarsWithUpToTwoDecimals() {
        for (valid in listOf("", " ", "0", "3", "3.", "2.5", "2.50", "999.99")) {
            assertNull(valid, costError(valid))
        }
        for (invalid in listOf("-1", "1000", "2.505", "abc", "$3", ".5", "1,50")) {
            assertEquals(invalid, COST_INVALID, costError(invalid))
        }
    }

    @Test
    fun costConvertsToWholeCents() {
        assertEquals(300, costToCents("3"))
        assertEquals(300, costToCents("3."))
        assertEquals(250, costToCents("2.5"))
        assertEquals(205, costToCents(" 2.05 "))
        assertEquals(99999, costToCents("999.99"))
        assertEquals(0, costToCents("0"))
        assertNull(costToCents(""))
        assertNull(costToCents("2.505"))
    }

    @Test
    fun savedCostFillsTheEditDialog() {
        assertEquals("2.50", centsToCostText(250))
        assertEquals("0.05", centsToCostText(5))
        assertEquals("", centsToCostText(null))
    }

    @Test
    fun rateShowsTheCostPerUnitOrUnknown() {
        assertEquals("$3.00 per hour", formatRate(ParkingSpotDetails("Lot", 300, RateUnit.HOUR, true)))
        assertEquals("$15.50 per day", formatRate(ParkingSpotDetails("Lot", 1550, RateUnit.DAY, true)))
        assertEquals(COST_UNKNOWN, formatRate(ParkingSpotDetails("Lot", null, null, true)))
    }

    @Test
    fun overnightRuleIsSpelledOut() {
        assertEquals("Overnight parking allowed", formatOvernight(true))
        assertEquals("No overnight parking", formatOvernight(false))
    }

    @Test
    fun distanceIsTheStraightLineBetweenTwoPoints() {
        val downtown = LatLng(49.2827, -123.1207)
        val ubc = LatLng(49.2606, -123.2460)
        assertEquals(0.0, distanceMetres(downtown, downtown), 0.001)
        // about 9.4 km across the city, give or take 100 m
        assertEquals(9_400.0, distanceMetres(downtown, ubc), 100.0)
    }

    @Test
    fun distanceUsesMetresUnderAKilometre() {
        assertEquals("350 m", formatDistance(349.6))
        assertEquals("1.0 km", formatDistance(1000.0))
        assertEquals("2.4 km", formatDistance(2_449.0))
    }
}
