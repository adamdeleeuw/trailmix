package com.example.cpen321application.data

import android.content.Context
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.GetCredentialUnknownException
import com.example.cpen321application.BuildConfig
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/** Talks to Android's Credential Manager for Google sign-in. */
object GoogleSignInClient {
    /**
     * Shows the Google account picker and returns a Google ID token for the chosen account.
     *
     * @param context An activity context, which the picker attaches to.
     * @throws androidx.credentials.exceptions.GetCredentialCancellationException If the user closes the picker.
     * @throws androidx.credentials.exceptions.GetCredentialException If sign-in fails for any other reason.
     */
    suspend fun getIdToken(context: Context): String {
        val option = GetSignInWithGoogleOption.Builder(BuildConfig.GOOGLE_CLIENT_ID).build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()

        val credential = CredentialManager.create(context).getCredential(context, request).credential
        if (credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            throw GetCredentialUnknownException("Unexpected credential type")
        }
        return GoogleIdTokenCredential.createFrom(credential.data).idToken
    }

    /** Makes Android forget the signed-in Google account, so the picker shows again next time. */
    suspend fun forgetAccount(context: Context) {
        try {
            CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest())
        } catch (ignored: ClearCredentialException) {
            // our session is already gone, so at worst the picker preselects the old account
        }
    }
}
