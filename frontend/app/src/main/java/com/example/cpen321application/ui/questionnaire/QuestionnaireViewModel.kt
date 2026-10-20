package com.example.cpen321application.ui.questionnaire

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

/**
 * Holds the commute questionnaire's answers and saves them.
 *
 * Answers live here so rotating the screen keeps them. Errors only show after the
 * first Submit (see [VehicleForm] and [TransitForm]).
 */
class QuestionnaireViewModel(private val api: ProfileApi, private val store: SessionStore) : ViewModel() {
    val vehicleForm = VehicleForm(api, viewModelScope, ::token)
    val transitForm = TransitForm()

    var isSaving by mutableStateOf(false)
        private set
    var saveError by mutableStateOf<String?>(null)
        private set

    /**
     * Saves the answers if they're all valid, otherwise shows what's missing.
     * Does nothing while a save is already running, so a double tap sends one save.
     *
     * @param onSaved Called with the updated account once it's saved.
     * @param onUnauthorized Called when the session is no longer valid.
     */
    fun submit(onSaved: (User) -> Unit, onUnauthorized: () -> Unit) {
        if (isSaving) return
        vehicleForm.showErrors = true
        transitForm.showErrors = true
        saveError = null
        if (!vehicleForm.isValid || !transitForm.isValid) return
        val profile = Profile(TimeZone.getDefault().id, vehicleForm.vehicle(), transitForm.transit())
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

    /** Clears every answer, so the next user to sign in starts empty. The make list is kept. */
    fun reset() {
        vehicleForm.reset()
        transitForm.reset()
        saveError = null
    }

    private suspend fun token() = store.token() ?: throw UnauthorizedException()
}
