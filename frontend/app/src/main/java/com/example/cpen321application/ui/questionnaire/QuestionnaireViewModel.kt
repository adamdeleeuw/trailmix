package com.example.cpen321application.ui.questionnaire

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.cpen321application.data.FareType
import com.example.cpen321application.data.HttpException
import com.example.cpen321application.data.Profile
import com.example.cpen321application.data.ProfileApi
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.Transit
import com.example.cpen321application.data.UnauthorizedException
import com.example.cpen321application.data.User
import com.example.cpen321application.data.Vehicle
import com.example.cpen321application.ui.components.digitsToNumber
import java.io.IOException
import java.util.TimeZone
import kotlinx.coroutines.launch

const val CHOOSE_AN_OPTION = "Please choose an option"
const val REQUIRED = "Required"
const val FUEL_OUT_OF_RANGE = "Enter a number between 1.0 and 40.0"
const val SAVE_OFFLINE = "Couldn't save. Check your connection and try again."
const val SAVE_FAILED = "Something went wrong. Please try again."

const val FUEL_MAX_DIGITS = 3 // "40.0" is the largest allowed value
private val LITRES_PER_100KM_RANGE = 1.0..40.0

/** Colours a car can be. The backend checks against the same list. */
val COLOURS = listOf(
    "Black", "White", "Grey", "Silver", "Blue", "Red", "Green",
    "Brown", "Beige", "Gold", "Yellow", "Orange", "Purple", "Burgundy",
)

/** Monthly pass zones the user can pick. */
val PASS_ZONES = listOf(1, 2, 3)

/** The answers to "How do you usually pay for transit?". [NONE] has no fare type. */
enum class TransitChoice(val label: String, val fareType: FareType?) {
    ADULT_STORED_VALUE("Compass Card: adult, pay per trip", FareType.ADULT_STORED_VALUE),
    CONCESSION_STORED_VALUE(
        "Compass Card: concession, pay per trip (ages 13–18 or 65+)",
        FareType.CONCESSION_STORED_VALUE,
    ),
    CONTACTLESS("Tap a credit/debit card or phone", FareType.CONTACTLESS),
    ADULT_MONTHLY_PASS("Adult monthly pass", FareType.ADULT_MONTHLY_PASS),
    CONCESSION_MONTHLY_PASS("Concession monthly pass", FareType.CONCESSION_MONTHLY_PASS),
    UPASS("U-Pass BC", FareType.UPASS),
    NONE("I don't take transit", null),
}

/**
 * Holds the commute questionnaire's answers and saves them.
 *
 * Answers live here so rotating the screen keeps them. Errors only show after the
 * first Submit, and each one is worked out from the current answers, so it goes
 * away as soon as its field is fixed.
 */
class QuestionnaireViewModel(private val api: ProfileApi, private val store: SessionStore) : ViewModel() {
    var drives by mutableStateOf<Boolean?>(null) // null until Yes or No is tapped
        private set
    var make by mutableStateOf<String?>(null)
        private set
    var model by mutableStateOf<String?>(null)
        private set
    var colour by mutableStateOf<String?>(null)
        private set
    var fuelDigits by mutableStateOf("") // only the digits typed, see DecimalDigitsField
        private set
    var transit by mutableStateOf<TransitChoice?>(null)
        private set
    var zones by mutableStateOf<Int?>(null)
        private set

    var makes by mutableStateOf(emptyList<String>())
        private set
    var makesFailed by mutableStateOf(false)
        private set
    var models by mutableStateOf(emptyList<String>())
        private set
    var modelsFailed by mutableStateOf(false)
        private set

    var isSaving by mutableStateOf(false)
        private set
    var saveError by mutableStateOf<String?>(null)
        private set

    private var submitted by mutableStateOf(false)

