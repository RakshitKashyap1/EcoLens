try {
  importScripts("config.js");
} catch {
  console.warn("[EcoLens] config.js not found; using fallback grid defaults.");
}
importScripts("shared.js", "auth.js", "api.js");

const GRID_FALLBACKS = {
  IN: 0.708,
  US: 0.386,
  GB: 0.233,
  DE: 0.35,
  FR: 0.052,
  NO: 0.024,
  AU: 0.49,
  CN: 0.555,
  DEFAULT: 0.35,
};

const ELECTRICITY_MAPS_KEY = globalThis.CONFIG?.ELECTRICITY_MAPS_KEY ?? "";
const tabBytes = {};
const {
  DEFAULT_ACCOUNT_ID,
  DEFAULT_ACCOUNT_NAME,
  CLOUD_SYNC_ALARM,
  CLOUD_SYNC_BATCH_DAYS,
  ACTIVITY_RETENTION_DAYS,
  DAILY_RETENTION_DAYS,
  GRID_SOURCES,
  getDayKey,
  normalizeAccountState,
  normalizeUsageEvent,
  normalizeDailySnapshot,
  getBackendConfig,
  buildSyncState,
  resetAccountDay,
  pruneAccountHistory,
} = globalThis.EcoLensShared;
const {
  AUTH_STORAGE_KEY,
  buildSignedOutState,
  normalizeAuthState,
  isSessionValid,
  buildSessionPayload,
} = globalThis.EcoLensAuth;
const { startEmailAuth, verifyEmailAuth, fetchProfile, syncDailyStats, syncActivityEvents } = globalThis.EcoLensApi;

function buildEmptyDailySnapshot() {
  return {
    totalCo2: 0,
    bySite: {},
    byModel: {},
    counts: {},
    eventCount: 0,
    breakdownTotals: {
      network: 0,
      baseline: 0,
      device: 0,
    },
  };
}

async function getAccountStorage() {
  const stored = await chrome.storage.local.get([
    "currentAccountId",
    "currentAccountName",
    "accounts",
    "totalCo2",
    "counts",
    "siteTotals",
    "lastSite",
    "lastTs",
    "lastResetTs",
  ]);

  const currentAccountId = stored.currentAccountId || DEFAULT_ACCOUNT_ID;
  const currentAccountName = stored.currentAccountName || DEFAULT_ACCOUNT_NAME;
  const accounts = stored.accounts || {};

  if (!accounts[currentAccountId] && (
    stored.totalCo2 !== undefined ||
    stored.counts !== undefined ||
    stored.siteTotals !== undefined ||
    stored.lastSite !== undefined ||
    stored.lastTs !== undefined ||
    stored.lastResetTs !== undefined
  )) {
    accounts[currentAccountId] = normalizeAccountState({
      profile: { name: currentAccountName },
      totalCo2: stored.totalCo2 || 0,
      counts: stored.counts || {},
      siteTotals: stored.siteTotals || {},
      lastSite: stored.lastSite || null,
      lastTs: stored.lastTs || null,
      lastResetTs: stored.lastResetTs || Date.now(),
    }, currentAccountName);
  }

  accounts[currentAccountId] = normalizeAccountState(accounts[currentAccountId], currentAccountName);

  return {
    currentAccountId,
    currentAccountName: accounts[currentAccountId].profile.name || currentAccountName,
    accounts,
  };
}

async function getCloudStorage() {
  const stored = await chrome.storage.local.get([AUTH_STORAGE_KEY, "cloudSync"]);
  return {
    authState: normalizeAuthState(stored[AUTH_STORAGE_KEY] || buildSignedOutState()),
    syncState: buildSyncState(stored.cloudSync || {}),
  };
}

async function saveCloudStorage(authState, syncState) {
  await chrome.storage.local.set({
    [AUTH_STORAGE_KEY]: normalizeAuthState(authState),
    cloudSync: buildSyncState(syncState),
  });
}

async function updateSyncState(patch) {
  const { authState, syncState } = await getCloudStorage();
  const nextSyncState = buildSyncState({
    ...syncState,
    ...patch,
    configured: getBackendConfig().configured,
  });
  await saveCloudStorage(authState, nextSyncState);
  return nextSyncState;
}

