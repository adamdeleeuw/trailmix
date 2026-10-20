package com.example.cpen321application.ui.commute

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.example.cpen321application.data.FareType
import com.example.cpen321application.data.Transit

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

/** Describes a saved fare in plain words, e.g. "Adult monthly pass, 2 zones", or `null` for no transit. */
fun fareDescription(transit: Transit?): String? {
    if (transit == null) return null
    val label = TransitChoice.entries.first { it.fareType == transit.fareType }.label
    return transit.monthlyPassZones?.let { "$label, ${zonesLabel(it)}" } ?: label
}

/** "1 zone", "2 zones" or "3 zones". */
fun zonesLabel(zones: Int) = if (zones == 1) "1 zone" else "$zones zones"

/**
 * The transit answers and their rules, shared by the questionnaire and the Edit
 * transit screen. Errors work like [VehicleForm]'s.
 */
class TransitForm {
    var choice by mutableStateOf<TransitChoice?>(null)
        private set
    var zones by mutableStateOf<Int?>(null)
        private set

    /** Set when the user first tries to save, so errors don't show on an untouched form. */
    var showErrors by mutableStateOf(false)

    val choiceError get() = choiceError(choice)
    val zonesError get() = if (choice == TransitChoice.ADULT_MONTHLY_PASS) choiceError(zones) else null

    /** Whether every answer is filled in, ignoring [showErrors]. */
    val isValid get() = choice != null && (choice != TransitChoice.ADULT_MONTHLY_PASS || zones != null)

    private fun choiceError(answer: Any?) = if (showErrors && answer == null) CHOOSE_AN_OPTION else null

    /** Answers "How do you usually pay for transit?". */
    fun choose(choice: TransitChoice) {
        this.choice = choice
    }

    /** Picks the zones for an adult monthly pass. */
    fun chooseZones(zones: Int) {
        this.zones = zones
    }

    /** Fills the form with saved answers, where `null` means the user doesn't take transit. */
    fun fill(transit: Transit?) {
        choice = TransitChoice.entries.first { it.fareType == transit?.fareType }
        zones = transit?.monthlyPassZones
    }

    /** Clears every answer. */
    fun reset() {
        choice = null
        zones = null
        showErrors = false
    }

    /** The answered fare, or `null` if the user doesn't take transit or hasn't answered. */
    fun transit(): Transit? {
        val fareType = choice?.fareType ?: return null
        return Transit(fareType, if (fareType == FareType.ADULT_MONTHLY_PASS) zones else null)
    }
}
