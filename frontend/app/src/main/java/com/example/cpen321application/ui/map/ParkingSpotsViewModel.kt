package com.example.cpen321application.ui.map

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.cpen321application.data.HttpException
import com.example.cpen321application.data.PARKING_DUPLICATE_ERROR
import com.example.cpen321application.data.PARKING_LIMIT_ERROR
import com.example.cpen321application.data.ParkingSpot
import com.example.cpen321application.data.ParkingSpotApi
import com.example.cpen321application.data.ParkingSpotDetails
import com.example.cpen321application.data.PlaceDetails
import com.example.cpen321application.data.PlaceSearch
import com.example.cpen321application.data.RateUnit
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.UnauthorizedException
import com.example.cpen321application.ui.SAVE_FAILED
import com.example.cpen321application.ui.SAVE_OFFLINE
import com.google.android.gms.maps.model.LatLng
import java.io.IOException
import java.net.HttpURLConnection.HTTP_CONFLICT
import java.net.HttpURLConnection.HTTP_NOT_FOUND
import kotlinx.coroutines.launch

const val DROPPED_PIN = "Dropped pin"
const val SPOT_SAVED = "Parking spot saved"
const val SPOT_REMOVED = "Parking spot removed"
const val SPOT_LIMIT = "You can save up to $MAX_PARKING_SPOTS parking spots. Remove one first."
const val SPOT_ALREADY_SAVED = "This place is already one of your parking spots."
const val SPOT_GONE = "This parking spot was already removed."
const val SPOTS_LOAD_FAILED = "Couldn't load your parking spots. Check your connection."
const val REMOVE_FAILED = "Couldn't remove. Check your connection and try again."

/**
 * The place the sheet is open for.
 *
 * @property spotId The saved spot it is, or `null` if it isn't saved.
 * @property fromMarker Whether it was opened by tapping a P marker, rather than search or a long-press.
 */
data class SelectedPlace(
    val name: String,
    val address: String?,
    val location: LatLng,
    val placeId: String?,
    val spotId: String? = null,
    val fromMarker: Boolean = false,
)

/**
 * What the Save as parking spot dialog holds while the user types.
 *
 * @property editingId The spot being edited, or `null` when saving a new one.
 * @property cost The typed cost in dollars; empty means unknown.
 */
data class SpotForm(
    val editingId: String?,
    val label: String,
    val cost: String,
    val ratePer: RateUnit,
    val noOvernight: Boolean,
)

