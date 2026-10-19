package com.example.cpen321application.ui.commute

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.example.cpen321application.data.ProfileApi
import com.example.cpen321application.data.Vehicle
import com.example.cpen321application.ui.components.digitsToNumber
import java.io.IOException
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

const val CHOOSE_AN_OPTION = "Please choose an option"
const val REQUIRED = "Required"
const val FUEL_OUT_OF_RANGE = "Enter a number between 1.0 and 40.0"

const val FUEL_MAX_DIGITS = 3 // "40.0" is the largest allowed value
private val LITRES_PER_100KM_RANGE = 1.0..40.0
private const val DIGITS_PER_UNIT = 10 // fuel consumption has one decimal, so 7.2 is typed as "72"

/** Colours a car can be. The backend checks against the same list. */
val COLOURS = listOf(
    "Black", "White", "Grey", "Silver", "Blue", "Red", "Green",
    "Brown", "Beige", "Gold", "Yellow", "Orange", "Purple", "Burgundy",
)

/**
 * The "Do you drive?" answers and their rules, shared by the questionnaire and the
 * Edit vehicle screen. Lives in a ViewModel, so rotating the screen keeps it.
 *
 * Errors only show once [showErrors] is set, and each one is worked out from the
 * current answers, so it goes away as soon as its field is fixed.
 *
 * @param scope Where the make and model lists load, usually the owning ViewModel's scope.
 * @param token Returns the session token for the list requests.
 */
class VehicleForm(
    private val api: ProfileApi,
    private val scope: CoroutineScope,
    private val token: suspend () -> String,
) {
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

    var makes by mutableStateOf(emptyList<String>())
        private set
    var makesFailed by mutableStateOf(false)
        private set
    var models by mutableStateOf(emptyList<String>())
        private set
    var modelsFailed by mutableStateOf(false)
        private set

    /** Set when the user first tries to save, so errors don't show on an untouched form. */
    var showErrors by mutableStateOf(false)

    val drivesError get() = if (showErrors && drives == null) CHOOSE_AN_OPTION else null
    val makeError get() = carError(make)
    val modelError get() = carError(model)
    val fuelError get() = when {
        !showErrors || drives != true -> null
        fuelDigits.isEmpty() -> REQUIRED
        (digitsToNumber(fuelDigits) ?: 0.0) !in LITRES_PER_100KM_RANGE -> FUEL_OUT_OF_RANGE
        else -> null
    }

    /** Whether every answer is filled in and valid, ignoring [showErrors]. */
    val isValid get() = drives != null && (drives == false || vehicle() != null && fuelInRange())

    // car fields only count when the user drives
    private fun carError(answer: String?) = if (showErrors && drives == true && answer == null) REQUIRED else null

    private fun fuelInRange() = (digitsToNumber(fuelDigits) ?: 0.0) in LITRES_PER_100KM_RANGE

    /** Loads the car makes, unless they're already loaded. Also what the Make field's Retry calls. */
    fun loadMakes() {
        if (makes.isNotEmpty()) return
        makesFailed = false
        scope.launch {
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
        scope.launch {
            try {
                val loaded = api.getModels(token(), make)
                if (make == this@VehicleForm.make) models = loaded // ignore a make changed meanwhile
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

    /** Fills the form with saved answers, where `null` means the user doesn't drive. */
    fun fill(vehicle: Vehicle?) {
        drives = vehicle != null
        make = vehicle?.make
        model = vehicle?.model
        colour = vehicle?.colour
        fuelDigits = vehicle?.let { (it.litresPer100km * DIGITS_PER_UNIT).roundToInt().toString() }.orEmpty()
        models = emptyList()
        loadModels()
    }

    /** Clears every answer. The make list is kept. */
    fun reset() {
        drives = null
        make = null
        model = null
        colour = null
        fuelDigits = ""
        models = emptyList()
        showErrors = false
    }

    /** The answered car, or `null` if the user doesn't drive or hasn't filled every car field. */
    fun vehicle(): Vehicle? {
        if (drives != true) return null
        val make = make ?: return null
        val model = model ?: return null
        val litres = digitsToNumber(fuelDigits) ?: return null
        return Vehicle(make, model, colour, litres)
    }
}
