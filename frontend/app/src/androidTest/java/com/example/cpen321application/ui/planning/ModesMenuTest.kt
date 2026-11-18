package com.example.cpen321application.ui.planning

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.example.cpen321application.data.DEFAULT_PLANNING_PREFERENCES
import com.example.cpen321application.data.PlanRequest
import com.example.cpen321application.data.PlannerApi
import com.example.cpen321application.data.PlanningPreferences
import com.example.cpen321application.data.PlanningPreferencesApi
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.TripMode
import com.example.cpen321application.data.TripPlan
import com.google.android.gms.maps.model.LatLng
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class ModesMenuTest {
    @get:Rule
    val rule = createComposeRule()

    private val planner = PlanningViewModel(
        api = object : PlannerApi {
            override suspend fun planTrip(sessionToken: String?, trip: PlanRequest) = TripPlan(emptyList(), emptyList())
        },
        preferencesApi = object : PlanningPreferencesApi {
            override suspend fun getPlanningPreferences(sessionToken: String?) = DEFAULT_PLANNING_PREFERENCES
            override suspend fun savePlanningPreferences(sessionToken: String?, preferences: PlanningPreferences) = preferences
        },
        store = object : SessionStore {
            override suspend fun token() = "token"
            override suspend fun setToken(token: String?) = Unit
            override suspend fun pendingSignOuts() = emptySet<String>()
            override suspend fun endSession() = Unit
            override suspend fun forget(token: String) = Unit
        },
    )

    @Test
    fun bikeIsSelectableAndCanBeUsedAloneOrWithExistingModes() {
        rule.setContent { MaterialTheme { ModesMenu(planner) } }
        rule.onNodeWithText("Modes ▾").performClick()

        rule.onNodeWithText("Bike").assertIsDisplayed()
        rule.onNodeWithText("Coming soon").assertDoesNotExist()
        rule.onNodeWithText("Bike").performClick()
        rule.runOnIdle {
            assertEquals(setOf(TripMode.DRIVE, TripMode.TRANSIT, TripMode.BICYCLE), planner.modes)
        }

        rule.onNodeWithText("Drive").performClick()
        rule.onNodeWithText("Transit").performClick()
        rule.runOnIdle { assertEquals(setOf(TripMode.BICYCLE), planner.modes) }
    }
}
