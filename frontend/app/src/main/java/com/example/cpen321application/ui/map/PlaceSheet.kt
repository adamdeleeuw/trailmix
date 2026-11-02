package com.example.cpen321application.ui.map

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.ParkingSpot

private val SHEET_SIDE_PADDING = 24.dp
private val SHEET_BOTTOM_PADDING = 24.dp
private val LINE_SPACING = 4.dp
private val BUTTON_SPACING = 8.dp
private val BUTTONS_TOP_PADDING = 12.dp
private val SUMMARY_BOTTOM_PADDING = 16.dp

/** What the sheet's buttons do. */
class PlaceSheetActions(
    val onDirections: () -> Unit,
    val onSave: () -> Unit,
    val onEdit: () -> Unit,
    val onRemove: () -> Unit,
    val onClose: () -> Unit,
)

/**
 * The sheet for the selected place, like Google Maps' place sheet. The summary at the
 * top (name, the first detail, and the buttons) is what shows while the sheet peeks;
 * dragging it up shows the rest of the details.
 *
 * The details are, in order: a saved spot's cost, the address, the distance from the
 * user, and a saved spot's overnight rule.
 *
 * @param spot The saved spot this place is, or `null` if it isn't saved yet.
 * @param distance The straight-line distance from the user, e.g. "2.4 km", or `null` without location.
 * @param onSummaryHeight Called with the summary's height in pixels, so the sheet can peek at exactly that.
 */
@OptIn(ExperimentalMaterial3Api::class) // for the drag handle, drawn here so the peek can measure it
@Composable
fun PlaceSheet(
    place: SelectedPlace,
    spot: ParkingSpot?,
    distance: String?,
    actions: PlaceSheetActions,
    onSummaryHeight: (Int) -> Unit,
) {
    val details = listOfNotNull(
        spot?.let { formatRate(it.details) },
        place.address,
        distance?.let { "$it away" },
        spot?.let { formatOvernight(it.details.overnightAllowed) },
    )
    Column(Modifier.fillMaxWidth()) {
        Column(
            Modifier.onSizeChanged { onSummaryHeight(it.height) }.padding(bottom = SUMMARY_BOTTOM_PADDING),
            verticalArrangement = Arrangement.spacedBy(LINE_SPACING),
        ) {
            BottomSheetDefaults.DragHandle(Modifier.align(Alignment.CenterHorizontally))
            SheetHeader(spot?.details?.label ?: place.name, actions.onClose)
            details.firstOrNull()?.let { DetailLine(it) }
            SheetButtons(place, spot, actions)
        }
        Column(
            Modifier.padding(start = SHEET_SIDE_PADDING, end = SHEET_SIDE_PADDING, bottom = SHEET_BOTTOM_PADDING),
            verticalArrangement = Arrangement.spacedBy(LINE_SPACING),
        ) {
            details.drop(1).forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
        }
    }
}

// the place's name with the close button on its right, as in Google and Apple Maps
@Composable
private fun SheetHeader(title: String, onClose: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = SHEET_SIDE_PADDING), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        IconButton(onClick = onClose, modifier = Modifier.padding(end = BUTTON_SPACING)) {
            Icon(Icons.Filled.Close, contentDescription = "Close")
        }
    }
}

@Composable
private fun DetailLine(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.padding(horizontal = SHEET_SIDE_PADDING),
    )
}

// Directions, then Save as parking spot, or Edit and Remove for a saved spot
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SheetButtons(place: SelectedPlace, spot: ParkingSpot?, actions: PlaceSheetActions) {
    FlowRow(
        Modifier.padding(start = SHEET_SIDE_PADDING, end = SHEET_SIDE_PADDING, top = BUTTONS_TOP_PADDING),
        horizontalArrangement = Arrangement.spacedBy(BUTTON_SPACING),
        verticalArrangement = Arrangement.spacedBy(BUTTON_SPACING),
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
