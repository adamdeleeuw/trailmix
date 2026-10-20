package com.example.cpen321application

import com.example.cpen321application.data.AccountApi
import com.example.cpen321application.data.AuthApi
import com.example.cpen321application.data.FareType
import com.example.cpen321application.data.GasPrice
import com.example.cpen321application.data.HttpException
import com.example.cpen321application.data.Profile
import com.example.cpen321application.data.ProfileApi
import com.example.cpen321application.data.SessionStore
import com.example.cpen321application.data.SignInResponse
import com.example.cpen321application.data.Transit
import com.example.cpen321application.data.UnauthorizedException
import com.example.cpen321application.data.User
import com.example.cpen321application.data.Vehicle
import com.example.cpen321application.ui.SAVE_FAILED
import com.example.cpen321application.ui.SAVE_OFFLINE
import com.example.cpen321application.ui.commute.REQUIRED
import com.example.cpen321application.ui.commute.TransitChoice
import com.example.cpen321application.ui.commute.fareDescription
import com.example.cpen321application.ui.profile.DELETE_FAILED
import com.example.cpen321application.ui.profile.EditProfileViewModel
import com.example.cpen321application.ui.profile.GAS_PRICE_OUT_OF_RANGE
import com.example.cpen321application.ui.profile.ProfileDialog
import com.example.cpen321application.ui.profile.ProfileSection
import com.example.cpen321application.ui.profile.ProfileState
import com.example.cpen321application.ui.profile.ProfileViewModel
import com.example.cpen321application.ui.profile.fuelDescription
import com.example.cpen321application.ui.profile.gasPriceDescription
import com.example.cpen321application.ui.profile.initials
import java.io.IOException
import java.time.Instant
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

private val corolla = Vehicle("Toyota", "Corolla", "Silver", 7.2)
private val driver = User(
    "1", "a@b.c", "Ada Lovelace", null, profileComplete = true,
    timezone = "America/Vancouver",
    vehicle = corolla,
    transit = Transit(FareType.ADULT_MONTHLY_PASS, 2),
)

/** In-memory backend. Set [failure] to make every call throw it, or [pendingDelete] to hold a delete open. */
private class FakeBackend : AuthApi, AccountApi, ProfileApi {
    var user = driver
    var failure: IOException? = null
    var pendingDelete: CompletableDeferred<Unit>? = null
    var deleted = false
    val savedProfiles = mutableListOf<Profile>()

    private fun check() = failure?.let { throw it }

    override suspend fun signIn(idToken: String) = SignInResponse("token", user)
    override suspend fun getMe(sessionToken: String) = user.also { check() }
    override suspend fun signOut(sessionToken: String) = Unit

    override suspend fun saveGasPrice(sessionToken: String, centsPerLitre: Double): User {
        check()
        user = user.copy(lastGasPrice = GasPrice(centsPerLitre, Instant.parse("2026-10-14T17:00:00Z")))
        return user
    }

    override suspend fun deleteAccount(sessionToken: String) {
        pendingDelete?.await()
        check()
        deleted = true
    }

    override suspend fun getMakes(sessionToken: String) = listOf("Honda", "Toyota")
    override suspend fun getModels(sessionToken: String, make: String) = listOf("Corolla")
    override suspend fun saveProfile(sessionToken: String, profile: Profile): User {
        check()
        savedProfiles += profile
        return user.copy(vehicle = profile.vehicle, transit = profile.transit)
    }
}

private object FixedTokenStore : SessionStore {
    override suspend fun token() = "token"
    override suspend fun setToken(token: String?) = Unit
    override suspend fun pendingSignOuts() = emptySet<String>()
    override suspend fun endSession() = Unit
    override suspend fun forget(token: String) = Unit
}

@OptIn(ExperimentalCoroutinesApi::class)
class ProfileViewModelTest {
    private val api = FakeBackend()
    private lateinit var profile: ProfileViewModel // built after the test dispatcher is set
    private lateinit var edit: EditProfileViewModel
    private var signedOut = false
    private var deletedCallback = false

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        profile = ProfileViewModel(api, api, FixedTokenStore)
        edit = EditProfileViewModel(api, FixedTokenStore)
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun load() = profile.loadIfNeeded { signedOut = true }

    private fun typeGasPrice(digits: String) {
        profile.openDialog(ProfileDialog.GAS_PRICE)
        profile.changeGasDigits(digits)
        profile.saveGasPrice { signedOut = true }
    }

    @Test
    fun loadsOnlyTheFirstTime() {
        load()
        assertEquals(ProfileState.Loaded(driver), profile.state)
        api.failure = IOException()
        load()
        assertEquals(ProfileState.Loaded(driver), profile.state)
    }

    @Test
    fun failedLoadShowsRetryAndRejectedSessionSignsOut() {
        api.failure = IOException()
        load()
        assertEquals(ProfileState.Failed, profile.state)
        api.failure = UnauthorizedException()
        profile.load { signedOut = true }
        assertTrue(signedOut)
    }

