package com.example.cpen321application.ui.route

import com.google.android.gms.maps.model.LatLng

private const val ASCII_OFFSET = 63 // every character is shifted by 63 so it's printable
private const val CHUNK_BITS = 5 // each character carries 5 bits of the number
private const val CHUNK_MASK = 0x1f // the low 5 bits
private const val CONTINUE_BIT = 0x20 // set when more characters follow for this number
private const val PRECISION = 1e5 // coordinates are stored as integers of 1e-5 degrees

/**
 * Decodes Google's encoded polyline format into the points of the line.
 *
 * Each point is stored as the change in latitude and longitude from the previous
 * point, so the deltas are summed as they're read.
 * See https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
fun decodePolyline(encoded: String): List<LatLng> {
    val points = mutableListOf<LatLng>()
    var index = 0
    var lat = 0
    var lng = 0

    fun nextDelta(): Int {
        var result = 0
        var shift = 0
        do {
            val chunk = encoded[index++].code - ASCII_OFFSET
            result = result or ((chunk and CHUNK_MASK) shl shift)
            shift += CHUNK_BITS
        } while (chunk >= CONTINUE_BIT)
        // the lowest bit is the sign: odd numbers are negative
        return if (result and 1 != 0) (result shr 1).inv() else result shr 1
    }

    while (index < encoded.length) {
        lat += nextDelta()
        lng += nextDelta()
        points.add(LatLng(lat / PRECISION, lng / PRECISION))
    }
    return points
}
