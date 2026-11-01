package com.example.cpen321application.ui.map

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.ParkingSpot

/** What the sheet's buttons do. */
class PlaceSheetActions(
    val onDirections: () -> Unit,
    val onSave: () -> Unit,
    val onEdit: () -> Unit,
    val onRemove: () -> Unit,
)

/**
 * The sheet for the selected place: its name, address and distance, and for a saved
 * spot its cost and overnight rule.
 *
 * @param spot The saved spot this place is, or `null` if it isn't saved yet.
 * @param distance The straight-line distance from the user, e.g. "2.4 km", or `null` without location.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PlaceSheet(place: SelectedPlace, spot: ParkingSpot?, distance: String?, actions: PlaceSheetActions) {
    Column(
        Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(spot?.details?.label ?: place.name, style = MaterialTheme.typography.titleLarge)
        place.address?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        distance?.let { Text("$it away", style = MaterialTheme.typography.bodyMedium) }
        if (spot != null) {
            Text(formatRate(spot.details), style = MaterialTheme.typography.bodyMedium)
            Text(formatOvernight(spot.details.overnightAllowed), style = MaterialTheme.typography.bodyMedium)
        }
        FlowRow(
            Modifier.padding(top = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(onClick = actions.onDirections) { Text("Directions") }
            if (spot == null) {
                OutlinedButton(onClick = actions.onSave) { Text("Save as parking spot") }
            } else {
                OutlinedButton(onClick = actions.onEdit) { Text("Edit") }
                // a P marker's sheet is about the spot; a searched place's sheet is about the place
                OutlinedButton(onClick = actions.onRemove) {
                    Text(if (place.fromMarker) "Remove" else "Remove parking spot")
                }
            }
        }
    }
}
