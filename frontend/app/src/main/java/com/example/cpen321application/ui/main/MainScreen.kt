package com.example.cpen321application.ui.main

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.User
import com.example.cpen321application.ui.route.RouteScreen

@Composable
fun MainScreen(
    user: User,
    tripHistory: TripHistoryViewModel,
    onSignOut: () -> Unit,
    onUnauthorized: () -> Unit,
) {
    var showingInsights by rememberSaveable { mutableStateOf<Boolean?>(null) }
    Column(Modifier.fillMaxSize()) {
        RouteScreen(Modifier.weight(1f))
        Card(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Button(onClick = { showingInsights = false }, modifier = Modifier.weight(1f)) {
                    Text("Trip history")
                }
                Button(onClick = { showingInsights = true }, modifier = Modifier.weight(1f)) {
                    Text("Commute insights")
                }
                Button(onClick = onSignOut, modifier = Modifier.weight(1f)) {
                    Text("Sign out")
                }
            }
        }
    }
    showingInsights?.let { insights ->
        TripHistoryDialog(
            viewModel = tripHistory,
            insights = insights,
            onDismiss = { showingInsights = null },
            onUnauthorized = onUnauthorized,
        )
    }
}