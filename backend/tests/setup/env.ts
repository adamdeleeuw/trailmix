// tests never use real secrets so a placeholder client id is enough because the
// mocked tests fake Google's check and the unmocked ones only send bad tokens
process.env.GOOGLE_BACKEND_CLIENT_ID ??= 'test-client-id.apps.googleusercontent.com';
// placeholder Routes API key: the mocked tests fake Google, and the unmocked ones never reach it
process.env.GOOGLE_ROUTES_API_KEY ??= 'test-routes-api-key';
