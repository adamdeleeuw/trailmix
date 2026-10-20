package com.example.cpen321application.ui.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import com.example.cpen321application.ui.commute.ErrorText
import com.example.cpen321application.ui.components.DecimalDigitsField

private val SPINNER_SIZE = 20.dp

/** Shows the Profile tab's open dialog, if any. Back closes it, except while the account is being deleted. */
@Composable
fun ProfileDialogs(viewModel: ProfileViewModel, onSignOut: () -> Unit, onDeleted: () -> Unit) {
    when (viewModel.dialog) {
        ProfileDialog.GAS_PRICE -> GasPriceDialog(viewModel, onSignOut)
        ProfileDialog.SIGN_OUT -> SignOutDialog(onCancel = viewModel::closeDialog, onSignOut = onSignOut)
        ProfileDialog.DELETE_ACCOUNT -> DeleteAccountDialog(viewModel, onSignOut, onDeleted)
        null -> Unit
    }
}

// one digits-only field with the decimal placed automatically, like fuel consumption
@Composable
private fun GasPriceDialog(viewModel: ProfileViewModel, onUnauthorized: () -> Unit) {
    AlertDialog(
        onDismissRequest = viewModel::closeDialog,
        title = { Text("Last gas price") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                DecimalDigitsField(
                    digits = viewModel.gasDigits,
                    onDigitsChange = viewModel::changeGasDigits,
                    label = "Price (¢/L)",
                    maxDigits = GAS_PRICE_MAX_DIGITS,
                    error = viewModel.gasPriceError,
                )
                viewModel.gasPriceSaveError?.let { ErrorText(it) }
            }
        },
        confirmButton = {
            TextButton(onClick = { viewModel.saveGasPrice(onUnauthorized) }, enabled = !viewModel.isSavingGasPrice) {
                if (viewModel.isSavingGasPrice) CircularProgressIndicator(Modifier.size(SPINNER_SIZE)) else Text("Save")
            }
        },
        dismissButton = { TextButton(onClick = viewModel::closeDialog) { Text("Cancel") } },
    )
}

@Composable
private fun SignOutDialog(onCancel: () -> Unit, onSignOut: () -> Unit) {
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("Sign out?") },
        confirmButton = { TextButton(onClick = onSignOut) { Text("Sign out") } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel") } },
    )
}

// can't be closed while deleting, so the user sees whether it worked
@Composable
private fun DeleteAccountDialog(viewModel: ProfileViewModel, onUnauthorized: () -> Unit, onDeleted: () -> Unit) {
    val deleting = viewModel.isDeleting
    AlertDialog(
        onDismissRequest = viewModel::closeDialog,
        properties = DialogProperties(dismissOnBackPress = !deleting, dismissOnClickOutside = !deleting),
        title = { Text("Delete your account?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("This permanently deletes your profile and trip history. This can't be undone.")
                viewModel.deleteError?.let { ErrorText(it) }
            }
        },
        confirmButton = {
            TextButton(onClick = { viewModel.deleteAccount(onDeleted, onUnauthorized) }, enabled = !deleting) {
                if (deleting) {
                    CircularProgressIndicator(Modifier.size(SPINNER_SIZE))
                } else {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            }
        },
        dismissButton = { TextButton(onClick = viewModel::closeDialog, enabled = !deleting) { Text("Cancel") } },
    )
}
