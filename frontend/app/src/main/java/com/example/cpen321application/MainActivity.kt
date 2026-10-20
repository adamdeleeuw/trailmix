package com.example.cpen321application

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.example.cpen321application.data.BackendApi
import com.example.cpen321application.data.DataStoreSessionStore
import com.example.cpen321application.data.GoogleSignInClient
import com.example.cpen321application.ui.AuthViewModel
import com.example.cpen321application.ui.TrailmixApp
import com.example.cpen321application.ui.main.TripHistoryViewModel
import com.example.cpen321application.ui.questionnaire.QuestionnaireScreen
import com.example.cpen321application.ui.questionnaire.QuestionnaireViewModel
import com.example.cpen321application.ui.theme.CPEN321ApplicationTheme

/** The app's only activity. [AuthViewModel] decides which screen it shows. */
class MainActivity : ComponentActivity() {
    private val viewModel: AuthViewModel by viewModels {
        viewModelFactory {
            initializer {
                AuthViewModel(BackendApi, DataStoreSessionStore(application)) {
                    GoogleSignInClient.forgetAccount(application)
                }
            }
        }
    }

    private val questionnaireViewModel: QuestionnaireViewModel by viewModels {
        viewModelFactory { initializer { QuestionnaireViewModel(BackendApi, DataStoreSessionStore(application)) } }
    }

    private val tripHistoryViewModel: TripHistoryViewModel by viewModels {
        viewModelFactory { initializer { TripHistoryViewModel(BackendApi, DataStoreSessionStore(application)) } }
    }

    // clears the questionnaire too, so the next sign-in starts it empty
    private fun signOut() {
        questionnaireViewModel.reset()
        tripHistoryViewModel.reset()
        viewModel.signOut()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CPEN321ApplicationTheme {
                TrailmixApp(
                    state = viewModel.state,
                    isSigningIn = viewModel.isSigningIn,
                    signInError = viewModel.signInError,
                    onSignIn = { viewModel.signIn { GoogleSignInClient.getIdToken(this) } },
                    onRetry = viewModel::load,
                    onSignOut = ::signOut,
                    tripHistory = tripHistoryViewModel,
                ) {
                    QuestionnaireScreen(questionnaireViewModel, onSaved = viewModel::profileSaved, onSignOut = ::signOut)
                }
            }
        }
    }
}
