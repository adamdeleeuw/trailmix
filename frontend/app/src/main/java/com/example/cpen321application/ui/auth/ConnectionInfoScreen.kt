package com.example.cpen321application.ui.auth

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.cpen321application.ui.home.HomeButton
import com.example.cpen321application.ui.home.HomeColors

/**
 * spec: page shown after sign-in. lists server ip/time, client ip/time,
 * the backend-provided name, and the signed-in google user's name. it sits on the same
 * watercolour wash as the home page and uses the same brown ink and button.
 */
@Composable
fun ConnectionInfoScreen(
    authViewModel: AuthViewModel,
    viewModel: ConnectionInfoViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    BackHandler(onBack = onBack)

    val token = authViewModel.sessionToken
    LaunchedEffect(token) {
        if (token != null) viewModel.load(token, authViewModel::onUnauthorized)
    }

    val user = authViewModel.session?.user
    val info = viewModel.info
    val pending = "..."

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically)
    ) {
        InfoRow("Server public IP", info?.serverIp ?: pending)
        InfoRow("Client IP", info?.clientIp ?: pending)
        InfoRow("Server time", info?.serverTime ?: pending)
        InfoRow("Client time", viewModel.clientTime.ifEmpty { pending })
        InfoRow("Server Owner", viewModel.myName ?: pending)
        InfoRow("Google user", user?.let { "${it.firstName} ${it.lastName}" } ?: pending)

        viewModel.errorMessage?.let {
            Text(
                text = it,
                color = HomeColors.Error,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        }

        HomeButton(text = "Back", onClick = onBack, modifier = Modifier.padding(top = 8.dp))
    }
}

/** spec: one labelled fact. the title is bold and small, the value heavier and larger below it. */
@Composable
private fun InfoRow(label: String, value: String) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = label,
            color = HomeColors.Ink,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.8.sp
        )
        Text(
            text = value,
            color = HomeColors.Ink,
            fontSize = 18.sp,
            fontWeight = FontWeight.SemiBold
        )
    }
}
