package com.example.cpen321application

import com.example.cpen321application.data.HttpException
import com.example.cpen321application.data.PARKING_DUPLICATE_ERROR
import com.example.cpen321application.data.PARKING_LIMIT_ERROR
import com.example.cpen321application.data.ParkingSpot
import com.example.cpen321application.data.ParkingSpotApi
import com.example.cpen321application.data.ParkingSpotDetails
import com.example.cpen321application.data.PlaceDetails
import com.example.cpen321application.data.RateUnit
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.UnauthorizedException
import com.example.cpen321application.ui.SAVE_FAILED
import com.example.cpen321application.ui.SAVE_OFFLINE
import com.example.cpen321application.ui.map.DROPPED_PIN
import com.example.cpen321application.ui.map.MAX_PARKING_SPOTS
import com.example.cpen321application.ui.map.ParkingSpotsViewModel
import com.example.cpen321application.ui.map.REMOVE_FAILED
import com.example.cpen321application.ui.map.SPOTS_LOAD_FAILED
import com.example.cpen321application.ui.map.SPOT_ALREADY_SAVED
import com.example.cpen321application.ui.map.SPOT_GONE
import com.example.cpen321application.ui.map.SPOT_LIMIT
import com.example.cpen321application.ui.map.SPOT_REMOVED
import com.example.cpen321application.ui.map.SPOT_SAVED
import com.example.cpen321application.ui.map.SpotForm
import com.google.android.gms.maps.model.LatLng
import java.io.IOException
import java.net.HttpURLConnection.HTTP_CONFLICT
import java.net.HttpURLConnection.HTTP_NOT_FOUND
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private val PARKADE = PlaceDetails("north", "UBC North Parkade", "6115 Student Union Blvd", LatLng(49.2697, -123.2513))
private val SIDE_STREET = LatLng(49.2600, -123.1700)

private fun spot(id: String, placeId: String? = null, rateCents: Int? = null) = ParkingSpot(
    id,
    SIDE_STREET,
    placeId,
    ParkingSpotDetails("Spot $id", rateCents, if (rateCents == null) null else RateUnit.HOUR, true),
)

/** In-memory parking spots backend. Set [failure] to make every call throw it, or [pending] to hold a save open. */
private class FakeParkingSpots : ParkingSpotApi {
    val spots = mutableListOf<ParkingSpot>()
    var failure: IOException? = null
    var pending: CompletableDeferred<Unit>? = null
    var saveCalls = 0
    var lastSaved: Triple<LatLng, String?, ParkingSpotDetails>? = null

    override suspend fun getParkingSpots(sessionToken: String): List<ParkingSpot> {
        failure?.let { throw it }
        return spots.toList()
    }

    override suspend fun saveParkingSpot(
        sessionToken: String,
        location: LatLng,
        placeId: String?,
        details: ParkingSpotDetails,
    ): ParkingSpot {
        saveCalls++
        pending?.await()
        failure?.let { throw it }
        lastSaved = Triple(location, placeId, details)
        return ParkingSpot("new-$saveCalls", location, placeId, details).also { spots.add(0, it) }
    }

    override suspend fun updateParkingSpot(sessionToken: String, id: String, details: ParkingSpotDetails): ParkingSpot {
        failure?.let { throw it }
        val index = spots.indexOfFirst { it.id == id }
        if (index < 0) throw HttpException(HTTP_NOT_FOUND, "Parking spot not found")
        return spots[index].copy(details = details).also { spots[index] = it }
    }

    override suspend fun deleteParkingSpot(sessionToken: String, id: String) {
        failure?.let { throw it }
        if (!spots.removeIf { it.id == id }) throw HttpException(HTTP_NOT_FOUND, "Parking spot not found")
    }
}

private class SpotsTokenStore(private val token: String? = "token") : SessionStore {
    override suspend fun token() = token
    override suspend fun setToken(token: String?) = Unit
    override suspend fun pendingSignOuts() = emptySet<String>()
    override suspend fun endSession() = Unit
    override suspend fun forget(token: String) = Unit
}

@OptIn(ExperimentalCoroutinesApi::class)
class ParkingSpotsViewModelTest {
    private val api = FakeParkingSpots()
    private val places = FakePlaceSearch()
    private lateinit var viewModel: ParkingSpotsViewModel // built after the test dispatcher is set
    private var signedOut = false

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        viewModel = ParkingSpotsViewModel(api, places, SpotsTokenStore())
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun load() = viewModel.loadSpots { signedOut = true }