async function saveAccountStorage(currentAccountId, currentAccountName, accounts) {
  const account = normalizeAccountState(accounts[currentAccountId], currentAccountName);
  accounts[currentAccountId] = account;

  await chrome.storage.local.set({
    currentAccountId,
    currentAccountName: account.profile.name,
    accounts,
    totalCo2: account.totalCo2,
    counts: account.counts,
    siteTotals: account.siteTotals,
    modelTotals: account.modelTotals,
    lastSite: account.lastSite,
    lastTs: account.lastTs,
    lastResetTs: account.lastResetTs,
  });
}

function buildSyncPayload(accountId, account) {
  const now = Date.now();
  const cutoffKey = getDayKey(now - (CLOUD_SYNC_BATCH_DAYS * 24 * 60 * 60 * 1000));
  const dailyStats = Object.entries(account.dailyTotals || {})
    .filter(([dayKey]) => dayKey >= cutoffKey)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, snapshot]) => {
      const normalized = normalizeDailySnapshot(snapshot);
      return {
        accountId,
        day: dayKey,
        totalCo2: normalized.totalCo2 || 0,
        bySite: normalized.bySite || {},
        byModel: normalized.byModel || {},
        counts: normalized.counts || {},
        eventCount: normalized.eventCount || 0,
        breakdownTotals: normalized.breakdownTotals || buildEmptyDailySnapshot().breakdownTotals,
      };
    });

  const activityCutoff = now - (CLOUD_SYNC_BATCH_DAYS * 24 * 60 * 60 * 1000);
  const events = (account.activityLog || [])
    .filter((event) => (event?.ts || 0) >= activityCutoff)
    .map((event) => {
      const normalized = normalizeUsageEvent(event);
      return {
        accountId,
        ts: normalized.ts,
        siteKey: normalized.siteKey,
        grams: normalized.grams,
        bytes: normalized.bytes,
        provider: normalized.provider,
        modelId: normalized.modelId,
        modelLabel: normalized.modelLabel,
        measurementMode: normalized.measurementMode,
        gridSource: normalized.gridSource,
        gridZone: normalized.gridZone,
        deviceSource: normalized.deviceSource,
        modelConfidence: normalized.modelConfidence,
        networkBytesUsed: normalized.networkBytesUsed,
        networkKwhUsed: normalized.networkKwhUsed,
        baselineKwhUsed: normalized.baselineKwhUsed,
        deviceKwhUsed: normalized.deviceKwhUsed,
        totalKwhUsed: normalized.totalKwhUsed,
        type: normalized.type,
      };
    });

  return { dailyStats, events };
}

async function syncCurrentAccount(reason = "background") {
  const backendConfig = getBackendConfig();
  const { authState, syncState } = await getCloudStorage();

  if (!backendConfig.configured) {
    await updateSyncState({
      status: "idle",
      lastError: null,
      configured: false,
    });
    return { ok: true, skipped: "not_configured" };
  }

  if (!isSessionValid(authState)) {
    await updateSyncState({
      status: "idle",
      lastError: null,
      configured: true,
    });
    return { ok: true, skipped: "signed_out" };
  }

  await saveCloudStorage(authState, buildSyncState({
    ...syncState,
    status: "syncing",
    lastError: null,
    configured: true,
  }));

  try {
    const { currentAccountId, currentAccountName, accounts } = await getAccountStorage();
    const account = normalizeAccountState(accounts[currentAccountId], currentAccountName);
    const payload = buildSyncPayload(currentAccountId, account);

    await syncDailyStats({
      reason,
      accountName: account.profile.name,
      dailyStats: payload.dailyStats,
    }, authState);

    await syncActivityEvents({
      reason,
      accountName: account.profile.name,
      events: payload.events,
    }, authState);

    const me = await fetchProfile(authState).catch(() => null);
    const nextAuthState = me?.user
      ? normalizeAuthState({
          ...authState,
          displayName: me.user.displayName || me.user.display_name || authState.displayName,
          email: me.user.email || authState.email,
        })
      : authState;

    await saveCloudStorage(nextAuthState, {
      ...syncState,
      status: "success",
      configured: true,
      lastSyncAt: Date.now(),
      lastError: null,
      pendingEmail: null,
    });

    return { ok: true };
  } catch (error) {
    await saveCloudStorage(authState, {
      ...syncState,
      status: "error",
      configured: backendConfig.configured,
      lastError: error.message,
    });
    return { ok: false, error: error.message };
  }
}

