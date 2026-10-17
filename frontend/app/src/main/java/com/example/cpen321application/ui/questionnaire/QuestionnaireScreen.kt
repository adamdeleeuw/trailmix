package com.example.cpen321application.ui.questionnaire

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.User
import com.example.cpen321application.ui.components.DecimalDigitsField
import com.example.cpen321application.ui.components.SearchableDropdown

/**
 * The commute questionnaire shown after a user's first sign-in.
 *
 * Back asks before leaving, since leaving signs the user out.
 *
 * @param onSaved Called with the updated account once the answers are saved.
 * @param onSignOut Signs the user out, from the Leave dialog or when the session is no longer valid.
 */
@Composable
fun QuestionnaireScreen(viewModel: QuestionnaireViewModel, onSaved: (User) -> Unit, onSignOut: () -> Unit) {
    var leaving by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) { viewModel.loadMakes() }
    BackHandler { leaving = true }

    Column(
        modifier = Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Set up your commute", style = MaterialTheme.typography.headlineMedium)
        Text("This helps Trailmix estimate what your trips cost.")
        DrivingSection(viewModel)
        TransitSection(viewModel)
        viewModel.saveError?.let { ErrorText(it) }
        Button(onClick = { viewModel.submit(onSaved, onSignOut) }, modifier = Modifier.fillMaxWidth()) {
            if (viewModel.isSaving) CircularProgressIndicator(Modifier.size(20.dp)) else Text("Submit")
        }
    }

    if (leaving) LeaveSetupDialog(onKeepGoing = { leaving = false }, onSignOut = onSignOut)
}

// "Do you drive?" and, for Yes, the car fields
@Composable
private fun DrivingSection(viewModel: QuestionnaireViewModel) {
    Text("Driving", style = MaterialTheme.typography.titleLarge)
    Text("Do you drive?")
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(viewModel.drives == true, onClick = { viewModel.chooseDrives(true) }, label = { Text("Yes") })
        FilterChip(viewModel.drives == false, onClick = { viewModel.chooseDrives(false) }, label = { Text("No") })
    }
    viewModel.drivesError?.let { ErrorText(it) }
    if (viewModel.drives != true) return

    SearchableDropdown(
        label = "Make",
        options = viewModel.makes,
        selected = viewModel.make,
        onSelect = viewModel::chooseMake,
        error = if (viewModel.makesFailed) "Couldn't load car makes" else viewModel.makeError,
        onRetry = if (viewModel.makesFailed) viewModel::loadMakes else null,
    )
    SearchableDropdown(
        label = "Model",
        options = viewModel.models,
        selected = viewModel.model,
        onSelect = viewModel::chooseModel,
        enabled = viewModel.make != null,
        error = if (viewModel.modelsFailed) "Couldn't load models" else viewModel.modelError,
        onRetry = if (viewModel.modelsFailed) viewModel::loadModels else null,
    )
    SearchableDropdown(
        label = "Colour (optional)",
        options = COLOURS,
        selected = viewModel.colour,
        onSelect = viewModel::chooseColour,
    )
    DecimalDigitsField(
        digits = viewModel.fuelDigits,
        onDigitsChange = viewModel::changeFuelDigits,
        label = "Fuel consumption (L/100 km)",
        maxDigits = FUEL_MAX_DIGITS,
        error = viewModel.fuelError,
        modifier = Modifier.fillMaxWidth(),
    )
}

// "How do you usually pay for transit?" and, for an adult monthly pass, its zones
@Composable
private fun TransitSection(viewModel: QuestionnaireViewModel) {
    Text("Transit", style = MaterialTheme.typography.titleLarge)
    Text("How do you usually pay for transit?")
    Column(Modifier.selectableGroup()) {
        TransitChoice.entries.forEach { choice ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .selectable(viewModel.transit == choice, role = Role.RadioButton) { viewModel.chooseTransit(choice) }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = viewModel.transit == choice, onClick = null) // the row handles the tap
                Text(choice.label, Modifier.padding(start = 8.dp))
            }
        }
    }
    viewModel.transitError?.let { ErrorText(it) }
    if (viewModel.transit != TransitChoice.ADULT_MONTHLY_PASS) return

    Text("How many zones?")
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PASS_ZONES.forEach { zones ->
            FilterChip(
                selected = viewModel.zones == zones,
                onClick = { viewModel.chooseZones(zones) },
                label = { Text(if (zones == 1) "1 zone" else "$zones zones") },
            )
        }
    }
    viewModel.zonesError?.let { ErrorText(it) }
}

// asks before leaving setup since leaving signs the user out, and Back closes it like Keep going
@Composable
private fun LeaveSetupDialog(onKeepGoing: () -> Unit, onSignOut: () -> Unit) {
    AlertDialog(
        onDismissRequest = onKeepGoing,
        title = { Text("Leave setup?") },
        text = { Text("You'll be signed out. You can finish setting up next time you sign in.") },
        confirmButton = { TextButton(onClick = onSignOut) { Text("Sign out") } },
        dismissButton = { TextButton(onClick = onKeepGoing) { Text("Keep going") } },
    )
}

// a validation or save error message under a question
@Composable
private fun ErrorText(message: String) {
    Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
}
