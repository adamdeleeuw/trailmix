package com.example.cpen321application.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.cpen321application.ui.auth.SignInScreen
import com.example.cpen321application.ui.route.RouteScreen
import com.example.cpen321application.ui.main.MainScreen

import com.example.cpen321application.ui.questionnaire.QuestionnaireScreen

/** Shows the screen for [state]. Stateless, so tests can render any state directly. */
@Composable
fun TrailmixApp(
    state: AppState,
    isSigningIn: Boolean,
    signInError: String?,
    onSignIn: () -> Unit,
    onRetry: () -> Unit,
    onSignOut: () -> Unit,
) {
    Surface(Modifier.fillMaxSize()) {
        when (state) {
            AppState.Loading -> CenteredColumn { CircularProgressIndicator() }
            AppState.SignIn -> RouteScreen() // SWITCH BACK WHEN MERGING WITH MAIN
            AppState.Offline -> CenteredColumn {
                Text("Couldn't reach Trailmix. Check your connection.")
                Button(onClick = onRetry) { Text("Retry") }
            }
            is AppState.Questionnaire -> QuestionnaireScreen()
            is AppState.Main -> MainScreen(state.user, onSignOut)
        }
    }
}

/** A full-screen column that centers its content clear of the system bars. */
@Composable
fun CenteredColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
        content = content,
    )
}
