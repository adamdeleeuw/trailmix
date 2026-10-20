package com.example.cpen321application.ui.main

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.User
import com.example.cpen321application.ui.route.RouteScreen

/** Placeholder until the nav bar (#11) replaces it. The Sign out button moves to the Profile tab then. */
@Composable
fun MainScreen(user: User, onSignOut: () -> Unit) {
    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        RouteScreen(Modifier.weight(1f))
        Button(
            onClick = onSignOut,
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(16.dp),
        ) { Text("Sign out") }
    }
}