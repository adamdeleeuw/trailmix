package com.example.cpen321application.ui.map

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.PlaceSuggestion

private val BAR_SHAPE = RoundedCornerShape(28.dp)
private val SUGGESTIONS_MAX_HEIGHT = 320.dp

/**
 * The search bar over the top of the map, like Google Maps, with its suggestions below it.
 *
 * @param onPick Called with the suggestion the user taps, after the keyboard is closed.
 * @param onClear Called by the clear button, to empty the search and close the sheet.
 */
@Composable
fun MapSearchBar(
    search: MapSearchViewModel,
    onPick: (PlaceSuggestion) -> Unit,
    onClear: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val focusManager = LocalFocusManager.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Card(shape = BAR_SHAPE) {
            TextField(
                value = search.query,
                onValueChange = search::changeQuery,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Search for a place") },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                trailingIcon = {
                    if (search.isActive) {
                        IconButton(onClick = onClear) { Icon(Icons.Filled.Clear, contentDescription = "Clear search") }
                    }
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { focusManager.clearFocus() }),
                colors = TextFieldDefaults.colors(
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                ),
            )
        }
        SearchResults(search) { suggestion ->
            focusManager.clearFocus() // closes the keyboard
            onPick(suggestion)
        }
    }
}

// the list under the bar: suggestions, a spinner, "No places found", or the connection error with Retry
@Composable
private fun SearchResults(search: MapSearchViewModel, onPick: (PlaceSuggestion) -> Unit) {
    when (search.status) {
        SearchStatus.IDLE -> Unit
        SearchStatus.LOADING -> LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 24.dp))
        SearchStatus.NO_RESULTS -> MessageCard { Text(NO_PLACES) }
        SearchStatus.FAILED -> MessageCard {
            Text(SEARCH_FAILED, color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
            TextButton(onClick = search::retry) { Text("Retry") }
        }
        SearchStatus.RESULTS -> Card {
            LazyColumn(Modifier.heightIn(max = SUGGESTIONS_MAX_HEIGHT)) {
                items(search.suggestions, key = { it.placeId }) { suggestion ->
                    ListItem(
                        headlineContent = { Text(suggestion.name) },
                        supportingContent = { Text(suggestion.description) },
                        modifier = Modifier.clickable { onPick(suggestion) },
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun MessageCard(content: @Composable RowScope.() -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 8.dp).heightIn(min = 40.dp),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}
