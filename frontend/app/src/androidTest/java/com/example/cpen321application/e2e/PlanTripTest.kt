package com.example.cpen321application.e2e

import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
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
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.SdkSuppress
import androidx.test.platform.app.InstrumentationRegistry
import com.example.cpen321application.MainActivity
import com.example.cpen321application.data.BackendApi
import com.example.cpen321application.data.DataStoreSessionStore
import com.example.cpen321application.data.LOCATION_PERMISSIONS
import com.example.cpen321application.ui.planning.ROUTE_SERVICE_DOWN
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

private const val LOAD_TIMEOUT_MS = 15_000L // signing in from the saved session, a Places search, or saving a spot
private const val PLAN_TIMEOUT_MS = 30_000L // the Planner calls Google Routes several times
private const val MAX_ROUTES = 3

private const val START = "University of British Columbia"
private const val DESTINATION = "Waterfront Station"
private const val SPOT_PLACE = "Metropolis at Metrotown"
private const val TEST_SPOT = "Trailmix e2e spot" // the label of the spot these tests save, so cleanup removes only it
private const val NO_SPOTS_BANNER = "Save a parking spot to plan driving trips"

private val MAP_TAB = hasText("Map") and hasClickAction()
private val ROUTE_ROW = hasClickAction() and (hasText("Cheapest") or hasText("Fastest") or hasText("Balanced"))
private val LOADING = hasProgressBarRangeInfo(ProgressBarRangeInfo.Indeterminate)
private val ARRIVE_BY_TOMORROW = hasText("Arrive by", substring = true) and hasText("tomorrow", substring = true)

/**
 * End-to-end tests for the Plan multimodal trip and Preview route use cases (#73), against the
 * real backend, Google Places and Google Routes, with nothing mocked.
 *
 * Before running, sign in inside the app on the emulator (`scripts/run-frontend-e2e-tests` waits
 * for this). The account must have finished the questionnaire, have no saved parking spots and
 * no active trip, and keep the default modes (Drive and Transit). The tests save their own
 * parking spot through the app and remove it afterwards.
 */
@SdkSuppress(minSdkVersion = 28) // for UiAutomation.grantRuntimePermission
@RunWith(AndroidJUnit4::class)
class PlanTripTest {
    @get:Rule
    val rule = createEmptyComposeRule()

    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private lateinit var token: String
    private var scenario: ActivityScenario<MainActivity>? = null

    @Before
    fun setUp() {
        token = runBlocking { DataStoreSessionStore(context).token() }
            ?: error("Sign in inside the app on the emulator before running the e2e tests")
        removeTestSpots() // left behind by a run that stopped early
        // allowed up front, since the system prompt is outside the app and Compose can't tap it
        LOCATION_PERMISSIONS.forEach { instrumentation.uiAutomation.grantRuntimePermission(context.packageName, it) }
        scenario = ActivityScenario.launch(MainActivity::class.java)
        rule.waitUntil(LOAD_TIMEOUT_MS) { exists(MAP_TAB) }
    }

    @After
    fun tearDown() {
        scenario?.close()
        if (::token.isInitialized) removeTestSpots()
    }

    /** Plan multimodal trip, failure: Drive is on but the user has no parking spots, so a banner says to save one. */
    @Test
    fun driveWithNoParkingSpotsShowsTheBanner() {
        val spots = runBlocking { BackendApi.getParkingSpots(token) }
        assertTrue("The test account must have no saved parking spots", spots.isEmpty())
        openPlanningTo(DESTINATION)
        chooseStart(START)
        waitForPlan()

        rule.onNodeWithText(NO_SPOTS_BANNER).assertIsDisplayed()
        rule.onNodeWithText("Back to map").performClick()
        rule.onNodeWithText("Directions").assertIsDisplayed() // the destination's place sheet again
    }

