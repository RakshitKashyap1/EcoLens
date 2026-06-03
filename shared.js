globalThis.EcoLensShared = (() => {
  // Shared defaults and retention windows used by both the background page and the UI.
  const DEFAULT_ACCOUNT_ID = "default";
  const DEFAULT_ACCOUNT_NAME = "Personal account";
  const CLOUD_SYNC_ALARM = "cloudSync";
  const CLOUD_SYNC_BATCH_DAYS = 30;
  const ACTIVITY_RETENTION_DAYS = 90;
  const DAILY_RETENTION_DAYS = 180;

  // Enumerations keep the storage shape consistent across files.
  const MEASUREMENT_MODES = {
    MEASURED: "measured",
    ESTIMATED: "estimated",
  };

  const GRID_SOURCES = {
    LIVE: "live",
    FALLBACK: "fallback",
    DEFAULT: "default",
  };

  const DEVICE_SOURCES = {
    BATTERY_HEURISTIC: "battery-heuristic",
    SELECTED_DEVICE: "selected-device",
  };

  const MODEL_CONFIDENCE = {
    DETECTED: "detected",
    DEFAULT: "default",
    UNKNOWN: "unknown",
  };

  // Convert any timestamp into a stable YYYY-MM-DD key for daily aggregation.
  function getDayKey(ts = Date.now()) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // Keep grid-zone values narrow so stale HTML or other junk cannot leak into the UI.
  function normalizeGridZone(zone) {
    const value = String(zone || "").trim().toUpperCase();
    if (value === "DEFAULT") return "DEFAULT";
    return /^[A-Z]{2}$/.test(value) ? value : "";
  }

  // Turn a stored zone into a safe display label for the popup and badge.
  function formatGridZoneLabel(zone, source = GRID_SOURCES.DEFAULT) {
    const normalized = normalizeGridZone(zone);
    if (source === GRID_SOURCES.LIVE && normalized) return normalized;
    if (source === GRID_SOURCES.FALLBACK && normalized) return normalized;
    return "regional average";
  }

  // Small helpers for building zeroed-out totals and merging partial snapshots.
  function buildEmptyBreakdownTotals() {
    return {
      network: 0,
      baseline: 0,
      device: 0,
    };
  }

  function normalizeBreakdownTotals(breakdownTotals) {
    return {
      ...buildEmptyBreakdownTotals(),
      ...(breakdownTotals || {}),
    };
  }

  // Daily snapshots keep per-site, per-model, and methodology totals together.
  function buildEmptyDailySnapshot() {
    return {
      totalCo2: 0,
      bySite: {},
      byModel: {},
      counts: {},
      eventCount: 0,
      breakdownTotals: buildEmptyBreakdownTotals(),
    };
  }

  // Normalize partial snapshot data so older storage records still render safely.
  function normalizeDailySnapshot(snapshot) {
    const base = buildEmptyDailySnapshot();
    const next = {
      ...base,
      ...(snapshot || {}),
    };

    next.bySite = { ...base.bySite, ...(snapshot?.bySite || {}) };
    next.byModel = { ...base.byModel, ...(snapshot?.byModel || {}) };
    next.counts = { ...base.counts, ...(snapshot?.counts || {}) };
    next.breakdownTotals = normalizeBreakdownTotals(snapshot?.breakdownTotals);
    return next;
  }

  // Create a fresh account record with all fields the extension expects.
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

  // Convert incoming event data into a safe, fully-populated storage event.
  function normalizeUsageEvent(event = {}) {
    return {
      ts: event.ts || Date.now(),
      siteKey: event.siteKey || "unknown",
      grams: Math.max(0, Number(event.grams) || 0),
      bytes: Math.max(0, Number(event.bytes ?? event.networkBytesUsed) || 0),
      provider: event.provider || null,
      modelId: event.modelId || null,
      modelLabel: event.modelLabel || null,
      type: event.type || "visit",
      incrementCount: event.incrementCount !== false,
      measurementMode: event.measurementMode || MEASUREMENT_MODES.ESTIMATED,
      gridSource: event.gridSource || GRID_SOURCES.DEFAULT,
      gridZone: normalizeGridZone(event.gridZone) || "?",
      deviceSource: event.deviceSource || DEVICE_SOURCES.SELECTED_DEVICE,
      modelConfidence: event.modelConfidence || MODEL_CONFIDENCE.UNKNOWN,
      networkBytesUsed: Math.max(0, Number(event.networkBytesUsed ?? event.bytes) || 0),
      networkKwhUsed: Math.max(0, Number(event.networkKwhUsed) || 0),
      baselineKwhUsed: Math.max(0, Number(event.baselineKwhUsed) || 0),
      deviceKwhUsed: Math.max(0, Number(event.deviceKwhUsed) || 0),
      totalKwhUsed: Math.max(
        0,
        Number(
          event.totalKwhUsed
            ?? ((Number(event.networkKwhUsed) || 0) + (Number(event.baselineKwhUsed) || 0) + (Number(event.deviceKwhUsed) || 0))
        ) || 0
      ),
    };
  }

  // Merge stored account data with defaults so old records remain compatible.
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
    next.dailyTotals = Object.fromEntries(
      Object.entries(account?.dailyTotals || {}).map(([dayKey, snapshot]) => [dayKey, normalizeDailySnapshot(snapshot)])
    );
    next.activityLog = Array.isArray(account?.activityLog)
      ? account.activityLog.map((event) => normalizeUsageEvent(event))
      : [];
    next.budget = {
      ...base.budget,
      ...(account?.budget || {}),
    };

    return next;
  }

  // Reset the current day counters without deleting the account history itself.
  function resetAccountDay(account, now = Date.now()) {
    account.totalCo2 = 0;
    account.counts = {};
    account.siteTotals = {};
    account.modelTotals = {};
    account.lastSite = null;
    account.lastTs = null;
    account.lastResetTs = now;
    account.budget.alert80Date = null;
    account.budget.alert100Date = null;
    return account;
  }

  // Ensure the active day matches the current date, resetting if needed.
  function ensureActiveDay(account, now = Date.now()) {
    if (getDayKey(account.lastResetTs) === getDayKey(now)) return account;
    return resetAccountDay(account, now);
  }

  // Trim old activity and daily totals to keep storage bounded.
  function pruneAccountHistory(account, now = Date.now(), options = {}) {
    const activityRetentionDays = options.activityRetentionDays ?? ACTIVITY_RETENTION_DAYS;
    const dailyRetentionDays = options.dailyRetentionDays ?? DAILY_RETENTION_DAYS;
    const activityCutoff = now - (activityRetentionDays * 24 * 60 * 60 * 1000);
    account.activityLog = account.activityLog.filter((event) => (event?.ts || 0) >= activityCutoff);

    const dailyCutoffKey = getDayKey(now - (dailyRetentionDays * 24 * 60 * 60 * 1000));
    Object.keys(account.dailyTotals).forEach((key) => {
      if (key < dailyCutoffKey) {
        delete account.dailyTotals[key];
      } else {
        account.dailyTotals[key] = normalizeDailySnapshot(account.dailyTotals[key]);
      }
    });

    return account;
  }

  // Apply one usage event to the account, updating totals and history in one pass.
  function applyUsageEvent(account, rawEvent) {
    const event = normalizeUsageEvent(rawEvent);
    ensureActiveDay(account, event.ts);

    const dayKey = getDayKey(event.ts);
    const modelId = event.modelId || "unknown";

    account.totalCo2 += event.grams;
    account.siteTotals[event.siteKey] = (account.siteTotals[event.siteKey] || 0) + event.grams;
    if (event.incrementCount) {
      account.counts[event.siteKey] = (account.counts[event.siteKey] || 0) + 1;
    }

    if (event.modelLabel) {
      account.modelTotals[modelId] = (account.modelTotals[modelId] || 0) + event.grams;
    }

    const day = normalizeDailySnapshot(account.dailyTotals[dayKey]);
    day.totalCo2 += event.grams;
    day.bySite[event.siteKey] = (day.bySite[event.siteKey] || 0) + event.grams;
    if (event.modelLabel) {
      day.byModel[modelId] = (day.byModel[modelId] || 0) + event.grams;
    }
    if (event.incrementCount) {
      day.counts[event.siteKey] = (day.counts[event.siteKey] || 0) + 1;
    }
    day.eventCount += 1;
    day.breakdownTotals.network += event.networkKwhUsed;
    day.breakdownTotals.baseline += event.baselineKwhUsed;
    day.breakdownTotals.device += event.deviceKwhUsed;
    account.dailyTotals[dayKey] = day;

    account.activityLog.push(event);
    account.lastSite = event.siteKey;
    account.lastTs = event.ts;
    return account;
  }

  // Detect the most specific model label from visible UI text, or fall back.
  function detectModelFromText(text, catalog, fallback) {
    const haystack = String(text || "").toLowerCase();
    const ordered = [...catalog].sort((a, b) => {
      const aLen = Math.max(...a.aliases.map((alias) => alias.length));
      const bLen = Math.max(...b.aliases.map((alias) => alias.length));
      return bLen - aLen;
    });

    for (const model of ordered) {
      if (model.aliases.some((alias) => haystack.includes(alias.toLowerCase()))) {
        return {
          provider: fallback.provider,
          modelId: model.id,
          label: model.label,
          kWh: model.kWh,
          confidence: MODEL_CONFIDENCE.DETECTED,
        };
      }
    }

    return {
      ...fallback,
      confidence: fallback.confidence || MODEL_CONFIDENCE.DEFAULT,
    };
  }

  // Read backend settings from config.js and expose a simple configured flag.
  function getBackendConfig() {
    const apiBaseUrl = globalThis.CONFIG?.API_BASE_URL?.trim?.() || "";
    const anonKey = globalThis.CONFIG?.SUPABASE_ANON_KEY?.trim?.() || "";
    return {
      apiBaseUrl,
      anonKey,
      configured: Boolean(apiBaseUrl),
    };
  }

  // Build the sync status object used by both the popup and background worker.
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

  // Format timestamps for the popup and sync status UI.
  function fmtDateTime(ts) {
    if (!ts) return "never";
    return new Date(ts).toLocaleString();
  }

  return {
    DEFAULT_ACCOUNT_ID,
    DEFAULT_ACCOUNT_NAME,
    CLOUD_SYNC_ALARM,
    CLOUD_SYNC_BATCH_DAYS,
    ACTIVITY_RETENTION_DAYS,
    DAILY_RETENTION_DAYS,
    MEASUREMENT_MODES,
    GRID_SOURCES,
    DEVICE_SOURCES,
    MODEL_CONFIDENCE,
    getDayKey,
    buildEmptyBreakdownTotals,
    normalizeBreakdownTotals,
    buildEmptyDailySnapshot,
    normalizeDailySnapshot,
    buildEmptyAccountState,
    normalizeUsageEvent,
    normalizeGridZone,
    formatGridZoneLabel,
    normalizeAccountState,
    resetAccountDay,
    ensureActiveDay,
    pruneAccountHistory,
    applyUsageEvent,
    detectModelFromText,
    getBackendConfig,
    buildSyncState,
    fmtDateTime,
  };
})();
