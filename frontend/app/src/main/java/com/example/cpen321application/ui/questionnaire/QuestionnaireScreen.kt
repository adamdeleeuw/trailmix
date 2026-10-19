package com.example.cpen321application.ui.questionnaire

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.cpen321application.data.User
import com.example.cpen321application.ui.commute.DrivingFields
import com.example.cpen321application.ui.commute.ErrorText
import com.example.cpen321application.ui.commute.TransitFields

/**
 * The commute questionnaire shown after a user's first sign-in.
 *
 * Back asks before leaving, since leaving signs the user out.
 *
 * @param onSaved Called with the updated account once the answers are saved.
 * @param onSignOut Signs the user out, from the Leave dialog or when the session is no longer valid.
 */
@Composable
fun QuestionnaireScreen(viewModel: QuestionnaireViewModel, onSaved: (User) -> Unit, onSignOut: () -> Unit) {
    var leaving by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) { viewModel.vehicleForm.loadMakes() }
    BackHandler { leaving = true }

    Column(
        modifier = Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Set up your commute", style = MaterialTheme.typography.headlineMedium)
        Text("This helps Trailmix estimate what your trips cost.")
        Text("Driving", style = MaterialTheme.typography.titleLarge)
        DrivingFields(viewModel.vehicleForm)
        Text("Transit", style = MaterialTheme.typography.titleLarge)
        TransitFields(viewModel.transitForm)
        viewModel.saveError?.let { ErrorText(it) }
        Button(onClick = { viewModel.submit(onSaved, onSignOut) }, modifier = Modifier.fillMaxWidth()) {
            if (viewModel.isSaving) CircularProgressIndicator(Modifier.size(20.dp)) else Text("Submit")
        }
    }

    if (leaving) LeaveSetupDialog(onKeepGoing = { leaving = false }, onSignOut = onSignOut)
}

// asks before leaving setup since leaving signs the user out, and Back closes it like Keep going
@Composable
private fun LeaveSetupDialog(onKeepGoing: () -> Unit, onSignOut: () -> Unit) {
    AlertDialog(
        onDismissRequest = onKeepGoing,
        title = { Text("Leave setup?") },
        text = { Text("You'll be signed out. You can finish setting up next time you sign in.") },
        confirmButton = { TextButton(onClick = onSignOut) { Text("Sign out") } },
        dismissButton = { TextButton(onClick = onKeepGoing) { Text("Keep going") } },
    )
}
