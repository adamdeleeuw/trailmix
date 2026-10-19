package com.example.cpen321application

import com.example.cpen321application.data.FareType
import com.example.cpen321application.data.HttpException
import com.example.cpen321application.data.Profile
import com.example.cpen321application.data.ProfileApi
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.Transit
import com.example.cpen321application.data.UnauthorizedException
import com.example.cpen321application.data.User
import com.example.cpen321application.data.Vehicle
import com.example.cpen321application.ui.components.filterOptions
import com.example.cpen321application.ui.commute.CHOOSE_AN_OPTION
import com.example.cpen321application.ui.commute.FUEL_OUT_OF_RANGE
import com.example.cpen321application.ui.questionnaire.QuestionnaireViewModel
import com.example.cpen321application.ui.commute.REQUIRED
import com.example.cpen321application.ui.SAVE_FAILED
import com.example.cpen321application.ui.SAVE_OFFLINE
import com.example.cpen321application.ui.commute.TransitChoice
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private val savedUser = User("1", "a@b.c", "Ada", null, profileComplete = true)

/** In-memory backend. Set [failure] to make saving throw it, or [pendingSave] to hold the save open. */
private class FakeProfileApi : ProfileApi {
    var makesOffline = false
    var failure: IOException? = null
    var pendingSave: CompletableDeferred<Unit>? = null
    val saved = mutableListOf<Profile>()

    override suspend fun getMakes(sessionToken: String): List<String> {
        if (makesOffline) throw IOException()
        return listOf("Honda", "Toyota")
    }

    override suspend fun getModels(sessionToken: String, make: String) =
        if (make == "Toyota") listOf("Camry", "Corolla") else listOf("Civic")

    override suspend fun saveProfile(sessionToken: String, profile: Profile): User {
        saved += profile
        pendingSave?.await()
        failure?.let { throw it }
        return savedUser
    }
}

/** Holds a token, which is all the questionnaire reads. */
private class TokenStore(private val token: String?) : SessionStore {
    override suspend fun token() = token
    override suspend fun setToken(token: String?) = Unit
    override suspend fun pendingSignOuts() = emptySet<String>()
    override suspend fun endSession() = Unit
    override suspend fun forget(token: String) = Unit
}

@OptIn(ExperimentalCoroutinesApi::class)
class QuestionnaireViewModelTest {
    private val api = FakeProfileApi()
    private lateinit var viewModel: QuestionnaireViewModel // built after the test dispatcher is set
    private var savedAs: User? = null
    private var signedOut = false

    private fun submit() = viewModel.submit(onSaved = { savedAs = it }, onUnauthorized = { signedOut = true })

    // a driver who takes transit, with every required answer filled in
    private fun answerAsDriver() {
        viewModel.vehicleForm.loadMakes()
        viewModel.vehicleForm.chooseDrives(true)
        viewModel.vehicleForm.chooseMake("Toyota")
        viewModel.vehicleForm.chooseModel("Corolla")
        viewModel.vehicleForm.changeFuelDigits("72")
        viewModel.transitForm.choose(TransitChoice.ADULT_STORED_VALUE)
    }

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        viewModel = QuestionnaireViewModel(api, TokenStore("token"))
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun noErrorsShowBeforeTheFirstSubmit() {
        assertNull(viewModel.vehicleForm.drivesError)
        assertNull(viewModel.transitForm.choiceError)
    }

    @Test
    fun emptySubmitShowsErrorsAndSendsNothing() {
        submit()
        assertEquals(CHOOSE_AN_OPTION, viewModel.vehicleForm.drivesError)
        assertEquals(CHOOSE_AN_OPTION, viewModel.transitForm.choiceError)
        assertTrue(api.saved.isEmpty())

        viewModel.vehicleForm.chooseDrives(true)
        assertNull(viewModel.vehicleForm.drivesError) // goes away once fixed
        assertEquals(REQUIRED, viewModel.vehicleForm.makeError)
        assertEquals(REQUIRED, viewModel.vehicleForm.modelError)
        assertEquals(REQUIRED, viewModel.vehicleForm.fuelError)
    }