    val drivesError get() = choiceError(drives)
    val makeError get() = vehicleError(make)
    val modelError get() = vehicleError(model)
    val fuelError get() = when {
        !submitted || drives != true -> null
        fuelDigits.isEmpty() -> REQUIRED
        (digitsToNumber(fuelDigits) ?: 0.0) !in LITRES_PER_100KM_RANGE -> FUEL_OUT_OF_RANGE
        else -> null
    }
    val transitError get() = choiceError(transit)
    val zonesError get() = if (transit == TransitChoice.ADULT_MONTHLY_PASS) choiceError(zones) else null

    private fun choiceError(answer: Any?) = if (submitted && answer == null) CHOOSE_AN_OPTION else null

    // vehicle fields only count when the user drives
    private fun vehicleError(answer: String?) = if (submitted && drives == true && answer == null) REQUIRED else null

    /** Loads the car makes, unless they're already loaded. Also what the Make field's Retry calls. */
    fun loadMakes() {
        if (makes.isNotEmpty()) return
        makesFailed = false
        viewModelScope.launch {
            try {
                makes = api.getMakes(token())
            } catch (e: IOException) {
                makesFailed = true
            }
        }
    }

    /** Loads the models for the picked make. Also what the Model field's Retry calls. */
    fun loadModels() {
        val make = make ?: return
        modelsFailed = false
        viewModelScope.launch {
            try {
                val loaded = api.getModels(token(), make)
                if (make == this@QuestionnaireViewModel.make) models = loaded // ignore a make changed meanwhile
            } catch (e: IOException) {
                modelsFailed = true
            }
        }
    }

    /** Answers "Do you drive?". Switching to No keeps the car answers in case the user switches back. */
    fun chooseDrives(drives: Boolean) {
        this.drives = drives
    }

    /** Picks a make, which clears the model since it belonged to the old make. */
    fun chooseMake(make: String) {
        if (make == this.make) return
        this.make = make
        model = null
        models = emptyList()
        loadModels()
    }

    /** Picks a model of the current make. */
    fun chooseModel(model: String) {
        this.model = model
    }

    /** Picks a colour. */
    fun chooseColour(colour: String) {
        this.colour = colour
    }

    /** Stores the fuel consumption digits after [DecimalDigitsField] has filtered them. */
    fun changeFuelDigits(digits: String) {
        fuelDigits = digits
    }

    /** Answers "How do you usually pay for transit?". */
    fun chooseTransit(transit: TransitChoice) {
        this.transit = transit
    }

    /** Picks the zones for an adult monthly pass. */
    fun chooseZones(zones: Int) {
        this.zones = zones
    }

    /**
     * Saves the answers if they're all valid, otherwise shows what's missing.
     * Does nothing while a save is already running, so a double tap sends one save.
     *
     * @param onSaved Called with the updated account once it's saved.
     * @param onUnauthorized Called when the session is no longer valid.
     */
    fun submit(onSaved: (User) -> Unit, onUnauthorized: () -> Unit) {
        if (isSaving) return
        submitted = true
        saveError = null
        val profile = validProfile() ?: return
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
        drives = null
        make = null
        model = null
        colour = null
        fuelDigits = ""
        transit = null
        zones = null
        models = emptyList()
        submitted = false
        saveError = null
    }

    private suspend fun token() = store.token() ?: throw UnauthorizedException()

    private fun validProfile(): Profile? {
        val errors = listOf(drivesError, makeError, modelError, fuelError, transitError, zonesError)
        if (errors.any { it != null }) return null
        val fareType = transit?.fareType
        return Profile(
            timezone = TimeZone.getDefault().id,
            vehicle = if (drives == true) vehicle() else null,
            transit = fareType?.let { Transit(it, if (it == FareType.ADULT_MONTHLY_PASS) zones else null) },
        )
    }

    private fun vehicle(): Vehicle? {
        val make = make ?: return null
        val model = model ?: return null
        val litres = digitsToNumber(fuelDigits) ?: return null
        return Vehicle(make, model, colour, litres)
    }
}
