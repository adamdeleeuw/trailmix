package com.example.cpen321application

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.example.cpen321application.data.BackendApi
import com.example.cpen321application.data.DataStoreSessionStore
import com.example.cpen321application.data.GoogleSignInClient
import com.example.cpen321application.data.RouteOption
import com.example.cpen321application.ui.AuthViewModel
import com.example.cpen321application.ui.TrailmixApp
import com.example.cpen321application.ui.auth.SignInScreen
import com.example.cpen321application.ui.main.EndActiveTripDialog
import com.example.cpen321application.ui.main.MainScreen
import com.example.cpen321application.ui.main.TripHistoryScreen
import com.example.cpen321application.ui.main.TripHistoryViewModel
import com.example.cpen321application.ui.main.rememberTripSnackbar
import com.example.cpen321application.ui.map.MapHomeScreen
import com.example.cpen321application.ui.navigation.NavigationScreen
import com.example.cpen321application.ui.profile.EditProfileScreen
import com.example.cpen321application.ui.profile.EditProfileViewModel
import com.example.cpen321application.ui.profile.ProfileScreen
import com.example.cpen321application.ui.profile.ProfileViewModel
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

    private val profileViewModel: ProfileViewModel by viewModels {
        viewModelFactory { initializer { ProfileViewModel(BackendApi, BackendApi, DataStoreSessionStore(application)) } }
    }

    private val tripHistoryViewModel: TripHistoryViewModel by viewModels {
        viewModelFactory { initializer { TripHistoryViewModel(BackendApi, DataStoreSessionStore(application)) } }
    }

    private val editProfileViewModel: EditProfileViewModel by viewModels {
        viewModelFactory { initializer { EditProfileViewModel(BackendApi, DataStoreSessionStore(application)) } }
    }

    // clears the questionnaire, trip history and profile too, so the next sign-in starts them empty
    private fun signOut() {
        resetScreens()
        viewModel.signOut()
    }

    private fun accountDeleted() {
        resetScreens()
        viewModel.accountDeleted()
    }

    private fun resetScreens() {
        questionnaireViewModel.reset()
        tripHistoryViewModel.reset()
        profileViewModel.reset()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CPEN321ApplicationTheme {
                TrailmixApp(
                    state = viewModel.state,
                    onRetry = viewModel::load,
                    signIn = {
                        SignInScreen(
                            isSigningIn = viewModel.isSigningIn,
                            error = viewModel.signInError,
                            notice = viewModel.signInNotice,
                            onSignIn = { viewModel.signIn { GoogleSignInClient.getIdToken(this) } },
                        )
                    },
                    questionnaire = {
                        QuestionnaireScreen(
                            questionnaireViewModel,
                            onSaved = viewModel::profileSaved,
                            onSignOut = ::signOut,
                        )
                    },
                    main = { Main() },
                )
            }
        }
    }

    // Navigation while a trip is active (so reopening the app mid-trip returns to it), else the tabs,
    // with the History and Profile tabs and the edit screens wired to their ViewModels
    @Composable
    private fun Main() {
        val trips = tripHistoryViewModel
        var planAgain by remember { mutableStateOf<RouteOption?>(null) } // History's Plan again, until the Map tab opens it
        LaunchedEffect(Unit) { trips.load(::signOut) } // at launch, to find an active trip
        EndActiveTripDialog(trips, ::signOut)
        if (trips.activeTrip != null || trips.finishedTrip != null) {
            NavigationScreen(trips, onUnauthorized = ::signOut)
            return
        }
        MainScreen(
            map = { MapHomeScreen(trips, planAgain, onPlanAgainOpened = { planAgain = null }, onUnauthorized = ::signOut) },
            history = { openMap ->
                TripHistoryScreen(
                    trips,
                    onPlanAgain = { route ->
                        planAgain = route
                        openMap()
                    },
                    onUnauthorized = ::signOut,
                )
            },
            profile = { onEdit ->
                ProfileScreen(
                    profileViewModel,
                    onEdit = { section, user ->
                        editProfileViewModel.start(section, user)
                        onEdit()
                    },
                    onSignOut = ::signOut,
                    onDeleted = ::accountDeleted,
                )
            },
            editProfile = { onDone ->
                EditProfileScreen(
                    editProfileViewModel,
                    onSaved = profileViewModel::profileSaved,
                    onDone = onDone,
                    onUnauthorized = ::signOut,
                )
            },
            snackbar = rememberTripSnackbar(trips),
        )
    }
}
