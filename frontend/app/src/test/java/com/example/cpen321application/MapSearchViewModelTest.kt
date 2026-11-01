package com.example.cpen321application

import com.example.cpen321application.data.PlaceDetails
import com.example.cpen321application.data.PlaceSearch
import com.example.cpen321application.data.PlaceSearchException
import com.example.cpen321application.data.PlaceSuggestion
import com.example.cpen321application.ui.map.MapSearchViewModel
import com.example.cpen321application.ui.map.SearchStatus
import com.google.android.gms.maps.model.LatLng
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private val NORTH_PARKADE = PlaceSuggestion("north", "UBC North Parkade", "Vancouver, BC")
private val NORTH_PARKADE_DETAILS =
    PlaceDetails("north", "UBC North Parkade", "6115 Student Union Blvd", LatLng(49.2697, -123.2513))

/** In-memory place search. Set [failure] to make every call throw it, or [results] for what it finds. */
class FakePlaceSearch : PlaceSearch {
    var results = listOf(NORTH_PARKADE)
    var failure: IOException? = null
    var address: String? = "123 Side St"
    val queries = mutableListOf<String>()

    override suspend fun suggest(query: String): List<PlaceSuggestion> {
        queries += query
        failure?.let { throw it }
        return results
    }

    override suspend fun details(placeId: String): PlaceDetails {
        failure?.let { throw it }
        return NORTH_PARKADE_DETAILS
    }

    override suspend fun nearestAddress(location: LatLng) = address
}

@OptIn(ExperimentalCoroutinesApi::class)
class MapSearchViewModelTest {
    private val places = FakePlaceSearch()
    private lateinit var viewModel: MapSearchViewModel // built after the test dispatcher is set

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        viewModel = MapSearchViewModel(places, debounceMs = 0)
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun suggestionsStartAfterTwoCharacters() {
        viewModel.changeQuery("U")
        assertEquals(SearchStatus.IDLE, viewModel.status)
        assertTrue(places.queries.isEmpty())

        viewModel.changeQuery("UB")
        assertEquals(SearchStatus.RESULTS, viewModel.status)
        assertEquals(listOf(NORTH_PARKADE), viewModel.suggestions)
        assertEquals(listOf("UB"), places.queries)
    }

    @Test
    fun noSuggestionsShowsNoPlacesFound() {
        places.results = emptyList()
        viewModel.changeQuery("zzzz")
        assertEquals(SearchStatus.NO_RESULTS, viewModel.status)
    }

    @Test
    fun networkErrorCanBeRetried() {
        places.failure = PlaceSearchException()
        viewModel.changeQuery("UBC")
        assertEquals(SearchStatus.FAILED, viewModel.status)
        assertTrue(viewModel.suggestions.isEmpty())

        places.failure = null
        viewModel.retry()
        assertEquals(SearchStatus.RESULTS, viewModel.status)
        assertEquals("UBC", viewModel.query) // the user's text is kept
    }

    @Test
    fun pickingASuggestionHidesTheListAndReturnsThePlace() {
        var picked: PlaceDetails? = null
        viewModel.changeQuery("UBC")
        viewModel.pick(NORTH_PARKADE) { picked = it }

        assertEquals(NORTH_PARKADE_DETAILS, picked)
        assertEquals("UBC North Parkade", viewModel.query)
        assertTrue(viewModel.suggestions.isEmpty())
        assertEquals(SearchStatus.IDLE, viewModel.status)
    }

    @Test
    fun failedPickShowsTheConnectionError() {
        var picked: PlaceDetails? = null
        viewModel.changeQuery("UBC")
        places.failure = PlaceSearchException()
        viewModel.pick(NORTH_PARKADE) { picked = it }

        assertNull(picked)
        assertEquals(SearchStatus.FAILED, viewModel.status)
    }

    @Test
    fun clearingEmptiesTheSearch() {
        viewModel.changeQuery("UBC")
        assertTrue(viewModel.isActive)

        viewModel.clear()
        assertFalse(viewModel.isActive)
        assertEquals("", viewModel.query)
        assertTrue(viewModel.suggestions.isEmpty())
        assertEquals(SearchStatus.IDLE, viewModel.status)
    }

    @Test
    fun shorteningBelowTwoCharactersHidesTheList() {
        viewModel.changeQuery("UBC")
        viewModel.changeQuery("U")
        assertTrue(viewModel.suggestions.isEmpty())
        assertEquals(SearchStatus.IDLE, viewModel.status)
    }
}
