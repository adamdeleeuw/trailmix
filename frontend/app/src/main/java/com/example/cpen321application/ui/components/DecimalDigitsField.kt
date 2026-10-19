package com.example.cpen321application.ui.components

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalTextToolbar
import androidx.compose.ui.platform.TextToolbar
import androidx.compose.ui.platform.TextToolbarStatus
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation

/**
 * Applies one edit to the typed digits, keeping only what the field allows.
 *
 * Only typing one digit at the end or deleting the last one is accepted, so pasted
 * or mid-text edits are ignored. Leading zeros and digits past [maxDigits] are ignored too.
 *
 * @param digits The digits typed so far.
 * @param edited The field's text after the user's edit.
 * @param maxDigits How many digits can be typed.
 * @return The digits to keep.
 */
fun applyDigitEdit(digits: String, edited: String, maxDigits: Int): String {
    if (digits.isNotEmpty() && edited == digits.dropLast(1)) return edited
    val typed = if (edited.startsWith(digits)) edited.substring(digits.length).singleOrNull() else null
    return when {
        typed == null || typed !in '0'..'9' -> digits
        digits.length >= maxDigits -> digits
        digits.isEmpty() && typed == '0' -> digits
        else -> digits + typed
    }
}

/** Formats typed digits with the decimal point before the last one, e.g. "72" as "7.2" and "7" as "0.7". */
fun formatDigits(digits: String): String = when (digits.length) {
    0 -> ""
    1 -> "0.$digits"
    else -> "${digits.dropLast(1)}.${digits.last()}"
}

/** Converts typed digits to the number they show, e.g. "72" to 7.2, or `null` if nothing is typed. */
fun digitsToNumber(digits: String): Double? = digits.toIntOrNull()?.div(10.0)

// shows the typed digits with the decimal inserted, and the cursor always sits at the end
private object DecimalPointTransformation : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val formatted = formatDigits(text.text)
        val mapping = object : OffsetMapping {
            override fun originalToTransformed(offset: Int) =
                if (offset >= text.length) formatted.length else offset

            override fun transformedToOriginal(offset: Int) = offset.coerceAtMost(text.length)
        }
        return TransformedText(AnnotatedString(formatted), mapping)
    }
}

// no copy/paste menu, so pasting can't put anything but typed digits in the field
private object NoTextToolbar : TextToolbar {
    override val status = TextToolbarStatus.Hidden

    override fun hide() = Unit

    override fun showMenu(
        rect: Rect,
        onCopyRequested: (() -> Unit)?,
        onPasteRequested: (() -> Unit)?,
        onCutRequested: (() -> Unit)?,
        onSelectAllRequested: (() -> Unit)?,
    ) = Unit
}

/**
 * A number field with one decimal place, where the user types digits only and the
 * decimal point is placed for them. Used for fuel consumption and gas price.
 *
 * @param digits The typed digits, which the caller keeps. Convert with [digitsToNumber].
 * @param onDigitsChange Called with the new digits after each accepted edit.
 * @param maxDigits How many digits can be typed, e.g. 3 for "40.0".
 * @param error The message to show under the field, or `null` for none.
 */
@Composable
fun DecimalDigitsField(
    digits: String,
    onDigitsChange: (String) -> Unit,
    label: String,
    maxDigits: Int,
    error: String?,
    modifier: Modifier = Modifier,
) {
    CompositionLocalProvider(LocalTextToolbar provides NoTextToolbar) {
        OutlinedTextField(
            value = TextFieldValue(digits, selection = TextRange(digits.length)),
            onValueChange = { onDigitsChange(applyDigitEdit(digits, it.text, maxDigits)) },
            modifier = modifier,
            label = { Text(label) },
            placeholder = { Text("0.0", color = MaterialTheme.colorScheme.onSurfaceVariant) },
            isError = error != null,
            supportingText = error?.let { { Text(it) } },
            visualTransformation = DecimalPointTransformation,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), // digits only
            singleLine = true,
        )
    }
}
