package com.example.cpen321application.e2e

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.espresso.Espresso.pressBack
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.example.cpen321application.data.Profile
import com.example.cpen321application.data.ProfileApi
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.User
import com.example.cpen321application.ui.questionnaire.QuestionnaireScreen
import com.example.cpen321application.ui.questionnaire.QuestionnaireViewModel
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** A backend that is never reached, since these tests only press Back. */
private object UnusedApi : ProfileApi {
    override suspend fun getMakes(sessionToken: String) = listOf("Toyota")
    override suspend fun getModels(sessionToken: String, make: String) = listOf("Corolla")
    override suspend fun saveProfile(sessionToken: String, profile: Profile): User = error("not used")
}

private object TokenStore : SessionStore {
    override suspend fun token() = "token"
    override suspend fun setToken(token: String?) = Unit
    override suspend fun pendingSignOuts() = emptySet<String>()
    override suspend fun endSession() = Unit
    override suspend fun forget(token: String) = Unit
}

/** Back on the questionnaire asks before leaving, since leaving signs the user out. */
@RunWith(AndroidJUnit4::class)
class QuestionnaireBackTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private var signedOut = false

    @Before
    fun setUp() {
        rule.setContent {
            QuestionnaireScreen(QuestionnaireViewModel(UnusedApi, TokenStore), onSaved = {}, onSignOut = { signedOut = true })
        }
    }

    @Test
    fun keepGoingClosesTheDialog() {
        pressBack()
        rule.onNodeWithText("Leave setup?").assertIsDisplayed()
        rule.onNodeWithText("Keep going").performClick()
        rule.onNodeWithText("Leave setup?").assertDoesNotExist()
        assertFalse(signedOut)
    }

    @Test
    fun backAgainClosesTheDialog() {
        pressBack()
        pressBack()
        rule.onNodeWithText("Leave setup?").assertDoesNotExist()
        assertFalse(signedOut)
    }

    @Test
    fun signOutSignsOut() {
        pressBack()
        rule.onNodeWithText("Sign out").performClick()
        assertTrue(signedOut)
    }
}
