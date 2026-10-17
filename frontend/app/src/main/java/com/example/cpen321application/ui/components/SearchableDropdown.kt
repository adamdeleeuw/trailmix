package com.example.cpen321application.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

/** Keeps the options whose name contains [query], ignoring capitals, e.g. "rol" keeps "Corolla". */
fun filterOptions(options: List<String>, query: String): List<String> =
    options.filter { it.contains(query.trim(), ignoreCase = true) }

/**
 * A dropdown the user can type into to filter its options.
 *
 * Typing only filters the list. The value only changes when an option is tapped,
 * and typed text that isn't picked is replaced by the picked value when the list closes.
 *
 * @param selected The picked option, or `null` if none.
 * @param onSelect Called with the option the user taps.
 * @param error The message to show under the field, or `null` for none.
 * @param onRetry When set, a Retry button shows under the field, for options that couldn't be loaded.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchableDropdown(
    label: String,
    options: List<String>,
    selected: String?,
    onSelect: (String) -> Unit,
    enabled: Boolean = true,
    error: String? = null,
    onRetry: (() -> Unit)? = null,
) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable(selected) { mutableStateOf(selected.orEmpty()) } // resets when the pick changes

    fun close() {
        expanded = false
        query = selected.orEmpty() // unpicked text doesn't count
    }

    Column(Modifier.fillMaxWidth()) {
        ExposedDropdownMenuBox(
            expanded = expanded && enabled,
            onExpandedChange = { if (it) expanded = true else close() },
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = {
                    query = it
                    expanded = true
                },
                modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryEditable, enabled),
                enabled = enabled,
                label = { Text(label) },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                isError = error != null,
                supportingText = error?.let { { Text(it) } },
                singleLine = true,
            )
            ExposedDropdownMenu(expanded = expanded && enabled, onDismissRequest = ::close) {
                // the query only filters once the user types something different from the pick
                val shown = if (query == selected) options else filterOptions(options, query)
                shown.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option) },
                        onClick = {
                            onSelect(option)
                            expanded = false
                            query = option
                        },
                        contentPadding = ExposedDropdownMenuDefaults.ItemContentPadding,
                    )
                }
            }
        }
        onRetry?.let { TextButton(onClick = it) { Text("Retry") } }
    }
}
