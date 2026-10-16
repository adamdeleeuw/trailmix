package com.example.cpen321application.ui.auth

import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import com.example.cpen321application.R
import com.example.cpen321application.ui.CenteredColumn

/**
 * The app name, tagline, and "Continue with Google" button.
 *
 * @param error Shown under the button, or nothing if `null`.
 */
@Composable
fun SignInScreen(isSigningIn: Boolean, error: String?, onSignIn: () -> Unit) {
    CenteredColumn {
        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.displayMedium)
        Text("Multimodal commuting solved", style = MaterialTheme.typography.titleMedium)
        Button(onClick = onSignIn, enabled = !isSigningIn) { Text("Continue with Google") }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center) }
    }
}
