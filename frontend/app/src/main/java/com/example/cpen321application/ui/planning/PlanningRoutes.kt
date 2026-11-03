package com.example.cpen321application.ui.planning

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.PlanWarning
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.data.TripMode
import java.time.Instant

/* Planning's bottom sheet: Leave now, Modes and Sort by, warnings, and the route list. */

private const val SKELETON_ROWS = 3
private val LIST_MAX_HEIGHT = 480.dp // the sheet dragged up; more routes than fit scroll
private val TIME_COLUMN_WIDTH = 80.dp // fits "105 min"
private val DRAG_HANDLE_HEIGHT = 48.dp // Material's sheet handle with its padding, above this content

/**
 * The contents of Planning's draggable sheet: Leave/Modes/Sort by, warnings, then the routes.
 *
 * @param onPeekHeight Called with the height in pixels the collapsed sheet needs to show the
 * handle, the options and the first route.
 */
@Composable
internal fun RoutesSheet(planner: PlanningViewModel, onClose: () -> Unit, onPeekHeight: (Int) -> Unit) {
    var headerPx by remember { mutableIntStateOf(0) }
    var firstPx by remember { mutableIntStateOf(0) }
    val handlePx = with(LocalDensity.current) { DRAG_HANDLE_HEIGHT.roundToPx() }
    LaunchedEffect(headerPx, firstPx) { onPeekHeight(handlePx + headerPx + firstPx) }
    Column(Modifier.navigationBarsPadding()) {
        Column(Modifier.onSizeChanged { headerPx = it.height }) {
            OptionsRow(planner)
            Banners(planner, onClose)
            HorizontalDivider(Modifier.padding(top = 8.dp))
        }
        RouteList(planner, onFirstHeight = { firstPx = it })
    }
}

// [Leave now ▾] [Modes ▾] [Sort by ▾], like Google Maps' row above the routes
@Composable
private fun OptionsRow(planner: PlanningViewModel) {
    var pickingTime by remember { mutableStateOf(false) }
    // scrolls sideways when the chips don't fit, like Google Maps' row
    Row(
        Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        AssistChip(onClick = { pickingTime = true }, label = { Text("${arriveByChipText(planner.arriveBy)} ▾") })
        ModesMenu(planner)
        SortMenu(planner)
        MaxWalkMenu(planner)
    }
    if (pickingTime) {
        ArriveByDialog(
            onSet = { time ->
                planner.changeArriveBy(time)
                pickingTime = false
            },
            onDismiss = { pickingTime = false },
        )
    }
}

@Composable
private fun ModesMenu(planner: PlanningViewModel) {
    var open by remember { mutableStateOf(false) }
    Box {
        AssistChip(onClick = { open = true }, label = { Text("Modes ▾") })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            ModeItem(planner, TripMode.DRIVE, "Drive")
            ModeItem(planner, TripMode.TRANSIT, "Transit")
            DropdownMenuItem(
                text = { Text("Bike · Coming soon") },
                onClick = {},
                enabled = false,
                leadingIcon = { Checkbox(checked = false, onCheckedChange = null, enabled = false) },
            )
        }
    }
}

// a mode with its checkbox; the menu stays open so several can be changed in one go
@Composable
private fun ModeItem(planner: PlanningViewModel, mode: TripMode, label: String) {
    DropdownMenuItem(
        text = { Text(label) },
        onClick = { planner.toggleMode(mode) },
        leadingIcon = { Checkbox(checked = mode in planner.modes, onCheckedChange = null) },
    )
}

@Composable
private fun SortMenu(planner: PlanningViewModel) {
    var open by remember { mutableStateOf(false) }
    val name = if (planner.sortBy == SortBy.COST) "Cost" else "Time"
    Box {
        AssistChip(onClick = { open = true }, label = { Text("Sort by: $name ▾") })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            listOf(SortBy.COST to "Cost", SortBy.TIME to "Time").forEach { (order, label) ->
                DropdownMenuItem(
                    text = { Text(label) },
                    onClick = {
                        planner.changeSort(order)
                        open = false
                    },
                    leadingIcon = { RadioButton(selected = planner.sortBy == order, onClick = null) },
                )
            }
        }
    }
}

// the longest single walk a route may have; the choice is saved as the user's default
@Composable
private fun MaxWalkMenu(planner: PlanningViewModel) {
    var open by remember { mutableStateOf(false) }
    // a saved value that isn't one of the usual choices is still offered
    val choices = (MAX_WALK_CHOICES + planner.maxWalkMinutes).distinct().sorted()
    Box {
        AssistChip(onClick = { open = true }, label = { Text("Walk \u2264 ${planner.maxWalkMinutes} min \u25BE") })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            Text(
                "Longest single walk",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            choices.forEach { minutes ->
                DropdownMenuItem(
                    text = { Text("$minutes min") },
                    onClick = {
                        planner.changeMaxWalk(minutes)
                        open = false
                    },
                    leadingIcon = { RadioButton(selected = planner.maxWalkMinutes == minutes, onClick = null) },
                )
            }
        }
    }
}