/** The user's parking spots, the place sheet, and the save and remove dialogs on the Map tab. */
class ParkingSpotsViewModel(
    private val api: ParkingSpotApi,
    private val places: PlaceSearch,
    private val store: SessionStore,
) : ViewModel() {
    /** Every saved spot, newest first, shown as P markers. */
    var spots by mutableStateOf<List<ParkingSpot>>(emptyList())
        private set

    /** The place the sheet is open for, or `null` when it's closed. */
    var selected by mutableStateOf<SelectedPlace?>(null)
        private set

    /** The open save or edit dialog, or `null` when it's closed. */
    var form by mutableStateOf<SpotForm?>(null)
        private set

    var isSaving by mutableStateOf(false)
        private set

    /** Why the last save failed, shown in the dialog, which stays open. */
    var saveError by mutableStateOf<String?>(null)
        private set

    var isConfirmingRemove by mutableStateOf(false)
        private set

    var isRemoving by mutableStateOf(false)
        private set

    /** A point for the map to pan to, until [focusHandled] clears it. */
    var focus by mutableStateOf<LatLng?>(null)
        private set

    /** The snackbar message, until [messageShown] clears it. */
    var message by mutableStateOf<String?>(null)
        private set

    /** The saved spot the sheet is open for, matched by ID or by Google place, or `null`. */
    val selectedSpot: ParkingSpot?
        get() = selected?.let { place ->
            spots.firstOrNull { it.id == place.spotId || (place.placeId != null && it.placeId == place.placeId) }
        }

    /** Loads the user's spots for the P markers. */
    fun loadSpots(onUnauthorized: () -> Unit) {
        viewModelScope.launch {
            try {
                spots = api.getParkingSpots(token())
            } catch (e: UnauthorizedException) {
                onUnauthorized()
            } catch (e: IOException) {
                message = SPOTS_LOAD_FAILED
            }
        }
    }

    /** Opens the sheet for a place picked from search and pans to it. */
    fun showPlace(place: PlaceDetails) {
        selected = SelectedPlace(place.name, place.address, place.location, place.placeId)
        focus = place.location
    }

    /** Opens the sheet for a long-pressed point, then fills in the nearest address if there is one. */
    fun dropPin(location: LatLng) {
        val pin = SelectedPlace(DROPPED_PIN, address = null, location, placeId = null)
        selected = pin
        viewModelScope.launch {
            val address = places.nearestAddress(location)
            if (selected == pin) selected = pin.copy(address = address)
        }
    }

    /** Opens the sheet for a tapped P marker. */
    fun tapSpot(spot: ParkingSpot) {
        selected = SelectedPlace(
            spot.details.label, address = null, spot.location, spot.placeId, spotId = spot.id, fromMarker = true,
        )
    }

    fun closeSheet() {
        selected = null
        isConfirmingRemove = false
    }

    /** Opens the save dialog with the place's name filled in, or the limit message if there are already 20. */
    fun openSaveDialog() {
        val place = selected ?: return
        if (spots.size >= MAX_PARKING_SPOTS) {
            message = SPOT_LIMIT
            return
        }
        saveError = null
        form = SpotForm(null, place.name.take(MAX_LABEL_LENGTH), cost = "", RateUnit.HOUR, noOvernight = false)
    }

    /** Opens the same dialog with the selected spot's current values. */
    fun openEditDialog() {
        val spot = selectedSpot ?: return
        saveError = null
        form = SpotForm(
            editingId = spot.id,
            label = spot.details.label,
            cost = centsToCostText(spot.details.rateCents),
            ratePer = spot.details.ratePer ?: RateUnit.HOUR,
            noOvernight = !spot.details.overnightAllowed,
        )
    }

    /** Replaces what the dialog holds after the user edits a field. */
    fun changeForm(updated: SpotForm) {
        form = updated
    }

    /** Closes the dialog, unless a save is still running. */
    fun closeDialog() {
        if (!isSaving) form = null
    }

    /** Saves the dialog's spot. Taps while it's already saving, or with an invalid field, are ignored. */
    fun save(onUnauthorized: () -> Unit) {
        val current = form
        val place = selected
        val ready = !isSaving && current?.isValid() == true
        if (current == null || place == null || !ready) return
        isSaving = true
        saveError = null
        viewModelScope.launch {
            try {
                val saved = upload(current, place)
                spots = listOf(saved) + spots.filterNot { it.id == saved.id }
                selected = place.copy(spotId = saved.id)
                form = null
                message = SPOT_SAVED
            } catch (e: UnauthorizedException) {
                onUnauthorized()
            } catch (e: HttpException) {
                saveError = saveErrorFor(e)
            } catch (e: IOException) {
                saveError = SAVE_OFFLINE
            } finally {
                isSaving = false
            }
        }
    }

    fun askToRemove() {
        isConfirmingRemove = true
    }

    fun cancelRemove() {
        if (!isRemoving) isConfirmingRemove = false
    }

    /** Deletes the selected spot after the user confirms. A spot that's already gone counts as removed. */
    fun remove(onUnauthorized: () -> Unit) {
        val spot = selectedSpot ?: return
        if (isRemoving) return
        isRemoving = true
        viewModelScope.launch {
            try {
                deleteIgnoringMissing(spot.id)
                spots = spots.filterNot { it.id == spot.id }
                // a spot opened from its marker has nothing left to show; a searched place goes back to unsaved
                selected = selected?.takeUnless { it.fromMarker }?.copy(spotId = null)
                message = SPOT_REMOVED
            } catch (e: UnauthorizedException) {
                onUnauthorized()
            } catch (e: IOException) {
                message = REMOVE_FAILED
            } finally {
                isRemoving = false
                isConfirmingRemove = false
            }
        }
    }

    fun focusHandled() {
        focus = null
    }

    fun messageShown() {
        message = null
    }

    private suspend fun token() = store.token() ?: throw UnauthorizedException()

    private fun SpotForm.isValid() = labelError(label) == null && costError(cost) == null

    // a new spot is saved with the selected place's location; an edit only sends the details
    private suspend fun upload(form: SpotForm, place: SelectedPlace): ParkingSpot {
        val cents = costToCents(form.cost)
        val details = ParkingSpotDetails(
            label = form.label.trim(),
            rateCents = cents,
            ratePer = form.ratePer.takeIf { cents != null },
            overnightAllowed = !form.noOvernight,
        )
        val id = form.editingId
        return if (id == null) {
            api.saveParkingSpot(token(), place.location, place.placeId, details)
        } else {
            api.updateParkingSpot(token(), id, details)
        }
    }

    private suspend fun deleteIgnoringMissing(id: String) {
        try {
            api.deleteParkingSpot(token(), id)
        } catch (e: HttpException) {
            if (e.code != HTTP_NOT_FOUND) throw e // 404: deleted on another device
        }
    }

    private fun saveErrorFor(e: HttpException) = when {
        e.code == HTTP_CONFLICT && e.error == PARKING_LIMIT_ERROR -> SPOT_LIMIT
        e.code == HTTP_CONFLICT && e.error == PARKING_DUPLICATE_ERROR -> SPOT_ALREADY_SAVED
        e.code == HTTP_NOT_FOUND -> SPOT_GONE
        else -> SAVE_FAILED
    }
}
