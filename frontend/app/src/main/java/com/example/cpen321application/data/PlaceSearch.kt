package com.example.cpen321application.data

import android.content.Context
import android.location.Address
import android.location.Geocoder
import android.os.Build
import com.example.cpen321application.BuildConfig
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.tasks.Task
import com.google.android.libraries.places.api.Places
import com.google.android.libraries.places.api.model.AutocompleteSessionToken
import com.google.android.libraries.places.api.model.Place
import com.google.android.libraries.places.api.model.RectangularBounds
import com.google.android.libraries.places.api.net.FetchPlaceRequest
import com.google.android.libraries.places.api.net.FindAutocompletePredictionsRequest
import com.google.android.libraries.places.api.net.PlacesClient
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

/** One autocomplete suggestion, e.g. "UBC North Parkade" with "Vancouver, BC" under it. */
data class PlaceSuggestion(val placeId: String, val name: String, val description: String)

/** A place the user picked from search. */
data class PlaceDetails(val placeId: String, val name: String, val address: String?, val location: LatLng)

/** Thrown when a place search can't be done, e.g. no network or no API key. */
class PlaceSearchException(cause: Throwable? = null) : IOException("Place search failed", cause)

/** Place search and reverse geocoding for the Map tab. */
interface PlaceSearch {
    /** Suggests places matching [query], biased to Metro Vancouver. Throws [IOException] on failure. */
    suspend fun suggest(query: String): List<PlaceSuggestion>

    /** Fetches the name, address and location of a suggestion the user picked. Throws [IOException] on failure. */
    suspend fun details(placeId: String): PlaceDetails

    /** The street address nearest [location], or `null` if there's none or it can't be looked up. Never throws. */
    suspend fun nearestAddress(location: LatLng): String?
}

// Metro Vancouver's corners, from Horseshoe Bay and White Rock to Maple Ridge
private const val METRO_SOUTH = 49.0
private const val METRO_WEST = -123.3
private const val METRO_NORTH = 49.4
private const val METRO_EAST = -122.5
private val METRO_VANCOUVER =
    RectangularBounds.newInstance(LatLng(METRO_SOUTH, METRO_WEST), LatLng(METRO_NORTH, METRO_EAST))
private const val COUNTRY = "CA"
private val DETAIL_FIELDS =
    listOf(Place.Field.ID, Place.Field.DISPLAY_NAME, Place.Field.FORMATTED_ADDRESS, Place.Field.LOCATION)

/**
 * [PlaceSearch] with the Places SDK (Autocomplete New) and Android's Geocoder.
 *
 * Suggestions and the details of the one picked share a session token, so Google
 * bills them as one search. The API key comes from `local.properties`, never Git.
 */
class GooglePlaceSearch(context: Context) : PlaceSearch {
    private val appContext = context.applicationContext
    private val client: PlacesClient? by lazy { createClient(appContext) }
    private var sessionToken: AutocompleteSessionToken? = null

    override suspend fun suggest(query: String): List<PlaceSuggestion> {
        val placesClient = client ?: throw PlaceSearchException()
        val token = sessionToken ?: AutocompleteSessionToken.newInstance().also { sessionToken = it }
        val request = FindAutocompletePredictionsRequest.builder()
            .setQuery(query)
            .setLocationBias(METRO_VANCOUVER)
            .setCountries(COUNTRY)
            .setSessionToken(token)
            .build()
        val response = placesClient.findAutocompletePredictions(request).await()
        return response.autocompletePredictions.map {
            PlaceSuggestion(it.placeId, it.getPrimaryText(null).toString(), it.getSecondaryText(null).toString())
        }
    }

    override suspend fun details(placeId: String): PlaceDetails {
        val placesClient = client ?: throw PlaceSearchException()
        val request = FetchPlaceRequest.builder(placeId, DETAIL_FIELDS).setSessionToken(sessionToken).build()
        sessionToken = null // a session ends when a place is fetched
        val place = placesClient.fetchPlace(request).await().place
        val location = place.location ?: throw PlaceSearchException()
        val name = place.displayName ?: place.formattedAddress.orEmpty()
        return PlaceDetails(placeId, name, place.formattedAddress, location)
    }

    override suspend fun nearestAddress(location: LatLng): String? = withContext(Dispatchers.IO) {
        if (!Geocoder.isPresent()) return@withContext null
        try {
            firstAddress(Geocoder(appContext), location)?.getAddressLine(0)
        } catch (e: IOException) {
            null // no network: the pin is still saved, just without an address
        }
    }

    private fun createClient(context: Context): PlacesClient? {
        val apiKey = BuildConfig.PLACES_API_KEY
        if (apiKey.isBlank()) return null
        if (!Places.isInitialized()) Places.initializeWithNewPlacesApiEnabled(context, apiKey)
        return Places.createClient(context)
    }
}

// the listener form is the only non-deprecated one from Android 13; older versions only have the blocking call
private suspend fun firstAddress(geocoder: Geocoder, location: LatLng): Address? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        suspendCancellableCoroutine { continuation ->
            geocoder.getFromLocation(location.latitude, location.longitude, 1, object : Geocoder.GeocodeListener {
                override fun onGeocode(addresses: MutableList<Address>) = continuation.resume(addresses.firstOrNull())
                override fun onError(errorMessage: String?) = continuation.resume(null)
            })
        }
    } else {
        @Suppress("DEPRECATION")
        geocoder.getFromLocation(location.latitude, location.longitude, 1)?.firstOrNull()
    }

/** Waits for a Play services task, turning its failure into a [PlaceSearchException]. */
private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
    addOnSuccessListener { continuation.resume(it) }
    addOnFailureListener { continuation.resumeWithException(PlaceSearchException(it)) }
    addOnCanceledListener { continuation.cancel() }
}
