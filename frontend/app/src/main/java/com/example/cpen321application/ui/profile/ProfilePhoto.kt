package com.example.cpen321application.ui.profile

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import java.io.IOException
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val PHOTO_TIMEOUT_MS = 5_000
private const val MAX_INITIALS = 2
private val PHOTO_SIZE = 72.dp

/** The first letters of up to two words of [name], e.g. "Ada Lovelace" as "AL". */
fun initials(name: String): String =
    name.split(' ').filter { it.isNotBlank() }.take(MAX_INITIALS).joinToString("") { it.first().uppercase() }

/**
 * The user's Google profile photo in a circle. Shows their initials in a coloured
 * circle instead while it loads, when there's no photo, or when it fails to load.
 */
@Composable
fun ProfilePhoto(photoUrl: String?, name: String) {
    val photo by produceState<ImageBitmap?>(null, photoUrl) { value = photoUrl?.let { loadPhoto(it) } }
    val modifier = Modifier.size(PHOTO_SIZE).clip(CircleShape)
    val loaded = photo
    if (loaded != null) {
        Image(loaded, contentDescription = "Profile photo", modifier = modifier, contentScale = ContentScale.Crop)
    } else {
        Box(modifier.background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
            Text(
                initials(name),
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                style = MaterialTheme.typography.titleLarge,
            )
        }
    }
}

// null when the photo can't be downloaded or isn't an image, so the initials stay
private suspend fun loadPhoto(url: String): ImageBitmap? = withContext(Dispatchers.IO) {
    try {
        val connection = URL(url).openConnection()
        connection.connectTimeout = PHOTO_TIMEOUT_MS
        connection.readTimeout = PHOTO_TIMEOUT_MS
        connection.getInputStream().use { BitmapFactory.decodeStream(it) }?.asImageBitmap()
    } catch (e: IOException) {
        null
    }
}