    private fun save() = viewModel.save { signedOut = true }

    @Test
    fun loadsTheUsersSpots() {
        api.spots += listOf(spot("a"), spot("b"))
        load()
        assertEquals(listOf("a", "b"), viewModel.spots.map { it.id })
    }

    @Test
    fun failedLoadShowsAMessage() {
        api.failure = IOException()
        load()
        assertEquals(SPOTS_LOAD_FAILED, viewModel.message)
        viewModel.messageShown()
        assertNull(viewModel.message)
    }

    @Test
    fun expiredSessionSignsOut() {
        viewModel = ParkingSpotsViewModel(api, places, SpotsTokenStore(token = null))
        load()
        assertTrue(signedOut)
    }

    @Test
    fun searchedPlaceOpensTheSheetAndPansThere() {
        viewModel.showPlace(PARKADE)
        assertEquals("UBC North Parkade", viewModel.selected?.name)
        assertEquals(PARKADE.location, viewModel.focus)
        assertNull(viewModel.selectedSpot)
        viewModel.focusHandled()
        assertNull(viewModel.focus)
    }

    @Test
    fun savingASearchedPlaceTurnsItIntoAParkingSpot() {
        viewModel.showPlace(PARKADE)
        viewModel.openSaveDialog()
        val form = viewModel.form
        assertNotNull(form)
        assertEquals("UBC North Parkade", form?.label) // starts filled in with the place name
        assertFalse(form?.noOvernight ?: true) // overnight is off by default

        viewModel.changeForm(form!!.copy(cost = "3", ratePer = RateUnit.HOUR))
        save()

        assertNull(viewModel.form)
        assertEquals(SPOT_SAVED, viewModel.message)
        assertEquals(Triple(PARKADE.location, "north", ParkingSpotDetails("UBC North Parkade", 300, RateUnit.HOUR, true)), api.lastSaved)
        assertEquals("new-1", viewModel.selectedSpot?.id) // the sheet now shows the saved spot
        assertEquals(listOf("new-1"), viewModel.spots.map { it.id })
    }

    @Test
    fun droppedPinIsNamedAndGetsTheNearestAddress() {
        viewModel.dropPin(SIDE_STREET)
        assertEquals(DROPPED_PIN, viewModel.selected?.name)
        assertEquals("123 Side St", viewModel.selected?.address)
        assertNull(viewModel.selected?.placeId)
    }

    @Test
    fun droppedPinSavesWithUnknownCost() {
        viewModel.dropPin(SIDE_STREET)
        viewModel.openSaveDialog()
        save()
        assertEquals(ParkingSpotDetails(DROPPED_PIN, null, null, true), api.lastSaved?.third)
    }

    @Test
    fun invalidFormIsNotSaved() {
        viewModel.dropPin(SIDE_STREET)
        viewModel.openSaveDialog()
        val form = viewModel.form!!
        for (invalid in listOf(form.copy(label = " "), form.copy(label = "x".repeat(61)), form.copy(cost = "-2"))) {
            viewModel.changeForm(invalid)
            save()
        }
        assertEquals(0, api.saveCalls)
        assertNotNull(viewModel.form)
    }

    @Test
    fun tapsWhileSavingAreIgnored() {
        api.pending = CompletableDeferred()
        viewModel.dropPin(SIDE_STREET)
        viewModel.openSaveDialog()
        save()
        save()
        viewModel.closeDialog() // can't close while saving
        assertTrue(viewModel.isSaving)
        assertNotNull(viewModel.form)

        api.pending?.complete(Unit)
        assertEquals(1, api.saveCalls)
        assertFalse(viewModel.isSaving)
    }

    @Test
    fun noNetworkKeepsTheDialogOpen() {
        api.failure = IOException()
        viewModel.dropPin(SIDE_STREET)
        viewModel.openSaveDialog()
        save()
        assertEquals(SAVE_OFFLINE, viewModel.saveError)
        assertNotNull(viewModel.form)
    }

    @Test
    fun twentySpotsShowTheLimitMessage() {
        api.spots += List(MAX_PARKING_SPOTS) { spot("$it") }
        load()
        viewModel.dropPin(SIDE_STREET)
        viewModel.openSaveDialog()
        assertNull(viewModel.form)
        assertEquals(SPOT_LIMIT, viewModel.message)
    }