    /**
     * Plan multimodal trip and Preview route, success: plans with a saved spot, previews a route,
     * and goes back to the same routes.
     */
    @Test
    fun plansUpToThreeRoutesAndPreviewsOne() {
        saveSpot(SPOT_PLACE)
        openPlanningTo(DESTINATION)
        chooseStart(START)
        setArriveByTomorrow()
        waitForPlan()

        rule.onNodeWithText(NO_SPOTS_BANNER).assertDoesNotExist()
        val routes = rule.onAllNodes(ROUTE_ROW).fetchSemanticsNodes().size
        assertTrue("Expected 1 to $MAX_ROUTES routes, got $routes", routes in 1..MAX_ROUTES)

        rule.onAllNodes(ROUTE_ROW).onFirst().performClick()
        rule.onNodeWithText("Start").assertIsDisplayed()
        rule.onNodeWithText("Save for later").assertIsDisplayed()
        rule.onNode(hasText("Leave ", substring = true) and hasClickAction()).assertIsDisplayed()
        val arrive = hasText("Arrive at ", substring = true)
        rule.onNode(hasScrollToNodeAction()).performScrollToNode(arrive) // the timeline's last row
        rule.onNode(arrive).assertIsDisplayed()

        rule.onNodeWithContentDescription("Back").performClick()
        rule.onAllNodes(ROUTE_ROW).assertCountEquals(routes)
        rule.onNode(ARRIVE_BY_TOMORROW).assertIsDisplayed()
        rule.onNode(LOADING).assertDoesNotExist() // the same routes, not a new plan
    }

    // searches the Map tab for a place and taps Directions on its sheet
    private fun openPlanningTo(place: String) {
        pickPlace(place)
        rule.waitUntil(LOAD_TIMEOUT_MS) { exists(hasText("Directions")) }
        rule.onNodeWithText("Directions").performClick()
    }

    // taps the trip's start (the user's location, or "Choose start point" without one) and searches for [place]
    private fun chooseStart(place: String) {
        rule.onNode((hasText("Your location") or hasText("Choose start point")) and hasClickAction()).performClick()
        pickPlace(place)
    }

    // sets Arrive by to the time picker's default (9:00) tomorrow
    private fun setArriveByTomorrow() {
        rule.onNodeWithText("Leave now ▾").performClick()
        rule.onNodeWithText("Tomorrow").performClick()
        rule.onNodeWithText("Set").performClick()
        rule.onNode(ARRIVE_BY_TOMORROW).assertIsDisplayed()
    }

    // waits for the latest plan to finish, and fails if the route service couldn't be reached
    private fun waitForPlan() {
        rule.waitUntil(PLAN_TIMEOUT_MS) {
            !exists(LOADING) && (exists(ROUTE_ROW) || exists(hasText(ROUTE_SERVICE_DOWN)))
        }
        rule.onNodeWithText(ROUTE_SERVICE_DOWN).assertDoesNotExist()
    }

    // saves [place] as a parking spot through its place sheet, then closes the sheet
    private fun saveSpot(place: String) {
        pickPlace(place)
        val saveButton = hasText("Save as parking spot") and hasClickAction() // not the dialog's title
        rule.waitUntil(LOAD_TIMEOUT_MS) { exists(saveButton) }
        rule.onNode(saveButton).performClick()
        rule.onNode(hasText("Name") and hasSetTextAction()).performTextReplacement(TEST_SPOT)
        rule.onNodeWithText("Save").performClick()
        rule.waitUntil(LOAD_TIMEOUT_MS) { exists(hasText("Remove parking spot")) }
        // closes this place, so the next search can't find its Directions button
        rule.onNodeWithContentDescription("Clear search").performClick()
    }

    // types [name] into the search box on screen and taps the first suggestion that contains it
    private fun pickPlace(name: String) {
        rule.onNode(hasSetTextAction()).performTextReplacement(name)
        val suggestion = hasText(name, substring = true) and hasClickAction() and !hasSetTextAction()
        rule.waitUntil(LOAD_TIMEOUT_MS) { exists(suggestion) }
        rule.onAllNodes(suggestion).onFirst().performClick()
    }

    // whether any node on screen matches [matcher]
    private fun exists(matcher: SemanticsMatcher) = rule.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()

    // deletes the parking spots these tests saved, straight through the backend
    private fun removeTestSpots() = runBlocking {
        BackendApi.getParkingSpots(token)
            .filter { it.details.label == TEST_SPOT }
            .forEach { BackendApi.deleteParkingSpot(token, it.id) }
    }
}
