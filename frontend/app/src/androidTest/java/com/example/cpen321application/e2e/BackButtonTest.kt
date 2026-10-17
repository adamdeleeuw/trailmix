package com.example.cpen321application.e2e

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.example.cpen321application.data.User
import com.example.cpen321application.ui.AppState
import com.example.cpen321application.ui.TrailmixApp
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Back exits the app from Sign-in, and after signing in it never returns to Sign-in. */
@RunWith(AndroidJUnit4::class)
class BackButtonTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private val user = User("1", "a@b.c", "Ada", null, true)

    private fun assertBackExits(state: AppState) {
        rule.setContent { TrailmixApp(state, isSigningIn = false, signInError = null, {}, {}, {}) {} }
        // with no screen handling Back, Android handles it and leaves the app
        assertFalse(rule.activity.onBackPressedDispatcher.hasEnabledCallbacks())
    }

    @Test
    fun backOnSignInExitsApp() = assertBackExits(AppState.SignIn)

    @Test
    fun backOnMainExitsApp() = assertBackExits(AppState.Main(user))
}
