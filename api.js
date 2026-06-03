globalThis.EcoLensApi = (() => {
  const { getBackendConfig } = globalThis.EcoLensShared;
  const { getAuthHeaders } = globalThis.EcoLensAuth;

  function ensureObjectResponse(data, endpoint) {
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.prototype.hasOwnProperty.call(data, "raw")) {
      throw new Error(`${endpoint} returned an invalid response.`);
    }
    return data;
  }

  // Wrap fetch so backend calls share the same config and error handling.
  async function fetchJson(path, { method = "GET", body, authState } = {}) {
    const config = getBackendConfig();
    if (!config.configured) {
      throw new Error("Backend API is not configured. Add CONFIG.API_BASE_URL in config.js.");
    }

    const res = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      headers: getAuthHeaders(authState, config.anonKey),
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!res.ok) {
      const message = data?.error || data?.message || `Request failed with ${res.status}`;
      throw new Error(message);
    }

    return data;
  }

  // Start a magic-link login flow for the supplied email address.
  function startEmailAuth(email) {
    return fetchJson("/auth/magic-link/start", {
      method: "POST",
      body: { email },
    }).then((data) => ensureObjectResponse(data, "/auth/magic-link/start"));
  }

  // Verify the one-time code and exchange it for a session.
  function verifyEmailAuth(email, code) {
    return fetchJson("/auth/magic-link/verify", {
      method: "POST",
      body: { email, code },
    }).then((data) => {
      const session = ensureObjectResponse(data, "/auth/magic-link/verify");
      const unwrapped = session.session && typeof session.session === "object" ? session.session : session;
      if (!unwrapped.access_token && !unwrapped.accessToken) {
        throw new Error("/auth/magic-link/verify returned an invalid session.");
      }
      return unwrapped;
    });
  }

  // Pull the current profile so the popup can reflect backend account state.
  function fetchProfile(authState) {
    return fetchJson("/me", {
      method: "GET",
      authState,
    }).then((data) => ensureObjectResponse(data, "/me"));
  }

  // Push the daily summary payload to the backend.
  function syncDailyStats(payload, authState) {
    return fetchJson("/sync/daily-stats", {
      method: "POST",
      body: payload,
      authState,
    }).then((data) => (data == null ? data : ensureObjectResponse(data, "/sync/daily-stats")));
  }

  // Push recent activity events for social features or server-side analytics.
  function syncActivityEvents(payload, authState) {
    return fetchJson("/sync/activity-events", {
      method: "POST",
      body: payload,
      authState,
    }).then((data) => (data == null ? data : ensureObjectResponse(data, "/sync/activity-events")));
  }

  return {
    startEmailAuth,
    verifyEmailAuth,
    fetchProfile,
    syncDailyStats,
    syncActivityEvents,
  };
})();