async function startCloudAuth(email) {
  const { authState, syncState } = await getCloudStorage();
  await startEmailAuth(email);
  await saveCloudStorage(authState, {
    ...syncState,
    status: "idle",
    configured: getBackendConfig().configured,
    pendingEmail: email,
    lastError: null,
  });
  return { ok: true };
}

async function verifyCloudAuth(email, code) {
  const session = await verifyEmailAuth(email, code);
  const nextAuthState = buildSessionPayload(session, email);
  await saveCloudStorage(nextAuthState, {
    status: "idle",
    configured: getBackendConfig().configured,
    pendingEmail: null,
    lastError: null,
    lastSyncAt: null,
  });
  return syncCurrentAccount("auth_verify");
}

async function clearCloudAuth() {
  await saveCloudStorage(buildSignedOutState(), {
    status: "idle",
    configured: getBackendConfig().configured,
    pendingEmail: null,
    lastError: null,
  });
  return { ok: true };
}

async function refreshCloudProfile() {
  const { authState, syncState } = await getCloudStorage();
  if (!isSessionValid(authState)) {
    return { ok: false, error: "You are not signed in." };
  }

  const me = await fetchProfile(authState);
  const nextAuthState = normalizeAuthState({
    ...authState,
    displayName: me?.user?.displayName || me?.user?.display_name || authState.displayName,
    email: me?.user?.email || authState.email,
  });
  await saveCloudStorage(nextAuthState, syncState);
  return { ok: true };
}

async function setFallbackGridIntensity() {
  try {
    const geoRes = await fetch("https://ipapi.co/country/");
    const zone = (await geoRes.text()).trim();
    const intensity = (GRID_FALLBACKS[zone] ?? GRID_FALLBACKS.DEFAULT) / 1000;
    await chrome.storage.local.set({ gridIntensity: intensity, gridZone: zone, gridSource: GRID_SOURCES.FALLBACK });
    console.log(`[EcoLens] Fallback grid: ${zone} = ${intensity} kg/kWh`);
  } catch {
    await chrome.storage.local.set({
      gridIntensity: GRID_FALLBACKS.DEFAULT / 1000,
      gridZone: "?",
      gridSource: GRID_SOURCES.DEFAULT,
    });
  }
}

async function fetchGridIntensity() {
  if (!ELECTRICITY_MAPS_KEY) {
    await setFallbackGridIntensity();
    return;
  }

  try {
    const geoRes = await fetch("https://ipapi.co/json/");
    const geo = await geoRes.json();
    const zone = geo.country_code || "DEFAULT";

    const emRes = await fetch(
      `https://api.electricitymap.org/v3/carbon-intensity/latest?zone=${zone}`,
      { headers: { "auth-token": ELECTRICITY_MAPS_KEY } }
    );

    if (!emRes.ok) throw new Error("API unavailable");

    const em = await emRes.json();
    const intensity = em.carbonIntensity / 1000;
    await chrome.storage.local.set({ gridIntensity: intensity, gridZone: zone, gridSource: GRID_SOURCES.LIVE });
    console.log(`[EcoLens] Live grid: ${zone} = ${intensity} kg/kWh`);
  } catch {
    await setFallbackGridIntensity();
  }
}

function isSameDay(ts) {
  if (!ts) return false;
  return getDayKey(ts) === getDayKey(Date.now());
}

async function maybeResetDaily() {
  const { currentAccountId, currentAccountName, accounts } = await getAccountStorage();
  const account = normalizeAccountState(accounts[currentAccountId], currentAccountName);
  if (isSameDay(account.lastResetTs)) return;

  resetAccountDay(account);
  pruneAccountHistory(account);
  accounts[currentAccountId] = account;
  await saveAccountStorage(currentAccountId, currentAccountName, accounts);
  console.log("[EcoLens] Daily reset.");
}

async function pruneAllAccounts() {
  const { currentAccountId, currentAccountName, accounts } = await getAccountStorage();
  Object.keys(accounts).forEach((accountId) => {
    accounts[accountId] = pruneAccountHistory(normalizeAccountState(accounts[accountId]));
  });
  await saveAccountStorage(currentAccountId, currentAccountName, accounts);
}

