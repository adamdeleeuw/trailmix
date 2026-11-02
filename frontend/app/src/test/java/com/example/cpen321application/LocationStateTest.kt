package com.example.cpen321application

import com.example.cpen321application.ui.map.LocationState
import com.google.android.gms.maps.model.LatLng
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private val HERE = LatLng(49.2827, -123.1207)

class LocationStateTest {
    private var allowed = false
    private var position: LatLng? = HERE
    private var prompts = 0
    private val state = LocationState({ allowed }, { position }).also { it.request = { prompts++ } }

    @Test
    fun asksOnceWhenTheTabFirstOpens() {
        state.askOnOpen()
        state.askOnOpen()
        assertEquals(1, prompts)
    }

    @Test
    fun doesNotAskWhenLocationIsAllowed() {
        allowed = true
        state.askOnOpen()
        assertEquals(0, prompts)
        assertTrue(state.granted)
    }

    @Test
    fun recenterAsksAgainOnceThenExplains() = runBlocking {
        state.askOnOpen()
        state.onPermissionResult(false)
        assertFalse(state.showOffDialog) // the first denial isn't explained yet

        assertNull(state.recenter())
        assertEquals(2, prompts)
        state.onPermissionResult(false)
        assertTrue(state.showOffDialog)

        state.dismissOffDialog()
        assertNull(state.recenter())
        assertEquals(2, prompts) // never asks a third time
        assertTrue(state.showOffDialog)
    }

    @Test
    fun recenterFindsTheUserOnceAllowed() = runBlocking {
        state.onPermissionResult(true)
        assertEquals(HERE, state.recenter())
        assertEquals("0 m", state.distanceTo(HERE))
    }

    @Test
    fun keepsTheLastPositionWithoutANewFix() = runBlocking {
        state.onPermissionResult(true)
        state.refresh()
        position = null
        assertEquals(HERE, state.refresh())
    }

    @Test
    fun noDistanceWithoutAPosition() {
        assertNull(state.distanceTo(HERE))
    }
}