    @Test
    fun gasPriceIsValidated() {
        load()
        typeGasPrice("")
        assertEquals(REQUIRED, profile.gasPriceError)
        typeGasPrice("499")
        assertEquals(GAS_PRICE_OUT_OF_RANGE, profile.gasPriceError)
        typeGasPrice("4001")
        assertEquals(GAS_PRICE_OUT_OF_RANGE, profile.gasPriceError)
        assertEquals(ProfileDialog.GAS_PRICE, profile.dialog)
    }

    @Test
    fun savedGasPriceClosesTheDialogAndShowsWithTheDate() {
        load()
        typeGasPrice("1899")
        assertNull(profile.dialog)
        val user = (profile.state as ProfileState.Loaded).user
        assertEquals("189.9 ¢/L, updated Oct 14, 2026", gasPriceDescription(user.lastGasPrice!!, user.timezone))
        profile.openDialog(ProfileDialog.GAS_PRICE)
        assertEquals("1899", profile.gasDigits) // the field starts with the saved price
    }

    @Test
    fun gasPriceSaveErrorsKeepTheDialogOpen() {
        load()
        api.failure = IOException()
        typeGasPrice("1899")
        assertEquals(SAVE_OFFLINE, profile.gasPriceSaveError)
        api.failure = HttpException(500)
        typeGasPrice("1899")
        assertEquals(SAVE_FAILED, profile.gasPriceSaveError)
        assertEquals(ProfileDialog.GAS_PRICE, profile.dialog)
    }

    @Test
    fun deleteDialogCantBeClosedWhileDeleting() {
        load()
        api.pendingDelete = CompletableDeferred()
        profile.openDialog(ProfileDialog.DELETE_ACCOUNT)
        profile.deleteAccount(onDeleted = { deletedCallback = true }, onUnauthorized = { signedOut = true })
        profile.closeDialog()
        assertTrue(profile.isDeleting)
        assertEquals(ProfileDialog.DELETE_ACCOUNT, profile.dialog)
        api.pendingDelete?.complete(Unit)
        assertTrue(api.deleted)
        assertTrue(deletedCallback)
        assertNull(profile.dialog)
    }

    @Test
    fun failedDeleteKeepsTheUserSignedInWithTheDialogOpen() {
        load()
        api.failure = IOException()
        profile.openDialog(ProfileDialog.DELETE_ACCOUNT)
        profile.deleteAccount(onDeleted = { deletedCallback = true }, onUnauthorized = { signedOut = true })
        assertEquals(DELETE_FAILED, profile.deleteError)
        assertFalse(profile.isDeleting)
        assertFalse(deletedCallback)
        assertEquals(ProfileDialog.DELETE_ACCOUNT, profile.dialog)
    }

    @Test
    fun editingVehicleKeepsTransitAndTracksChanges() {
        edit.start(ProfileSection.VEHICLE, driver)
        assertFalse(edit.hasChanges)
        edit.vehicleForm.chooseDrives(false)
        assertTrue(edit.hasChanges)
        var saved: User? = null
        edit.save(onSaved = { saved = it }, onUnauthorized = { signedOut = true })
        assertEquals(Profile("America/Vancouver", null, driver.transit), api.savedProfiles.single())
        assertNull(saved?.vehicle)
    }

    @Test
    fun editingTransitStartsFilledInAndAsksBeforeDiscarding() {
        edit.start(ProfileSection.TRANSIT, driver)
        assertEquals(TransitChoice.ADULT_MONTHLY_PASS, edit.transitForm.choice)
        assertEquals(2, edit.transitForm.zones)
        var left = false
        edit.back { left = true }
        assertTrue(left)
        left = false
        edit.transitForm.choose(TransitChoice.UPASS)
        edit.back { left = true }
        assertFalse(left)
        assertTrue(edit.showDiscardDialog)
    }

    @Test
    fun editSaveOfflineStaysWithTheChanges() {
        edit.start(ProfileSection.TRANSIT, driver)
        edit.transitForm.choose(TransitChoice.UPASS)
        api.failure = IOException()
        edit.save(onSaved = {}, onUnauthorized = { signedOut = true })
        assertEquals(SAVE_OFFLINE, edit.saveError)
        assertEquals(TransitChoice.UPASS, edit.transitForm.choice)
    }

    @Test
    fun profileTextIsInPlainWords() {
        assertEquals("Adult monthly pass, 2 zones", fareDescription(driver.transit))
        assertEquals("U-Pass BC", fareDescription(Transit(FareType.UPASS, null)))
        assertNull(fareDescription(null))
        assertEquals("7.2 L/100 km", fuelDescription(corolla))
        assertEquals("AL", initials("Ada Lovelace"))
        assertEquals("A", initials("Ada"))
    }
}
