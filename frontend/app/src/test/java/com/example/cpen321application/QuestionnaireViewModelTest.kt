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
import com.example.cpen321application.ui.questionnaire.CHOOSE_AN_OPTION
import com.example.cpen321application.ui.questionnaire.FUEL_OUT_OF_RANGE
import com.example.cpen321application.ui.questionnaire.QuestionnaireViewModel
import com.example.cpen321application.ui.questionnaire.REQUIRED
import com.example.cpen321application.ui.questionnaire.SAVE_FAILED
import com.example.cpen321application.ui.questionnaire.SAVE_OFFLINE
import com.example.cpen321application.ui.questionnaire.TransitChoice
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
    private val viewModel = QuestionnaireViewModel(api, TokenStore("token"))
    private var savedAs: User? = null
    private var signedOut = false

    private fun submit() = viewModel.submit(onSaved = { savedAs = it }, onUnauthorized = { signedOut = true })

    // a driver who takes transit, with every required answer filled in
    private fun answerAsDriver() {
        viewModel.loadMakes()
        viewModel.chooseDrives(true)
        viewModel.chooseMake("Toyota")
        viewModel.chooseModel("Corolla")
        viewModel.changeFuelDigits("72")
        viewModel.chooseTransit(TransitChoice.ADULT_STORED_VALUE)
    }

    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun noErrorsShowBeforeTheFirstSubmit() {
        assertNull(viewModel.drivesError)
        assertNull(viewModel.transitError)
    }

    @Test
    fun emptySubmitShowsErrorsAndSendsNothing() {
        submit()
        assertEquals(CHOOSE_AN_OPTION, viewModel.drivesError)
        assertEquals(CHOOSE_AN_OPTION, viewModel.transitError)
        assertTrue(api.saved.isEmpty())

        viewModel.chooseDrives(true)
        assertNull(viewModel.drivesError) // goes away once fixed
        assertEquals(REQUIRED, viewModel.makeError)
        assertEquals(REQUIRED, viewModel.modelError)
        assertEquals(REQUIRED, viewModel.fuelError)
    }

    @Test
    fun fuelConsumptionMustBeInRange() {
        answerAsDriver()
        viewModel.changeFuelDigits("9")
        submit()
        assertEquals(FUEL_OUT_OF_RANGE, viewModel.fuelError)
        viewModel.changeFuelDigits("401")
        assertEquals(FUEL_OUT_OF_RANGE, viewModel.fuelError)
        viewModel.changeFuelDigits("400")
        assertNull(viewModel.fuelError)
        assertTrue(api.saved.isEmpty())
    }

    @Test
    fun adultMonthlyPassNeedsZones() {
        answerAsDriver()
        viewModel.chooseTransit(TransitChoice.ADULT_MONTHLY_PASS)
        submit()
        assertEquals(CHOOSE_AN_OPTION, viewModel.zonesError)
        viewModel.chooseZones(2)
        submit()
        assertEquals(Transit(FareType.ADULT_MONTHLY_PASS, 2), api.saved.single().transit)
    }

    @Test
    fun changingTheMakeClearsTheModelAndLoadsItsModels() {
        answerAsDriver()
        assertEquals(listOf("Camry", "Corolla"), viewModel.models)
        viewModel.chooseMake("Honda")
        assertNull(viewModel.model)
        assertEquals(listOf("Civic"), viewModel.models)
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
        viewModel.chooseDrives(false)
        viewModel.chooseTransit(TransitChoice.NONE)
        assertEquals("Corolla", viewModel.model) // still there if they switch back to Yes
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
        assertEquals("Corolla", viewModel.model)
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
        viewModel.loadMakes()
        assertTrue(viewModel.makesFailed)
        api.makesOffline = false
        viewModel.loadMakes()
        assertFalse(viewModel.makesFailed)
        assertEquals(listOf("Honda", "Toyota"), viewModel.makes)
    }

    @Test
    fun resetClearsTheAnswers() {
        answerAsDriver()
        submit()
        viewModel.reset()
        assertNull(viewModel.drives)
        assertNull(viewModel.make)
        assertEquals("", viewModel.fuelDigits)
        assertNull(viewModel.drivesError)
    }

    @Test
    fun filteringIgnoresCapitalsAndMatchesAnywhere() {
        assertEquals(listOf("Corolla"), filterOptions(listOf("Camry", "Corolla"), "ROL"))
        assertEquals(listOf("Camry", "Corolla"), filterOptions(listOf("Camry", "Corolla"), ""))
    }
}