    @Test
    fun serverLimitAndDuplicateErrorsAreExplained() {
        val cases = mapOf(PARKING_LIMIT_ERROR to SPOT_LIMIT, PARKING_DUPLICATE_ERROR to SPOT_ALREADY_SAVED)
        for ((error, shown) in cases) {
            api.failure = HttpException(HTTP_CONFLICT, error)
            viewModel.showPlace(PARKADE)
            viewModel.openSaveDialog()
            save()
            assertEquals(shown, viewModel.saveError)
            viewModel.closeDialog()
        }
    }

    @Test
    fun notFoundMeansGoneOnlyWhenEditing() {
        // a new save to a backend without the parking spot endpoints
        api.failure = HttpException(HTTP_NOT_FOUND, "Not Found")
        viewModel.dropPin(SIDE_STREET)
        viewModel.openSaveDialog()
        save()
        assertEquals(SAVE_FAILED, viewModel.saveError)
        viewModel.closeDialog()

        // editing a spot another device already deleted
        api.failure = null
        val saved = spot("a")
        api.spots += saved
        load()
        api.spots.clear()
        viewModel.tapSpot(saved)
        viewModel.openEditDialog()
        save()
        assertEquals(SPOT_GONE, viewModel.saveError)
    }

    @Test
    fun tappingAPMarkerShowsTheSpot() {
        val saved = spot("a", rateCents = 300)
        api.spots += saved
        load()
        viewModel.tapSpot(saved)
        assertEquals(saved, viewModel.selectedSpot)
        assertTrue(viewModel.selected?.fromMarker ?: false)
    }

    @Test
    fun searchedPlaceThatIsAlreadySavedShowsTheSpot() {
        api.spots += spot("a", placeId = "north")
        load()
        viewModel.showPlace(PARKADE)
        assertEquals("a", viewModel.selectedSpot?.id)
    }

    @Test
    fun editReusesTheDialogWithTheCurrentValues() {
        val saved = spot("a", rateCents = 250)
        api.spots += saved
        load()
        viewModel.tapSpot(saved)
        viewModel.openEditDialog()
        assertEquals(SpotForm("a", "Spot a", "2.50", RateUnit.HOUR, noOvernight = false), viewModel.form)

        viewModel.changeForm(viewModel.form!!.copy(label = "Home", cost = "", noOvernight = true))
        save()
        assertEquals(ParkingSpotDetails("Home", null, null, false), viewModel.selectedSpot?.details)
        assertEquals(SPOT_SAVED, viewModel.message)
    }

    @Test
    fun removingAMarkersSpotAsksFirstAndClosesTheSheet() {
        val saved = spot("a")
        api.spots += saved
        load()
        viewModel.tapSpot(saved)
        viewModel.askToRemove()
        assertTrue(viewModel.isConfirmingRemove)

        viewModel.remove { signedOut = true }
        assertTrue(viewModel.spots.isEmpty())
        assertNull(viewModel.selected)
        assertFalse(viewModel.isConfirmingRemove)
        assertEquals(SPOT_REMOVED, viewModel.message)
    }

    @Test
    fun removingASearchedSpotLeavesThePlaceUnsaved() {
        api.spots += spot("a", placeId = "north")
        load()
        viewModel.showPlace(PARKADE)
        viewModel.askToRemove()
        viewModel.remove { signedOut = true }
        assertEquals("UBC North Parkade", viewModel.selected?.name)
        assertNull(viewModel.selectedSpot)
    }

    @Test
    fun spotAlreadyDeletedElsewhereCountsAsRemoved() {
        val saved = spot("a")
        api.spots += saved
        load()
        api.spots.clear() // deleted on another device
        viewModel.tapSpot(saved)
        viewModel.remove { signedOut = true }
        assertTrue(viewModel.spots.isEmpty())
        assertEquals(SPOT_REMOVED, viewModel.message)
    }

    @Test
    fun failedRemoveKeepsTheSpot() {
        val saved = spot("a")
        api.spots += saved
        load()
        viewModel.tapSpot(saved)
        api.failure = IOException()
        viewModel.remove { signedOut = true }
        assertEquals(listOf(saved), viewModel.spots)
        assertEquals(REMOVE_FAILED, viewModel.message)
    }

    @Test
    fun closingTheSheetForgetsThePlace() {
        viewModel.showPlace(PARKADE)
        viewModel.closeSheet()
        assertNull(viewModel.selected)
    }
}
