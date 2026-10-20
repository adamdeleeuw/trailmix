package com.example.cpen321application.ui.profile

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.cpen321application.data.AccountApi
import com.example.cpen321application.data.AuthApi
import com.example.cpen321application.data.HttpException
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.UnauthorizedException
import com.example.cpen321application.data.User
import com.example.cpen321application.ui.SAVE_FAILED
import com.example.cpen321application.ui.SAVE_OFFLINE
import com.example.cpen321application.ui.commute.REQUIRED
import com.example.cpen321application.ui.components.digitsToNumber
import java.io.IOException
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

const val GAS_PRICE_OUT_OF_RANGE = "Enter a price between 50.0 and 400.0"
const val DELETE_FAILED = "Couldn't delete your account. Check your connection and try again."

const val GAS_PRICE_MAX_DIGITS = 4 // "400.0" is the largest allowed price
private val CENTS_PER_LITRE_RANGE = 50.0..400.0
private const val DIGITS_PER_CENT = 10 // prices have one decimal, so 189.9 is typed as "1899"

/** What the Profile tab shows. */
sealed interface ProfileState {
    data object Loading : ProfileState
    data object Failed : ProfileState // shows "Couldn't load your profile." with Retry
    data class Loaded(val user: User) : ProfileState
}

/** The dialogs the Profile tab can open. Only one is open at a time. */
enum class ProfileDialog { GAS_PRICE, SIGN_OUT, DELETE_ACCOUNT }

/**
 * Loads the signed-in user's profile and runs the Profile tab's dialogs.
 *
 * Everything the tab shows lives here, so rotating the screen keeps it, including
 * the gas price being typed. A rejected session calls `onUnauthorized`, which signs
 * the user out.
 */
class ProfileViewModel(
    private val authApi: AuthApi,
    private val accountApi: AccountApi,
    private val store: SessionStore,
) : ViewModel() {
    var state by mutableStateOf<ProfileState>(ProfileState.Loading)
        private set
    var dialog by mutableStateOf<ProfileDialog?>(null)
        private set
    var showSavedMessage by mutableStateOf(false) // "Saved" after an edit screen saves
        private set

    var gasDigits by mutableStateOf("") // only the digits typed, see DecimalDigitsField
        private set
    var isSavingGasPrice by mutableStateOf(false)
        private set
    var gasPriceSaveError by mutableStateOf<String?>(null)
        private set
    private var gasPriceSubmitted by mutableStateOf(false)

    var isDeleting by mutableStateOf(false)
        private set
    var deleteError by mutableStateOf<String?>(null)
        private set

    private var started = false // the profile only loads the first time the tab opens

    val gasPriceError get() = when {
        !gasPriceSubmitted -> null
        gasDigits.isEmpty() -> REQUIRED
        (digitsToNumber(gasDigits) ?: 0.0) !in CENTS_PER_LITRE_RANGE -> GAS_PRICE_OUT_OF_RANGE
        else -> null
    }

    /** Loads the profile the first time the Profile tab opens after the app starts. */
    fun loadIfNeeded(onUnauthorized: () -> Unit) {
        if (started) return
        started = true
        load(onUnauthorized)
    }

    /** Loads the profile. Also what the Retry button calls. */
    fun load(onUnauthorized: () -> Unit) {
        state = ProfileState.Loading
        viewModelScope.launch {
            state = try {
                ProfileState.Loaded(authApi.getMe(token()))
            } catch (e: UnauthorizedException) {
                onUnauthorized()
                ProfileState.Loading
            } catch (e: IOException) {
                ProfileState.Failed
            }
        }
    }

    /** Shows an edit screen's saved changes, with a short "Saved" message. */
    fun profileSaved(user: User) {
        state = ProfileState.Loaded(user)
        showSavedMessage = true
    }

    /** Called once the "Saved" message has been shown. */
    fun savedMessageShown() {
        showSavedMessage = false
    }

    /** Opens a dialog. The gas price field starts with the saved price, or empty if none is saved. */
    fun openDialog(dialog: ProfileDialog) {
        if (dialog == ProfileDialog.GAS_PRICE) {
            val saved = (state as? ProfileState.Loaded)?.user?.lastGasPrice
            gasDigits = saved?.let { (it.centsPerLitre * DIGITS_PER_CENT).roundToInt().toString() }.orEmpty()
            gasPriceSubmitted = false
            gasPriceSaveError = null
        }
        deleteError = null
        this.dialog = dialog
    }

    /** Closes the open dialog, unless the account is being deleted. */
    fun closeDialog() {
        if (!isDeleting) dialog = null
    }

    /** Stores the gas price digits after [DecimalDigitsField] has filtered them. */
    fun changeGasDigits(digits: String) {
        gasDigits = digits
    }

    /**
     * Saves the typed gas price if it's valid, then closes the dialog. Does nothing
     * while a save is already running, so a double tap sends one save.
     */
    fun saveGasPrice(onUnauthorized: () -> Unit) {
        if (isSavingGasPrice) return
        gasPriceSubmitted = true
        gasPriceSaveError = null
        if (gasPriceError != null) return
        val centsPerLitre = digitsToNumber(gasDigits) ?: return
        isSavingGasPrice = true
        viewModelScope.launch {
            try {
                state = ProfileState.Loaded(accountApi.saveGasPrice(token(), centsPerLitre))
                dialog = null
            } catch (e: UnauthorizedException) {
                onUnauthorized()
            } catch (e: HttpException) {
                gasPriceSaveError = SAVE_FAILED
            } catch (e: IOException) {
                gasPriceSaveError = SAVE_OFFLINE
            } finally {
                isSavingGasPrice = false
            }
        }
    }

    /**
     * Permanently deletes the account. The dialog can't be closed until it finishes,
     * and on failure the user stays signed in with the dialog open.
     *
     * @param onDeleted Called once the account is deleted, to sign the user out.
     */
    fun deleteAccount(onDeleted: () -> Unit, onUnauthorized: () -> Unit) {
        if (isDeleting) return
        isDeleting = true
        deleteError = null
        viewModelScope.launch {
            val deleted = try {
                accountApi.deleteAccount(token())
                true
            } catch (e: UnauthorizedException) {
                onUnauthorized()
                false
            } catch (e: IOException) {
                deleteError = DELETE_FAILED
                false
            }
            isDeleting = false
            if (deleted) {
                dialog = null
                onDeleted()
            }
        }
    }

    /** Forgets the profile, so the next user to sign in loads their own. */
    fun reset() {
        state = ProfileState.Loading
        started = false
        dialog = null
        showSavedMessage = false
        deleteError = null
    }

    private suspend fun token() = store.token() ?: throw UnauthorizedException()
}