// picks an arrive-by time today or tomorrow, or "Leave now" (`null`)
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ArriveByDialog(onSet: (Instant?) -> Unit, onDismiss: () -> Unit) {
    val time = rememberTimePickerState(initialHour = 9, initialMinute = 0, is24Hour = false)
    var tomorrow by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Arrive by") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = !tomorrow, onClick = { tomorrow = false }, label = { Text("Today") })
                    FilterChip(selected = tomorrow, onClick = { tomorrow = true }, label = { Text("Tomorrow") })
                }
                TimePicker(time, Modifier.padding(top = 12.dp))
            }
        },
        confirmButton = { TextButton(onClick = { onSet(arriveByInstant(time.hour, time.minute, tomorrow)) }) { Text("Set") } },
        dismissButton = { TextButton(onClick = { onSet(null) }) { Text("Leave now") } },
    )
}

// the routes, or why there are none; [onFirstHeight] gets the height of whatever is shown first,
// so the collapsed sheet can show exactly one route (or the message)
@Composable
private fun RouteList(planner: PlanningViewModel, onFirstHeight: (Int) -> Unit) {
    val loading = planner.status == PlanStatus.LOADING
    val first = Modifier.onSizeChanged { onFirstHeight(it.height) }
    when {
        planner.status == PlanStatus.NEEDS_ORIGIN -> Message("Choose a start point to see routes.", first)
        planner.status == PlanStatus.NO_ROUTES -> Message(noRoutesText(planner.modes, planner.maxWalkMinutes), first)
        planner.status == PlanStatus.FAILED -> Row(
            first.padding(16.dp).fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(ROUTE_SERVICE_DOWN, color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
            Button(onClick = planner::retry) { Text("Retry") }
        }
        loading && planner.options.isEmpty() -> Column { repeat(SKELETON_ROWS) { SkeletonRow(if (it == 0) first else Modifier) } }
        else -> Column {
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            LazyColumn(Modifier.heightIn(max = LIST_MAX_HEIGHT).alpha(if (loading) LOADING_ALPHA else 1f)) {
                itemsIndexed(planner.options, key = { _, route -> route.label }) { index, route ->
                    Column(if (index == 0) first else Modifier) {
                        RouteRow(route, planner.arriveBy, isSelected = index == planner.selectedIndex) { planner.select(index) }
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}

@Composable
private fun Message(text: String, modifier: Modifier) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier.padding(16.dp))
}

// one route, Google Maps style: total minutes and cost on the left; times, how early or
// late, its label, and the mode strip on the right
@Composable
private fun RouteRow(route: RouteOption, arriveBy: Instant?, isSelected: Boolean, onClick: () -> Unit) {
    val highlight = if (isSelected) MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.5f) else Color.Transparent
    Row(
        Modifier
            .fillMaxWidth()
            .background(highlight)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.width(TIME_COLUMN_WIDTH)) {
            Row {
                Text(
                    "${minutes(route.totalDurationSeconds)}",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.alignByBaseline(),
                )
                Text(" min", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.alignByBaseline())
            }
            Text(costText(route.totalCostCents), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            if (route.costEstimated) {
                Text("est.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(timeRangeText(route), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                LabelTag(labelText(route.label))
            }
            punctualityText(route, arriveBy)?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            lateText(route, arriveBy)?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
            ModeStripRow(route)
        }
    }
}

@Composable
private fun LabelTag(text: String) {
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = RoundedCornerShape(50)) {
        Text(text, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
    }
}

// "[99 B-Line] › [Canada Line] › Walk 4", with each line in its own colour
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ModeStripRow(route: RouteOption) {
    val items = modeStrip(route)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        val centred = Modifier.align(Alignment.CenterVertically)
        items.forEachIndexed { i, item ->
            if (i > 0) {
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = centred.size(16.dp),
                )
            }
            if (item.mode == TripMode.TRANSIT) {
                Box(centred) { LineBadge(item.text, lineColour(item.colour)) }
            } else {
                Text(item.text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = centred)
            }
        }
    }
}

// a grey stand-in row while the first plan loads
@Composable
private fun SkeletonRow(modifier: Modifier) {
    Row(modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SkeletonBar(Modifier.width(TIME_COLUMN_WIDTH).height(40.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SkeletonBar(Modifier.fillMaxWidth(0.6f).height(14.dp))
            SkeletonBar(Modifier.fillMaxWidth(0.9f).height(14.dp))
        }
    }
}

@Composable
private fun SkeletonBar(modifier: Modifier) {
    Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(4.dp)))
}

// banners that never block the routes: no parking spots (with Drive on) and no gas price
@Composable
private fun Banners(planner: PlanningViewModel, onClose: () -> Unit) {
    if (PlanWarning.NO_PARKING_SPOTS in planner.warnings && TripMode.DRIVE in planner.modes) {
        Banner("Save a parking spot to plan driving trips", action = "Back to map", onAction = onClose)
    }
    if (PlanWarning.VEHICLE_MISSING in planner.warnings) {
        Banner("Add your car in Profile for accurate fuel costs")
    }
    if (PlanWarning.GAS_PRICE_MISSING in planner.warnings) {
        Banner("Set your gas price in Profile for accurate costs")
    }
}

@Composable
private fun Banner(text: String, action: String? = null, onAction: () -> Unit = {}) {
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp).fillMaxWidth(),
    ) {
        Row(Modifier.padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(text, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f).padding(vertical = 10.dp))
            if (action != null) TextButton(onClick = onAction) { Text(action) }
        }
    }
}
