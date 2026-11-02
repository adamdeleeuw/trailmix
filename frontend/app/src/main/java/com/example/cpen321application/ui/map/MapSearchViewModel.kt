package com.example.cpen321application.ui.map

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.cpen321application.data.PlaceDetails
import com.example.cpen321application.data.PlaceSearch
import com.example.cpen321application.data.PlaceSuggestion
import java.io.IOException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Suggestions only start after this many characters. */
const val SEARCH_MIN_CHARS = 2

/** How long typing has to pause before searching, so each keystroke isn't a billed request. */
const val SEARCH_DEBOUNCE_MS = 300L

const val NO_PLACES = "No places found"
const val SEARCH_FAILED = "Couldn't search. Check your connection."

/** Where the search bar's suggestion list is. */
enum class SearchStatus { IDLE, LOADING, RESULTS, NO_RESULTS, FAILED }

/**
 * The Map tab's search bar: suggestions as the user types, biased to Metro Vancouver.
 *
 * @param debounceMs How long to wait after typing; tests pass 0.
 */
class MapSearchViewModel(
    private val places: PlaceSearch,
    private val debounceMs: Long = SEARCH_DEBOUNCE_MS,
) : ViewModel() {
    var query by mutableStateOf("")
        private set

    var suggestions by mutableStateOf<List<PlaceSuggestion>>(emptyList())
        private set

    var status by mutableStateOf(SearchStatus.IDLE)
        private set

    private var job: Job? = null

    /** Whether there's a search for Back to clear. */
    val isActive get() = query.isNotEmpty()

    /** Updates the text and, once it's long enough, searches after a short pause. */
    fun changeQuery(text: String) {
        query = text
        job?.cancel()
        if (text.trim().length < SEARCH_MIN_CHARS) {
            suggestions = emptyList()
            status = SearchStatus.IDLE
            return
        }
        job = viewModelScope.launch {
            delay(debounceMs)
            search()
        }
    }

    /** Searches again for the current text, after a failure. */
    fun retry() {
        job?.cancel()
        job = viewModelScope.launch { search() }
    }

    /**
     * Fetches the picked suggestion's details and hides the list.
     *
     * @param onPicked Called with the place once its details arrive, to open the sheet there.
     */
    fun pick(suggestion: PlaceSuggestion, onPicked: (PlaceDetails) -> Unit) {
        job?.cancel()
        query = suggestion.name
        suggestions = emptyList()
        status = SearchStatus.LOADING
        job = viewModelScope.launch {
            try {
                val place = places.details(suggestion.placeId)
                status = SearchStatus.IDLE
                onPicked(place)
            } catch (e: IOException) {
                status = SearchStatus.FAILED
            }
        }
    }

    /** Empties the search bar and the list. */
    fun clear() {
        job?.cancel()
        query = ""
        suggestions = emptyList()
        status = SearchStatus.IDLE
    }

    private suspend fun search() {
        status = SearchStatus.LOADING
        try {
            suggestions = places.suggest(query.trim())
            status = if (suggestions.isEmpty()) SearchStatus.NO_RESULTS else SearchStatus.RESULTS
        } catch (e: IOException) {
            suggestions = emptyList()
            status = SearchStatus.FAILED
        }
    }
}
