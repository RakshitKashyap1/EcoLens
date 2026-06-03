globalThis.EcoLensAuth = (() => {
  const AUTH_STORAGE_KEY = "cloudAuth";
  const SESSION_TTL_MS = 55 * 60 * 1000;

  // Build the canonical signed-out auth shape so storage stays predictable.
  function buildSignedOutState(overrides = {}) {
    return {
      signedIn: false,
      userId: null,
      email: null,
      displayName: null,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      lastAuthAt: null,
      ...overrides,
    };
  }

  // Normalize partial auth records into the full auth state shape.
  function normalizeAuthState(authState) {
    return buildSignedOutState(authState || {});
  }

  // Treat a session as valid only if it still has a usable access token.
  function isSessionValid(authState) {
    return Boolean(
      authState?.signedIn &&
      authState?.accessToken &&
      authState?.expiresAt &&
      authState.expiresAt > (Date.now() + 15_000)
    );
  }

  // Convert a backend session response into the local auth state format.
  function buildSessionPayload(session, emailFallback = null) {
    return normalizeAuthState({
      signedIn: true,
      userId: session.user?.id || session.userId || null,
      email: session.user?.email || session.email || emailFallback,
      displayName: session.user?.user_metadata?.display_name || session.displayName || null,
      accessToken: session.access_token || session.accessToken || null,
      refreshToken: session.refresh_token || session.refreshToken || null,
      expiresAt: session.expires_at
        ? session.expires_at * 1000
        : session.expiresAt || (Date.now() + SESSION_TTL_MS),
      lastAuthAt: Date.now(),
    });
  }

  // Build request headers, including the anon key and bearer token when present.
  function getAuthHeaders(authState, anonKey = "") {
    const headers = {
      "Content-Type": "application/json",
    };

    if (anonKey) {
      headers.apikey = anonKey;
    }

    if (authState?.accessToken) {
      headers.Authorization = `Bearer ${authState.accessToken}`;
    }

    return headers;
  }

  return {
    AUTH_STORAGE_KEY,
    buildSignedOutState,
    normalizeAuthState,
    isSessionValid,
    buildSessionPayload,
    getAuthHeaders,
  };
})();
