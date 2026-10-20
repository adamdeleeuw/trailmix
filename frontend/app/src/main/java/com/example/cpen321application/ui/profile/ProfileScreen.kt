package com.example.cpen321application.ui.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.GasPrice
import com.example.cpen321application.data.User
import com.example.cpen321application.data.Vehicle
import com.example.cpen321application.ui.CenteredColumn
import com.example.cpen321application.ui.commute.fareDescription
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// Locale.US so dates and numbers always look like "Oct 14, 2026" and "189.9", whatever the phone's language
private val SAVED_DATE_FORMAT = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)

/** "7.2 L/100 km". */
fun fuelDescription(vehicle: Vehicle) = String.format(Locale.US, "%.1f L/100 km", vehicle.litresPer100km)

/** "189.9 ¢/L, updated Oct 14, 2026", with the date in the user's timezone. */
fun gasPriceDescription(price: GasPrice, timezone: String?): String {
    val zone = timezone?.let(ZoneId::of) ?: ZoneId.systemDefault()
    val date = SAVED_DATE_FORMAT.format(price.savedAt.atZone(zone))
    return String.format(Locale.US, "%.1f ¢/L, updated %s", price.centsPerLitre, date)
}

/**
 * The Profile tab: the user's account, vehicle, transit fare, and last gas price,
 * with buttons to edit them, sign out, and delete the account.
 *
 * @param onEdit Opens the edit screen for a section, filled in from the user.
 * @param onSignOut Signs the user out, from the Sign out dialog or when the session is no longer valid.
 * @param onDeleted Signs the user out after the account is deleted.
 */
@Composable
fun ProfileScreen(
    viewModel: ProfileViewModel,
    onEdit: (ProfileSection, User) -> Unit,
    onSignOut: () -> Unit,
    onDeleted: () -> Unit,
) {
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(Unit) { viewModel.loadIfNeeded(onSignOut) }
    LaunchedEffect(viewModel.showSavedMessage) {
        if (viewModel.showSavedMessage) {
            viewModel.savedMessageShown()
            snackbar.showSnackbar("Saved")
        }
    }

    Box(Modifier.fillMaxSize()) {
        when (val state = viewModel.state) {
            ProfileState.Loading -> CenteredColumn { CircularProgressIndicator() }
            ProfileState.Failed -> CenteredColumn {
                Text("Couldn't load your profile.")
                Button(onClick = { viewModel.load(onSignOut) }) { Text("Retry") }
            }
            is ProfileState.Loaded -> ProfileContent(state.user, viewModel, onEdit)
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
    }

    ProfileDialogs(viewModel, onSignOut, onDeleted)
}

// one scrolling column: account, vehicle, transit, gas price, then the account buttons
@Composable
private fun ProfileContent(user: User, viewModel: ProfileViewModel, onEdit: (ProfileSection, User) -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            ProfilePhoto(user.photoUrl, user.name)
            Column {
                Text(user.name, style = MaterialTheme.typography.titleLarge)
                Text(user.email, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        HorizontalDivider()
        Section("Vehicle", "Edit", { onEdit(ProfileSection.VEHICLE, user) }) {
            val vehicle = user.vehicle
            if (vehicle == null) {
                Text("You don't drive")
            } else {
                Text("${vehicle.make} ${vehicle.model}")
                vehicle.colour?.let { Text(it) }
                Text(fuelDescription(vehicle))
            }
        }
        Section("Transit", "Edit", { onEdit(ProfileSection.TRANSIT, user) }) {
            Text(fareDescription(user.transit) ?: "You don't take transit")
        }
        if (user.vehicle != null) {
            Section("Last gas price", "Update", { viewModel.openDialog(ProfileDialog.GAS_PRICE) }) {
                Text(user.lastGasPrice?.let { gasPriceDescription(it, user.timezone) } ?: "Not set")
            }
        }
        HorizontalDivider()
        OutlinedButton(onClick = { viewModel.openDialog(ProfileDialog.SIGN_OUT) }, Modifier.fillMaxWidth()) {
            Text("Sign out")
        }
        Button(
            onClick = { viewModel.openDialog(ProfileDialog.DELETE_ACCOUNT) },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
        ) { Text("Delete account") }
    }
}

// a titled block of the profile, with a button beside the title
@Composable
private fun Section(
    title: String,
    action: String,
    onAction: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            TextButton(onClick = onAction) { Text(action) }
        }
        content()
    }
}