    @Test
    fun fuelConsumptionMustBeInRange() {
        answerAsDriver()
        viewModel.vehicleForm.changeFuelDigits("9")
        submit()
        assertEquals(FUEL_OUT_OF_RANGE, viewModel.vehicleForm.fuelError)
        viewModel.vehicleForm.changeFuelDigits("401")
        assertEquals(FUEL_OUT_OF_RANGE, viewModel.vehicleForm.fuelError)
        viewModel.vehicleForm.changeFuelDigits("400")
        assertNull(viewModel.vehicleForm.fuelError)
        assertTrue(api.saved.isEmpty())
    }

    @Test
    fun adultMonthlyPassNeedsZones() {
        answerAsDriver()
        viewModel.transitForm.choose(TransitChoice.ADULT_MONTHLY_PASS)
        submit()
        assertEquals(CHOOSE_AN_OPTION, viewModel.transitForm.zonesError)
        viewModel.transitForm.chooseZones(2)
        submit()
        assertEquals(Transit(FareType.ADULT_MONTHLY_PASS, 2), api.saved.single().transit)
    }

    @Test
    fun changingTheMakeClearsTheModelAndLoadsItsModels() {
        answerAsDriver()
        assertEquals(listOf("Camry", "Corolla"), viewModel.vehicleForm.models)
        viewModel.vehicleForm.chooseMake("Honda")
        assertNull(viewModel.vehicleForm.model)
        assertEquals(listOf("Civic"), viewModel.vehicleForm.models)
    }

    @Test
    fun driverIsSavedAndReturnsTheAccount() {
        answerAsDriver()
        submit()
        val profile = api.saved.single()
        assertEquals(Vehicle("Toyota", "Corolla", null, 7.2), profile.vehicle)
        assertEquals(Transit(FareType.ADULT_STORED_VALUE, null), profile.transit)
        assertEquals(savedUser, savedAs)
    }

    @Test
    fun switchingToNoKeepsTheCarButDoesNotSendIt() {
        answerAsDriver()
        viewModel.vehicleForm.chooseDrives(false)
        viewModel.transitForm.choose(TransitChoice.NONE)
        assertEquals("Corolla", viewModel.vehicleForm.model) // still there if they switch back to Yes
        submit()
        assertEquals(Profile(api.saved.single().timezone, vehicle = null, transit = null), api.saved.single())
    }

    @Test
    fun doubleTapSendsOneSave() {
        api.pendingSave = CompletableDeferred()
        answerAsDriver()
        submit()
        assertTrue(viewModel.isSaving)
        submit()
        api.pendingSave?.complete(Unit)
        assertEquals(1, api.saved.size)
        assertFalse(viewModel.isSaving)
    }

    @Test
    fun saveFailuresShowTheRightMessageAndKeepAnswers() {
        answerAsDriver()
        api.failure = IOException()
        submit()
        assertEquals(SAVE_OFFLINE, viewModel.saveError)

        api.failure = HttpException(500)
        submit()
        assertEquals(SAVE_FAILED, viewModel.saveError)
        assertEquals("Corolla", viewModel.vehicleForm.model)
        assertNull(savedAs)
    }

    @Test
    fun rejectedSessionSignsOut() {
        answerAsDriver()
        api.failure = UnauthorizedException()
        submit()
        assertTrue(signedOut)
    }

    @Test
    fun makesThatFailToLoadCanBeRetried() {
        api.makesOffline = true
        viewModel.vehicleForm.loadMakes()
        assertTrue(viewModel.vehicleForm.makesFailed)
        api.makesOffline = false
        viewModel.vehicleForm.loadMakes()
        assertFalse(viewModel.vehicleForm.makesFailed)
        assertEquals(listOf("Honda", "Toyota"), viewModel.vehicleForm.makes)
    }

    @Test
    fun resetClearsTheAnswers() {
        answerAsDriver()
        submit()
        viewModel.reset()
        assertNull(viewModel.vehicleForm.drives)
        assertNull(viewModel.vehicleForm.make)
        assertEquals("", viewModel.vehicleForm.fuelDigits)
        assertNull(viewModel.vehicleForm.drivesError)
    }

    @Test
    fun filteringIgnoresCapitalsAndMatchesAnywhere() {
        assertEquals(listOf("Corolla"), filterOptions(listOf("Camry", "Corolla"), "ROL"))
        assertEquals(listOf("Camry", "Corolla"), filterOptions(listOf("Camry", "Corolla"), ""))
    }
}
