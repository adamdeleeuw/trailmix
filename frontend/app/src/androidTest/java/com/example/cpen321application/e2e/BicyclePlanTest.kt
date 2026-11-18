package com.example.cpen321application.e2e

import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasProgressBarRangeInfo
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextReplacement
import android.view.KeyEvent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.SdkSuppress
import androidx.test.platform.app.InstrumentationRegistry
import com.example.cpen321application.MainActivity
import com.example.cpen321application.data.BackendApi
import com.example.cpen321application.data.DataStoreSessionStore
import com.example.cpen321application.data.LOCATION_PERMISSIONS
import com.example.cpen321application.data.PlanningPreferences
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.ui.planning.BICYCLE_GREEN
import com.example.cpen321application.ui.planning.ROUTE_SERVICE_DOWN
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

private const val LOAD_TIMEOUT_MS = 15_000L
private const val PLAN_TIMEOUT_MS = 30_000L
private const val DESTINATION = "Waterfront Station"
private const val ORIGIN = "Commercial Drive, Vancouver"
private const val BICYCLE_ONLY_ORIGIN = "Vancouver City Centre Station"
private const val BIKE_TO_TRANSIT_ORIGIN = "Commercial Drive, Vancouver"
private const val BIKE_TO_TRANSIT_DESTINATION = "University of British Columbia"
private const val TRANSIT_TO_BIKE_ORIGIN = "University of British Columbia"
private const val TRANSIT_TO_BIKE_DESTINATION = "Vancouver Convention Centre"

private val MAP_TAB = hasText("Map") and hasClickAction()
private val ROUTE_ROW = hasClickAction() and
    (hasText("Cheapest") or hasText("Fastest") or hasText("Balanced"))
private val LOADING = hasProgressBarRangeInfo(androidx.compose.ui.semantics.ProgressBarRangeInfo.Indeterminate)
private val ROUTE_WITH_BICYCLE = ROUTE_ROW and hasText("Bike", substring = true)

/**
 * Bicycle planning E2E tests against the configured backend and Google routing services.
 *
 * These tests require a signed-in emulator account, and use Google Places for search and
 * the backend's configured Routes API for journey geometry. They are intentionally not run
 * in standard CI.
 */
@SdkSuppress(minSdkVersion = 28)
@RunWith(AndroidJUnit4::class)
class BicyclePlanTest {
    @get:Rule
    val rule = createEmptyComposeRule()

    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private lateinit var token: String
    private lateinit var originalPreferences: PlanningPreferences
    private var scenario: ActivityScenario<MainActivity>? = null

    @Before
    fun setUp() {
        token = runBlocking { DataStoreSessionStore(context).token() }
            ?: error("Sign in inside the app on the emulator before running E2E tests")
        originalPreferences = runBlocking { BackendApi.getPlanningPreferences(token) }
        runBlocking {
            BackendApi.savePlanningPreferences(
                token,
                originalPreferences.copy(defaultModes = setOf(TripMode.TRANSIT)),
            )
        }
        LOCATION_PERMISSIONS.forEach {
            instrumentation.uiAutomation.grantRuntimePermission(context.packageName, it)
        }
        launchApp()
        rule.waitUntil(LOAD_TIMEOUT_MS) { exists(MAP_TAB) }
    }

    @After
    fun tearDown() {
        scenario?.close()
        if (::token.isInitialized && ::originalPreferences.isInitialized) {
            runBlocking { BackendApi.savePlanningPreferences(token, originalPreferences) }
        }
    }

    @Test
    fun bikeAndTransitProducesARealBicycleJourneyOnTheMapAndTimeline() {
        openPlanningTo(DESTINATION)
        chooseStart(ORIGIN)
        enableBikeKeepTransit()
        waitForPlan()

        val routeIndex = findMixedBikeTransitRoute()
        rule.onAllNodes(ROUTE_WITH_BICYCLE)[routeIndex].performClick()

        rule.onNodeWithText("Bike to", substring = true).assertIsDisplayed()
        rule.onNodeWithContentDescription("Bicycle").assertIsDisplayed()
        rule.onNode(hasContentDescription("Bicycle leg", substring = true)).assertIsDisplayed()
        assertTimelineBicycleIconIsGreen()

        val hasBikeTransfer = exists(hasText("Lock bike at", substring = true)) ||
            exists(hasText("Pick up bike at", substring = true))
        val hasTransitLeg = exists(hasText("Get off at", substring = true))
        assertTrue("The backend result should include both bicycle and transit legs", hasBikeTransfer && hasTransitLeg)
    }