async function maybeSendBudgetAlert() {
  const { currentAccountId, currentAccountName, accounts } = await getAccountStorage();
  const account = normalizeAccountState(accounts[currentAccountId], currentAccountName);
  const budget = account.budget;

  if (!budget.enabled || !budget.dailyGrams || budget.dailyGrams <= 0) return;

  const todayKey = getDayKey();
  const total = account.totalCo2 || 0;
  let changed = false;

  if (total >= budget.dailyGrams && budget.alert100Date !== todayKey) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: "EcoLens budget reached",
      message: `You have reached ${Math.round(total)}g of CO2 today, above your ${budget.dailyGrams}g budget.`,
      priority: 2,
    });
    account.budget.alert100Date = todayKey;
    changed = true;
  } else if (total >= (budget.dailyGrams * 0.8) && budget.alert80Date !== todayKey) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: "EcoLens budget warning",
      message: `You have used ${Math.round(total)}g of CO2 today, which is 80% of your ${budget.dailyGrams}g budget.`,
      priority: 1,
    });
    account.budget.alert80Date = todayKey;
    changed = true;
  }

  if (changed) {
    accounts[currentAccountId] = account;
    await saveAccountStorage(currentAccountId, currentAccountName, accounts);
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0 || details.type !== "main_frame") return;
    tabBytes[details.tabId] = 0;
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const bytes = details.responseHeaders
      ?.find((header) => header.name.toLowerCase() === "content-length")
      ?.value;

    if (bytes) {
      tabBytes[details.tabId] = (tabBytes[details.tabId] || 0) + parseInt(bytes, 10);
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "GET_TAB_BYTES") {
    reply({ bytes: tabBytes[sender.tab?.id] || 0 });
    return true;
  }

  if (msg.type === "RESET_TAB_BYTES") {
    if (sender.tab?.id !== undefined) {
      tabBytes[sender.tab.id] = 0;
    }
    reply({ ok: true });
    return true;
  }

  if (msg.type === "AUTH_START") {
    startCloudAuth(msg.email)
      .then(reply)
      .catch((error) => reply({ ok: false, error: error.message }));
    return true;
  }

  if (msg.type === "AUTH_VERIFY") {
    verifyCloudAuth(msg.email, msg.code)
      .then(reply)
      .catch((error) => reply({ ok: false, error: error.message }));
    return true;
  }

  if (msg.type === "AUTH_SIGN_OUT") {
    clearCloudAuth()
      .then(reply)
      .catch((error) => reply({ ok: false, error: error.message }));
    return true;
  }

  if (msg.type === "AUTH_REFRESH_PROFILE") {
    refreshCloudProfile()
      .then(reply)
      .catch((error) => reply({ ok: false, error: error.message }));
    return true;
  }

  if (msg.type === "SYNC_NOW") {
    syncCurrentAccount(msg.reason || "manual")
      .then(reply)
      .catch((error) => reply({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!(changes.accounts || changes.totalCo2 || changes.currentAccountId)) return;

  maybeResetDaily().then(maybeSendBudgetAlert);
  syncCurrentAccount("storage_change");
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabBytes[tabId];
});

chrome.runtime.onInstalled.addListener(async () => {
  const { currentAccountId, currentAccountName, accounts } = await getAccountStorage();
  accounts[currentAccountId] = normalizeAccountState(accounts[currentAccountId], currentAccountName);
  await saveAccountStorage(currentAccountId, currentAccountName, accounts);
  await updateSyncState({});
  await fetchGridIntensity();
});

chrome.runtime.onStartup.addListener(async () => {
  await maybeResetDaily();
  await pruneAllAccounts();
  await updateSyncState({});
  await fetchGridIntensity();
  await maybeSendBudgetAlert();
  await syncCurrentAccount("startup");
});

chrome.alarms.create("refreshGrid", { periodInMinutes: 120 });
chrome.alarms.create("dailyMaintenance", { periodInMinutes: 60 });
chrome.alarms.create(CLOUD_SYNC_ALARM, { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refreshGrid") {
    fetchGridIntensity();
    return;
  }

  if (alarm.name === "dailyMaintenance") {
    maybeResetDaily().then(pruneAllAccounts).then(maybeSendBudgetAlert);
    return;
  }

  if (alarm.name === CLOUD_SYNC_ALARM) {
    syncCurrentAccount("alarm");
  }
});
