package com.example.cpen321application.ui.profile

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.cpen321application.data.HttpException
import com.example.cpen321application.data.Profile
import com.example.cpen321application.data.ProfileApi
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.UnauthorizedException
import com.example.cpen321application.data.User
import com.example.cpen321application.ui.SAVE_FAILED
import com.example.cpen321application.ui.SAVE_OFFLINE
import com.example.cpen321application.ui.commute.TransitForm
import com.example.cpen321application.ui.commute.VehicleForm
import java.io.IOException
import java.util.TimeZone
import kotlinx.coroutines.launch

/** Which section of the profile an edit screen changes. */
enum class ProfileSection { VEHICLE, TRANSIT }

/**
 * Holds the Edit vehicle or Edit transit screen's answers and saves them.
 *
 * Uses the questionnaire's forms, so the fields, rules, and messages are the same.
 * Saving replaces the whole profile, so the section that isn't being edited is sent
 * with its current values.
 */
class EditProfileViewModel(private val api: ProfileApi, private val store: SessionStore) : ViewModel() {
    val vehicleForm = VehicleForm(api, viewModelScope, ::token)
    val transitForm = TransitForm()

    var section by mutableStateOf(ProfileSection.VEHICLE)
        private set
    var isSaving by mutableStateOf(false)
        private set
    var saveError by mutableStateOf<String?>(null)
        private set
    var showDiscardDialog by mutableStateOf(false) // "Discard changes?" after Back with unsaved changes
        private set

    private var user: User? = null
    private var savedAnswers: List<Any?> = emptyList()

    /** Whether [start] has been called. Not after the app is restored from the background with this screen open. */
    val isStarted get() = user != null

    /** Whether the answers differ from the saved ones. */
    val hasChanges get() = answers() != savedAnswers

    /** Starts editing [section], filled in with the user's current answers. Called when Edit is tapped. */
    fun start(section: ProfileSection, user: User) {
        this.section = section
        this.user = user
        vehicleForm.reset()
        transitForm.reset()
        vehicleForm.fill(user.vehicle)
        transitForm.fill(user.transit)
        savedAnswers = answers()
        saveError = null
        showDiscardDialog = false
    }

    /** Called on Back: asks before leaving with unsaved changes, otherwise leaves. */
    fun back(onLeave: () -> Unit) {
        if (hasChanges) showDiscardDialog = true else onLeave()
    }

    /** Closes the "Discard changes?" dialog, keeping the answers. */
    fun keepEditing() {
        showDiscardDialog = false
    }

    /**
     * Saves the section if its answers are valid, otherwise shows what's missing.
     * Does nothing while a save is already running, so a double tap sends one save.
     *
     * @param onSaved Called with the updated account once it's saved.
     * @param onUnauthorized Called when the session is no longer valid.
     */
    fun save(onSaved: (User) -> Unit, onUnauthorized: () -> Unit) {
        val user = user ?: return
        if (isSaving) return
        vehicleForm.showErrors = true
        transitForm.showErrors = true
        saveError = null
        if (!isSectionValid()) return
        val profile = Profile(
            timezone = user.timezone ?: TimeZone.getDefault().id,
            vehicle = if (section == ProfileSection.VEHICLE) vehicleForm.vehicle() else user.vehicle,
            transit = if (section == ProfileSection.TRANSIT) transitForm.transit() else user.transit,
        )
        isSaving = true
        viewModelScope.launch {
            try {
                onSaved(api.saveProfile(token(), profile))
            } catch (e: UnauthorizedException) {
                onUnauthorized()
            } catch (e: HttpException) {
                saveError = SAVE_FAILED
            } catch (e: IOException) {
                saveError = SAVE_OFFLINE
            } finally {
                isSaving = false
            }
        }
    }

    private fun isSectionValid() =
        if (section == ProfileSection.VEHICLE) vehicleForm.isValid else transitForm.isValid

    // the typed answers of the section being edited, compared to tell whether anything changed
    private fun answers(): List<Any?> = when (section) {
        ProfileSection.VEHICLE -> with(vehicleForm) { listOf(drives, make, model, colour, fuelDigits) }
        ProfileSection.TRANSIT -> listOf(transitForm.choice, transitForm.zones)
    }

    private suspend fun token() = store.token() ?: throw UnauthorizedException()
}
