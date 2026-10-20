package com.example.cpen321application.ui.commute

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.example.cpen321application.ui.components.DecimalDigitsField
import com.example.cpen321application.ui.components.SearchableDropdown

/** "Do you drive?" and, for Yes, the car fields. Used by the questionnaire and the Edit vehicle screen. */
@Composable
fun DrivingFields(form: VehicleForm) {
    Text("Do you drive?")
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(form.drives == true, onClick = { form.chooseDrives(true) }, label = { Text("Yes") })
        FilterChip(form.drives == false, onClick = { form.chooseDrives(false) }, label = { Text("No") })
    }
    form.drivesError?.let { ErrorText(it) }
    if (form.drives != true) return

    SearchableDropdown(
        label = "Make",
        options = form.makes,
        selected = form.make,
        onSelect = form::chooseMake,
        error = if (form.makesFailed) "Couldn't load car makes" else form.makeError,
        onRetry = if (form.makesFailed) form::loadMakes else null,
    )
    SearchableDropdown(
        label = "Model",
        options = form.models,
        selected = form.model,
        onSelect = form::chooseModel,
        enabled = form.make != null,
        error = if (form.modelsFailed) "Couldn't load models" else form.modelError,
        onRetry = if (form.modelsFailed) form::loadModels else null,
    )
    SearchableDropdown(
        label = "Colour (optional)",
        options = COLOURS,
        selected = form.colour,
        onSelect = form::chooseColour,
    )
    DecimalDigitsField(
        digits = form.fuelDigits,
        onDigitsChange = form::changeFuelDigits,
        label = "Fuel consumption (L/100 km)",
        maxDigits = FUEL_MAX_DIGITS,
        error = form.fuelError,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** "How do you usually pay for transit?" and, for an adult monthly pass, its zones. */
@Composable
fun TransitFields(form: TransitForm) {
    Text("How do you usually pay for transit?")
    Column(Modifier.selectableGroup()) {
        TransitChoice.entries.forEach { choice ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .selectable(form.choice == choice, role = Role.RadioButton) { form.choose(choice) }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = form.choice == choice, onClick = null) // the row handles the tap
                Text(choice.label, Modifier.padding(start = 8.dp))
            }
        }
    }
    form.choiceError?.let { ErrorText(it) }
    if (form.choice != TransitChoice.ADULT_MONTHLY_PASS) return

    Text("How many zones?")
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PASS_ZONES.forEach { zones ->
            FilterChip(
                selected = form.zones == zones,
                onClick = { form.chooseZones(zones) },
                label = { Text(zonesLabel(zones)) },
            )
        }
    }
    form.zonesError?.let { ErrorText(it) }
}

/** A validation or save error message under a question. */
@Composable
fun ErrorText(message: String) {
    Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
}
