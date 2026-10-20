package com.example.cpen321application.e2e

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.espresso.Espresso.pressBack
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.example.cpen321application.ui.main.MainScreen
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** The nav bar's tabs, their memory, and Back between them and the edit screen. */
@RunWith(AndroidJUnit4::class)
class NavBarTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    @Before
    fun setUp() {
        rule.setContent {
            MainScreen(
                profile = { onEdit ->
                    // a stand-in Profile tab with a counter, to check the tab keeps its place
                    var taps by rememberSaveable { mutableIntStateOf(0) }
                    Column(Modifier.verticalScroll(rememberScrollState())) {
                        Text("Profile taps: $taps")
                        Button(onClick = { taps += 1 }) { Text("Tap") }
                        Button(onClick = onEdit) { Text("Edit") }
                    }
                },
                editProfile = { Text("Edit screen") },
            )
        }
    }

    @Test
    fun opensOnMapWithMapSelected() {
        rule.onNodeWithText("Tap to set start").assertIsDisplayed() // the route planner, before any point is set
        rule.onNodeWithText("Map").assertIsSelected()
    }

    @Test
    fun backFromHistoryOrProfileGoesToMap() {
        for (tab in listOf("History", "Profile")) {
            rule.onNodeWithText(tab).performClick()
            rule.onNodeWithText(tab).assertIsSelected()
            pressBack()
            rule.onNodeWithText("Map").assertIsSelected()
        }
        // back on Map is left to Android, which exits the app
        assertFalse(rule.activity.onBackPressedDispatcher.hasEnabledCallbacks())
    }

    @Test
    fun tabKeepsItsPlaceWhenSwitchingAwayAndBack() {
        rule.onNodeWithText("Profile").performClick()
        rule.onNodeWithText("Tap").performClick()
        rule.onNodeWithText("History").performClick()
        rule.onNodeWithText("Profile").performClick()
        rule.onNodeWithText("Profile taps: 1").assertIsDisplayed()
    }

    @Test
    fun barIsHiddenOnTheEditScreenAndBackReturnsToProfile() {
        rule.onNodeWithText("Profile").performClick()
        rule.onNodeWithText("Edit").performClick()
        rule.onNodeWithText("Edit screen").assertIsDisplayed()
        rule.onNodeWithText("Map").assertDoesNotExist()
        pressBack()
        rule.onNodeWithText("Profile taps: 0").assertIsDisplayed()
    }
}
