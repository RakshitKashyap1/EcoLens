globalThis.EcoLensShared = (() => {
  const DEFAULT_ACCOUNT_ID = "default";
  const DEFAULT_ACCOUNT_NAME = "Personal account";
  const CLOUD_SYNC_ALARM = "cloudSync";
  const CLOUD_SYNC_BATCH_DAYS = 30;

  function getDayKey(ts = Date.now()) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function buildEmptyAccountState(now = Date.now()) {
    return {
      profile: {
        name: DEFAULT_ACCOUNT_NAME,
      },
      totalCo2: 0,
      counts: {},
      siteTotals: {},
      modelTotals: {},
      dailyTotals: {},
      activityLog: [],
      budget: {
        enabled: false,
        dailyGrams: 50,
        alert80Date: null,
        alert100Date: null,
      },
      lastSite: null,
      lastTs: null,
      lastResetTs: now,
    };
  }

  function normalizeAccountState(account, fallbackName = DEFAULT_ACCOUNT_NAME) {
    const base = buildEmptyAccountState();
    const next = {
      ...base,
      ...account,
    };

    next.profile = {
      ...base.profile,
      ...(account?.profile || {}),
    };
    next.profile.name = next.profile.name || fallbackName;
    next.counts = { ...base.counts, ...(account?.counts || {}) };
    next.siteTotals = { ...base.siteTotals, ...(account?.siteTotals || {}) };
    next.modelTotals = { ...base.modelTotals, ...(account?.modelTotals || {}) };
    next.dailyTotals = { ...base.dailyTotals, ...(account?.dailyTotals || {}) };
    next.activityLog = Array.isArray(account?.activityLog) ? account.activityLog : [];
    next.budget = {
      ...base.budget,
      ...(account?.budget || {}),
    };

    return next;
  }

  function getBackendConfig() {
    const apiBaseUrl = globalThis.CONFIG?.API_BASE_URL?.trim?.() || "";
    const anonKey = globalThis.CONFIG?.SUPABASE_ANON_KEY?.trim?.() || "";
    return {
      apiBaseUrl,
      anonKey,
      configured: Boolean(apiBaseUrl),
    };
  }

  function buildSyncState(overrides = {}) {
    return {
      configured: getBackendConfig().configured,
      status: "idle",
      lastSyncAt: null,
      lastError: null,
      pendingEmail: null,
      ...overrides,
    };
  }

  function fmtDateTime(ts) {
    if (!ts) return "never";
    return new Date(ts).toLocaleString();
  }

  return {
    DEFAULT_ACCOUNT_ID,
    DEFAULT_ACCOUNT_NAME,
    CLOUD_SYNC_ALARM,
    CLOUD_SYNC_BATCH_DAYS,
    getDayKey,
    buildEmptyAccountState,
    normalizeAccountState,
    getBackendConfig,
    buildSyncState,
    fmtDateTime,
  };
})();
