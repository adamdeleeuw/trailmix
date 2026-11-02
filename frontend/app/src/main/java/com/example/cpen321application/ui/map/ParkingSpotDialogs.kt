package com.example.cpen321application.ui.map

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import com.example.cpen321application.data.RateUnit
import com.example.cpen321application.ui.commute.ErrorText

private val SPINNER_SIZE = 20.dp

/**
 * The Save as parking spot dialog, also used by Edit with the spot's current values.
 *
 * While saving, Save shows a spinner and the dialog can't be closed, so a second tap
 * can't save twice. A failed save keeps the dialog open with the error under the fields.
 */
@Composable
fun ParkingSpotDialog(viewModel: ParkingSpotsViewModel, form: SpotForm, onUnauthorized: () -> Unit) {
    val saving = viewModel.isSaving
    val labelError = labelError(form.label)
    val costError = costError(form.cost)
    AlertDialog(
        onDismissRequest = viewModel::closeDialog,
        properties = DialogProperties(dismissOnBackPress = !saving, dismissOnClickOutside = !saving),
        title = { Text(if (form.editingId == null) "Save as parking spot" else "Edit parking spot") },
        text = { SpotFields(form, labelError, costError, viewModel.saveError, viewModel::changeForm) },
        confirmButton = {
            TextButton(
                onClick = { viewModel.save(onUnauthorized) },
                enabled = !saving && labelError == null && costError == null,
            ) {
                if (saving) CircularProgressIndicator(Modifier.size(SPINNER_SIZE)) else Text("Save")
            }
        },
        dismissButton = { TextButton(onClick = viewModel::closeDialog, enabled = !saving) { Text("Cancel") } },
    )
}

// Name, Parking cost with per hour / per day, and No overnight parking
@Composable
private fun SpotFields(
    form: SpotForm,
    labelError: String?,
    costError: String?,
    saveError: String?,
    onChange: (SpotForm) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = form.label,
            onValueChange = { onChange(form.copy(label = it)) },
            label = { Text("Name") },
            isError = labelError != null,
            supportingText = { Text(labelError ?: "${form.label.trim().length}/$MAX_LABEL_LENGTH") },
            singleLine = true,
        )
        OutlinedTextField(
            value = form.cost,
            onValueChange = { onChange(form.copy(cost = it)) },
            label = { Text("Parking cost") },
            prefix = { Text("$") },
            placeholder = { Text(COST_UNKNOWN) },
            isError = costError != null,
            supportingText = costError?.let { { Text(it) } },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            singleLine = true,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RateUnit.entries.forEach { unit ->
                FilterChip(
                    selected = form.ratePer == unit,
                    onClick = { onChange(form.copy(ratePer = unit)) },
                    label = { Text("per ${unitName(unit)}") },
                )
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Switch(checked = form.noOvernight, onCheckedChange = { onChange(form.copy(noOvernight = it)) })
            Text("No overnight parking")
        }
        saveError?.let { ErrorText(it) }
    }
}

/** Asks before deleting the selected spot. Can't be closed while the delete is running. */
@Composable
fun RemoveSpotDialog(viewModel: ParkingSpotsViewModel, onUnauthorized: () -> Unit) {
    val removing = viewModel.isRemoving
    AlertDialog(
        onDismissRequest = viewModel::cancelRemove,
        properties = DialogProperties(dismissOnBackPress = !removing, dismissOnClickOutside = !removing),
        title = { Text("Remove this parking spot?") },
        confirmButton = {
            TextButton(onClick = { viewModel.remove(onUnauthorized) }, enabled = !removing) {
                if (removing) CircularProgressIndicator(Modifier.size(SPINNER_SIZE)) else Text("Remove")
            }
        },
        dismissButton = { TextButton(onClick = viewModel::cancelRemove, enabled = !removing) { Text("Cancel") } },
    )
}

/** Explains, after location was denied twice, what the app does without it. */
@Composable
fun LocationOffDialog(onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Location is off") },
        text = {
            Text(
                "Without your location, the map starts on downtown Vancouver and planning a trip " +
                    "will need you to pick a start point. You can allow location for Trailmix in Settings.",
            )
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } },
    )
}
