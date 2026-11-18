package com.example.cpen321application.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import java.time.Instant
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

/*
 * The live update parser (#87) against bodies the backend really sends. On a device, since org.json is only a stub
 * in local unit tests.
 */

// what the backend's buildLiveUpdate made from TransLink's saved feeds (backend/tests/fixtures/translink/) for a walk,
// the 025 matched 51 s early, and a line TransLink doesn't have (the network-wide Compass Card notice is left out)
private const val SAVED_FEEDS_BODY = """
{"live":true,"updatedAt":"2026-11-18T09:59:19.000Z","legs":[{"legIndex":1,"matched":true,"departAt":"2026-11-18T07:25:56.000Z","arriveAt":"2026-11-18T07:28:26.000Z","delaySeconds":-51,"cancelled":false},{"legIndex":2,"matched":false,"departAt":"2026-11-18T07:26:47.000Z","arriveAt":null,"delaySeconds":null,"cancelled":false}],"alerts":[{"id":"769063","header":"Stop 61259 Northbound Willingdon Ave @ Still Creek Dr has temporarily moved 36 metres south from Thu Nov 12 through Wed Dec 9 due to construction.","description":null,"effect":"STOP_MOVED","legIndexes":[1],"activeUntil":"2026-12-10T11:00:00.000Z"}]}
"""

// the scheduled fallback, as the backend sends it with no TransLink key
private const val NOT_LIVE_BODY = """
{"live":false,"updatedAt":null,"legs":[{"legIndex":0,"matched":false,"departAt":"2026-11-18T17:10:00.000Z","arriveAt":"2026-11-18T17:45:00.000Z","delaySeconds":null}],"alerts":[]}
"""

@RunWith(AndroidJUnit4::class)
class LiveUpdateParsingTest {
    @Test
    fun parsesALiveUpdate() {
        val update = JSONObject(SAVED_FEEDS_BODY).toLiveUpdate()

        assertEquals(true, update.live)
        assertEquals(Instant.parse("2026-11-18T09:59:19Z"), update.updatedAt)
        assertEquals(
            listOf(
                LiveLeg(1, true, Instant.parse("2026-11-18T07:25:56Z"), Instant.parse("2026-11-18T07:28:26Z"), -51, cancelled = false),
                LiveLeg(2, false, Instant.parse("2026-11-18T07:26:47Z"), null, null, cancelled = false),
            ),
            update.legs,
        )
        assertEquals(listOf("769063"), update.alerts.map { it.id })
        assertEquals(LiveAlert(
            id = "769063",
            header = "Stop 61259 Northbound Willingdon Ave @ Still Creek Dr has temporarily moved 36 metres south from Thu Nov 12 through Wed Dec 9 due to construction.",
            description = null,
            effect = "STOP_MOVED",
            legIndexes = listOf(1),
            activeUntil = Instant.parse("2026-12-10T11:00:00Z"),
        ), update.alerts[0])
    }

    @Test
    fun parsesTheScheduledFallback() {
        val update = JSONObject(NOT_LIVE_BODY).toLiveUpdate()

        assertEquals(
            LiveUpdate(
                live = false,
                updatedAt = null,
                legs = listOf(LiveLeg(0, false, Instant.parse("2026-11-18T17:10:00Z"), Instant.parse("2026-11-18T17:45:00Z"), null)),
                alerts = emptyList(),
            ),
            update,
        )
    }

    @Test
    fun parsesCancelledAndTreatsItsAbsenceAsFalse() {
        val body = """{"live":true,"updatedAt":"2026-11-18T17:00:00.000Z","legs":[
            {"legIndex":0,"matched":true,"departAt":"2026-11-18T17:10:00.000Z","arriveAt":"2026-11-18T17:45:00.000Z","delaySeconds":null,"cancelled":true},
            {"legIndex":2,"matched":true,"departAt":"2026-11-18T18:00:00.000Z","arriveAt":null,"delaySeconds":60,"cancelled":false},
            {"legIndex":3,"matched":false,"departAt":null,"arriveAt":null,"delaySeconds":null}],"alerts":[]}"""

        val legs = JSONObject(body).toLiveUpdate().legs

        assertEquals(listOf(true, false, false), legs.map { it.cancelled })
    }

    @Test
    fun rejectsABodyMissingAField() {
        assertThrows(org.json.JSONException::class.java) { JSONObject("""{"live":true,"legs":[]}""").toLiveUpdate() }
    }
}