    @Test
    fun bicycleOnlyJourneyCanBePlannedAndDisplayed() {
        openPlanningTo(DESTINATION)
        chooseStart(BICYCLE_ONLY_ORIGIN)
        openModes()
        rule.onNodeWithText("Bike").performClick()
        rule.onNodeWithText("Transit").performClick()
        dismissModes()
        waitForPlan()

        rule.onAllNodes(ROUTE_WITH_BICYCLE).onFirst().performClick()

        rule.onNodeWithText("Bike to", substring = true).assertIsDisplayed()
        rule.onNodeWithContentDescription("Bicycle").assertIsDisplayed()
        assertTimelineBicycleIconIsGreen()
        rule.onAllNodes(hasText("Get off at", substring = true)).assertCountEquals(0)
    }

    @Test
    fun bikeToTransitJourneyShowsTheBicycleHandoffBeforeBoarding() {
        openPlanningTo(BIKE_TO_TRANSIT_DESTINATION)
        chooseStart(BIKE_TO_TRANSIT_ORIGIN)
        enableBikeKeepTransit()
        waitForPlan()

        val routeIndex = findMixedBikeTransitRoute()
        rule.onAllNodes(ROUTE_WITH_BICYCLE)[routeIndex].performClick()

        rule.onNodeWithText("Lock bike at", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Get off at", substring = true).assertIsDisplayed()
        val lockPosition = firstNodePosition("Lock bike at")
        val transitPosition = firstNodePosition("Board at")
        assertTrue("The bicycle handoff must precede transit boarding", lockPosition < transitPosition)
        rule.onNodeWithContentDescription("Bicycle").assertIsDisplayed()
        rule.onNode(hasContentDescription("Bicycle leg", substring = true)).assertIsDisplayed()
    }

    @Test
    fun transitToBikeJourneyShowsTheBicycleHandoffAfterAlighting() {
        openPlanningTo(TRANSIT_TO_BIKE_DESTINATION)
        chooseStart(TRANSIT_TO_BIKE_ORIGIN)
        enableBikeKeepTransit()
        waitForPlan()

        val routeIndex = findMixedBikeTransitRoute()
        rule.onAllNodes(ROUTE_WITH_BICYCLE)[routeIndex].performClick()

        rule.onNodeWithText("Pick up bike at", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Bike to", substring = true).assertIsDisplayed()
        val alightPosition = firstNodePosition("Get off at")
        val pickupPosition = firstNodePosition("Pick up bike at")
        assertTrue("The bicycle should be retrieved after transit", alightPosition < pickupPosition)
        rule.onNodeWithContentDescription("Bicycle").assertIsDisplayed()
        rule.onNode(hasContentDescription("Bicycle leg", substring = true)).assertIsDisplayed()
    }

    @Test
    fun savedBikeAndTransitPreferencesAreRestoredAfterRelaunch() {
        openPlanningTo(DESTINATION)
        chooseStart(ORIGIN)
        enableBikeKeepTransit()
        waitForPlan()

        runBlocking {
            BackendApi.savePlanningPreferences(
                token,
                originalPreferences.copy(defaultModes = setOf(TripMode.BICYCLE, TripMode.TRANSIT)),
            )
        }
        scenario?.close()
        launchApp()
        rule.waitUntil(LOAD_TIMEOUT_MS) { exists(MAP_TAB) }
        openPlanningTo(DESTINATION)
        chooseStart(ORIGIN)
        waitForPlan()

        val routeIndex = findMixedBikeTransitRoute()
        rule.onAllNodes(ROUTE_WITH_BICYCLE)[routeIndex].performClick()
        rule.onNodeWithText("Bike to", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Get off at", substring = true).assertIsDisplayed()
    }

    @Test
    fun driveOnlyAndTransitOnlyPlanningRemainAvailable() {
        openPlanningTo(DESTINATION)
        chooseStart(ORIGIN)

        openModes()
        rule.onNodeWithText("Drive").performClick()
        rule.onNodeWithText("Transit").performClick()
        dismissModes()
        waitForPlan()
        assertTrue("Expected a DRIVE-only route", exists(hasText("Drive", substring = true)))

        openModes()
        rule.onNodeWithText("Transit").performClick()
        rule.onNodeWithText("Drive").performClick()
        dismissModes()
        waitForPlan()
        assertTrue("Expected a TRANSIT-only route", exists(hasText("Transit", substring = true)))
    }

    private fun launchApp() {
        scenario = ActivityScenario.launch(MainActivity::class.java)
    }

    private fun openPlanningTo(place: String) {
        pickPlace(place)
        rule.waitUntil(LOAD_TIMEOUT_MS) { exists(hasText("Directions")) }
        rule.onNodeWithText("Directions").performClick()
    }

    private fun chooseStart(place: String) {
        rule.onNode((hasText("Your location") or hasText("Choose start point")) and hasClickAction())
            .performClick()
        pickPlace(place)
    }

    private fun pickPlace(name: String) {
        rule.onNode(hasSetTextAction()).performTextReplacement(name)
        val suggestion = hasText(name, substring = true) and hasClickAction() and !hasSetTextAction()
        rule.waitUntil(LOAD_TIMEOUT_MS) { exists(suggestion) }
        rule.onAllNodes(suggestion).onFirst().performClick()
    }

    private fun openModes() {
        rule.onNodeWithText("Modes ▾").performClick()
    }

    private fun enableBikeKeepTransit() {
        openModes()
        rule.onNodeWithText("Bike").performClick()
        dismissModes()
    }

    private fun dismissModes() {
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
    }

    private fun waitForPlan() {
        rule.waitUntil(PLAN_TIMEOUT_MS) {
            !exists(LOADING) && (exists(ROUTE_ROW) || exists(hasText("No routes found")) ||
                exists(hasText(ROUTE_SERVICE_DOWN)))
        }
        rule.onNodeWithText(ROUTE_SERVICE_DOWN).assertDoesNotExist()
        rule.onAllNodes(ROUTE_ROW).onFirst().assertIsDisplayed()
    }

    private fun findMixedBikeTransitRoute(): Int {
        rule.waitUntil(PLAN_TIMEOUT_MS) {
            rule.onAllNodes(ROUTE_WITH_BICYCLE).fetchSemanticsNodes().isNotEmpty()
        }
        val routeNodes = rule.onAllNodes(ROUTE_WITH_BICYCLE)
        for (index in routeNodes.fetchSemanticsNodes().indices) {
            routeNodes[index].performClick()
            val hasBicycleAndTransit = exists(hasText("Bike to", substring = true)) &&
                exists(hasText("Get off at", substring = true))
            if (hasBicycleAndTransit) return index
            rule.onNodeWithContentDescription("Back").performClick()
        }
        error("No returned route contained both a bicycle leg and a transit leg")
    }

    private fun assertTimelineBicycleIconIsGreen() {
        val bitmap = rule.onNodeWithContentDescription("Bicycle").captureToImage().asAndroidBitmap()
        val expected = BICYCLE_GREEN.toArgb()
        val containsGreen = (0 until bitmap.height).any { y ->
            (0 until bitmap.width).any { x -> bitmap.getPixel(x, y) == expected }
        }
        assertTrue("The bicycle timeline icon should use its distinct green color", containsGreen)
    }

    private fun firstNodePosition(text: String): Float =
        rule.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes()
            .firstOrNull()?.boundsInRoot?.top
            ?: error("Expected timeline row containing '$text'")

    private fun exists(matcher: SemanticsMatcher) =
        rule.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()
}
