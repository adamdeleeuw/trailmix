package com.example.cpen321application.ui.websocket

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.cpen321application.ui.home.HomeButton
import com.example.cpen321application.ui.home.HomeColors
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

private const val CONNECTED_HOLD_MILLIS = 1_500L
private const val FADE_MILLIS = 400
private val BannerHeight = 44.dp

/**
 * spec: page opened by the websocket button. it sits on the home watercolour wash and shows a
 * centred connection banner over a walnut-framed 16x16 canvas that starts blank and paints one
 * cell per pixel update as it arrives.
 */
@Composable
fun WebSocketScreen(
    viewModel: WebSocketViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    BackHandler(onBack = onBack)

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically)
    ) {
        SocketBanner(viewModel.socketStatus)

        WalnutFrame {
            PixelGrid(
                cells = viewModel.grid,
                modifier = Modifier.fillMaxWidth().aspectRatio(1f)
            )
        }

        HomeButton(text = "Back", onClick = onBack, compact = true)
    }
}

/**
 * spec: the connection banner, centred in the strip above the canvas. a beat after the
 * handshake it fades out and gives its space back, so a live canvas stands on its own.
 */
@Composable
private fun SocketBanner(status: SocketStatus) {
    // the hold restarts with every status, so a later drop brings the banner back
    var held by remember(status) { mutableStateOf(true) }
    LaunchedEffect(status) {
        if (status == SocketStatus.Connected) {
            delay(CONNECTED_HOLD_MILLIS)
            held = false
        }
    }

    AnimatedVisibility(
        visible = held,
        enter = fadeIn(),
        // the fade is the only exit, so the strip leaves the layout the moment it finishes
        exit = fadeOut(tween(FADE_MILLIS))
    ) {
        val (label, tint) = status.banner()
        Box(
            modifier = Modifier.fillMaxWidth().height(BannerHeight),
            contentAlignment = Alignment.Center
        ) {
            Text(text = label, color = tint, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** the words and the colour for one state; the two live states are what the page is about. */
private fun SocketStatus.banner(): Pair<String, Color> = when (this) {
    SocketStatus.Connecting -> "Connecting..." to WebSocketColors.Connecting
    SocketStatus.Connected -> "Connected" to WebSocketColors.Connected
    SocketStatus.Disconnected -> "Disconnected" to HomeColors.Error
    SocketStatus.Idle -> "Not connected" to HomeColors.Ink
}

@Composable
private fun PixelGrid(cells: List<Color>, modifier: Modifier = Modifier) {
    // cells are read inside the draw block, so a paint redraws the canvas without recomposing
    Canvas(modifier = modifier) {
        val cell = size.width / GRID_SIZE
        // rounding the shared edges (not the cell size) tiles the grid with no gaps or overlaps
        fun edge(i: Int) = (i * cell).roundToInt().toFloat()

        for (row in 0 until GRID_SIZE) {
            for (col in 0 until GRID_SIZE) {
                drawRect(
                    color = cells[row * GRID_SIZE + col],
                    topLeft = Offset(edge(col), edge(row)),
                    size = Size(edge(col + 1) - edge(col), edge(row + 1) - edge(row))
                )
            }
        }
    }
}
