package com.example.cpen321application.ui.main
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.example.cpen321application.data.User
import com.example.cpen321application.ui.CenteredColumn

/** Placeholder until the nav bar (#11) replaces it. The Sign out button moves to the Profile tab then. */
@Composable
fun MainScreen(user: User, onSignOut: () -> Unit) {
    CenteredColumn {
        Text("Signed in as ${user.name}")
        Button(onClick = onSignOut) { Text("Sign out") }
    }
}
