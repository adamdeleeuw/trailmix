package com.example.cpen321application

import com.example.cpen321application.ui.components.applyDigitEdit
import com.example.cpen321application.ui.components.digitsToNumber
import com.example.cpen321application.ui.components.formatDigits
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// types each character into the field in turn, as the keyboard would
private fun type(keys: String, maxDigits: Int = 3) =
    keys.fold("") { digits, key -> applyDigitEdit(digits, digits + key, maxDigits) }

class DecimalDigitsFieldTest {
    @Test
    fun digitsFillInFromTheRight() {
        assertEquals("0.7", formatDigits(type("7")))
        assertEquals("7.2", formatDigits(type("72")))
        assertEquals("12.5", formatDigits(type("125")))
        assertEquals("", formatDigits(type("")))
    }

    @Test
    fun stopsAtMaxDigits() {
        assertEquals("125", type("1259"))
        assertEquals("1259", type("1259", maxDigits = 4))
    }

    @Test
    fun ignoresLeadingZerosButNotLaterOnes() {
        assertEquals("72", type("0072"))
        assertEquals("400", type("400"))
    }

    @Test
    fun ignoresAnythingButDigits() {
        assertEquals("72", type("7.2"))
        assertEquals("72", type("7-2"))
        assertEquals("", type("٣")) // a non-ASCII digit
    }

    @Test
    fun backspaceRemovesTheLastDigit() {
        assertEquals("12", applyDigitEdit("125", "12", maxDigits = 3))
        assertEquals("1.2", formatDigits(applyDigitEdit("125", "12", maxDigits = 3)))
        assertEquals("", applyDigitEdit("7", "", maxDigits = 3))
    }

    @Test
    fun ignoresPastesAndEditsInTheMiddle() {
        assertEquals("7", applyDigitEdit("7", "7123", maxDigits = 3))
        assertEquals("", applyDigitEdit("", "72", maxDigits = 3))
        assertEquals("72", applyDigitEdit("72", "752", maxDigits = 3))
        assertEquals("72", applyDigitEdit("72", "2", maxDigits = 3))
    }

    @Test
    fun convertsToTheShownNumber() {
        assertEquals(7.2, digitsToNumber("72")!!, 0.0)
        assertEquals(0.9, digitsToNumber("9")!!, 0.0)
        assertEquals(40.0, digitsToNumber("400")!!, 0.0)
        assertNull(digitsToNumber(""))
    }
}
