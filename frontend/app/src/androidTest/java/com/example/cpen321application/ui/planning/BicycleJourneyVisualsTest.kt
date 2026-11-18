package com.example.cpen321application.ui.planning

import android.graphics.Color as AndroidColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.graphics.toArgb
import androidx.test.core.app.ApplicationProvider
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.ui.planning.DRIVE_BLUE
import com.example.cpen321application.ui.planning.LINE_FALLBACK
import com.example.cpen321application.ui.planning.WALK_GREY
import com.example.cpen321application.ui.planning.mapLegStyle
import com.google.android.gms.maps.model.LatLng
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class BicycleJourneyVisualsTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun bicycleTimelineRendersItsIconLabelDurationAndDistance() {
        val row = TimelineRow(
            kind = RowKind.BICYCLE,
            title = "Bike to Waterfront Station",
            detail = "12 min · 3.4 km",
            time = null,
            at = LatLng(49.26, -123.12),
            endAt = LatLng(49.28, -123.11),
        )
        rule.setContent { MaterialTheme { TimelineItem(row) {} } }

        rule.onNodeWithText("Bike to Waterfront Station").assertIsDisplayed()
        rule.onNodeWithText("12 min · 3.4 km").assertIsDisplayed()
        rule.onNodeWithContentDescription("Bicycle").assertIsDisplayed()
        rule.runOnIdle { assertEquals(BICYCLE_GREEN, markerColour(row)) }
    }

    @Test
    fun bicycleTimelineRowsPanToTheirEndLocation() {
        var tapped = false
        val row = TimelineRow(
            kind = RowKind.BICYCLE,
            title = "Bike to Station",
            detail = "4 min · 1 km",
            time = null,
            at = LatLng(49.26, -123.12),
            endAt = LatLng(49.28, -123.11),
        )
        rule.setContent { MaterialTheme { TimelineItem(row) { tapped = true } } }
        rule.onNodeWithText("Bike to Station").performClick()
        rule.runOnIdle { assertTrue(tapped) }
    }

    @Test
    fun bicycleTransferTimelineNamesTheStationAndUsesTheBicycleIcon() {
        val row = TimelineRow(
            kind = RowKind.BICYCLE_TRANSFER,
            title = "Pick up bike at Waterfront Station",
            detail = null,
            time = "9:15",
            at = LatLng(49.28, -123.11),
        )
        rule.setContent { MaterialTheme { TimelineItem(row) {} } }

        rule.onNodeWithText("Pick up bike at Waterfront Station").assertIsDisplayed()
        rule.onNodeWithContentDescription("Bicycle transfer").assertIsDisplayed()
    }

    @Test
    fun driveTransitAndWalkMapColorsKeepTheirExistingStyles() {
        assertEquals(DRIVE_BLUE, mapLegStyle(TripMode.DRIVE, null).colour)
        assertEquals(WALK_GREY, mapLegStyle(TripMode.WALK, null).colour)
        assertEquals(LINE_FALLBACK, mapLegStyle(TripMode.TRANSIT, null).colour)
        assertEquals(
            androidx.compose.ui.graphics.Color(AndroidColor.parseColor("#0060A9")),
            mapLegStyle(TripMode.TRANSIT, "#0060A9").colour,
        )
    }

    @Test
    fun mapBicycleMarkerUsesTheBicycleColorAndIcon() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val bitmap = bicycleMarkerBitmap(context)
        var greenPixels = 0
        var whitePixels = 0
        for (x in 0 until bitmap.width) {
            for (y in 0 until bitmap.height) {
                when (bitmap.getPixel(x, y)) {
                    BICYCLE_GREEN.toArgb() -> greenPixels++
                    AndroidColor.WHITE -> whitePixels++
                }
            }
        }

        assertTrue(greenPixels > 100)
        assertTrue(whitePixels > 10)
    }
}
