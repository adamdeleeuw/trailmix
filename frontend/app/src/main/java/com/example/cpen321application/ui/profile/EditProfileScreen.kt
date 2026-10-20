package com.example.cpen321application.ui.profile

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.User
import com.example.cpen321application.ui.commute.DrivingFields
import com.example.cpen321application.ui.commute.ErrorText
import com.example.cpen321application.ui.commute.TransitFields

/**
 * The Edit vehicle or Edit transit screen, with the questionnaire's fields for that
 * section filled in with the user's current answers.
 *
 * Back with unsaved changes asks "Discard changes?" first.
 *
 * @param onSaved Called with the updated account once the section is saved.
 * @param onDone Returns to Profile.
 * @param onUnauthorized Signs the user out when the session is no longer valid.
 */
@Composable
fun EditProfileScreen(
    viewModel: EditProfileViewModel,
    onSaved: (User) -> Unit,
    onDone: () -> Unit,
    onUnauthorized: () -> Unit,
) {
    if (!viewModel.isStarted) {
        LaunchedEffect(Unit) { onDone() } // nothing to edit, so return to Profile
        return
    }
    val vehicle = viewModel.section == ProfileSection.VEHICLE
    if (vehicle) LaunchedEffect(Unit) { viewModel.vehicleForm.loadMakes() }
    BackHandler { viewModel.back(onLeave = onDone) }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(if (vehicle) "Edit vehicle" else "Edit transit", style = MaterialTheme.typography.headlineMedium)
        if (vehicle) DrivingFields(viewModel.vehicleForm) else TransitFields(viewModel.transitForm)
        viewModel.saveError?.let { ErrorText(it) }
        Button(
            onClick = { viewModel.save(onSaved = { onSaved(it); onDone() }, onUnauthorized = onUnauthorized) },
            modifier = Modifier.fillMaxWidth(),
            enabled = !viewModel.isSaving,
        ) {
            if (viewModel.isSaving) CircularProgressIndicator(Modifier.size(20.dp)) else Text("Save")
        }
    }

    if (viewModel.showDiscardDialog) DiscardChangesDialog(onKeepEditing = viewModel::keepEditing, onDiscard = onDone)
}

// Back or Keep editing closes it and keeps the answers, Discard leaves without saving
@Composable
private fun DiscardChangesDialog(onKeepEditing: () -> Unit, onDiscard: () -> Unit) {
    AlertDialog(
        onDismissRequest = onKeepEditing,
        title = { Text("Discard changes?") },
        confirmButton = { TextButton(onClick = onDiscard) { Text("Discard") } },
        dismissButton = { TextButton(onClick = onKeepEditing) { Text("Keep editing") } },
    )
}
