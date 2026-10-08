package com.example.cpen321application

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.example.cpen321application.ui.home.Screen
import com.example.cpen321application.ui.home.onWatercolor
import com.example.cpen321application.ui.home.watercolorWash
import com.example.cpen321application.ui.theme.CPEN321ApplicationTheme
import androidx.activity.viewModels
import com.example.cpen321application.ui.home.MainScreen
import com.example.cpen321application.ui.home.MainViewModel
import com.example.cpen321application.ui.auth.AuthViewModel
import com.example.cpen321application.ui.auth.ConnectionInfoViewModel
import com.example.cpen321application.ui.penalty.PenaltyViewModel
import com.example.cpen321application.ui.timer.TimerViewModel
import com.example.cpen321application.ui.websocket.WebSocketViewModel

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()
    private val authViewModel: AuthViewModel by viewModels()
    private val timerViewModel: TimerViewModel by viewModels()
    private val penaltyViewModel: PenaltyViewModel by viewModels()
    private val webSocketViewModel: WebSocketViewModel by viewModels()
    private val connectionInfoViewModel: ConnectionInfoViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CPEN321ApplicationTheme {
                // both the dark pages and the watercolour run edge to edge, behind the system bars
                val darkPage = viewModel.screen == Screen.TIMER || timerViewModel.finished
                // the wash carries the auth and websocket pages, so they read as part of home
                val washed = !timerViewModel.finished && viewModel.screen.onWatercolor

                Scaffold(
                    modifier = Modifier.fillMaxSize().let { if (washed) it.watercolorWash() else it },
                    containerColor = when {
                        darkPage -> Color.Black
                        washed -> Color.Transparent // the wash behind the Scaffold shows through
                        else -> MaterialTheme.colorScheme.background
                    }
                ) { innerPadding ->
                    MainScreen(
                        viewModel = viewModel,
                        authViewModel = authViewModel,
                        timerViewModel = timerViewModel,
                        penaltyViewModel = penaltyViewModel,
                        webSocketViewModel = webSocketViewModel,
                        connectionInfoViewModel = connectionInfoViewModel,
                        modifier = Modifier.padding(innerPadding)
                        )
                }
            }
        }
    }
}
