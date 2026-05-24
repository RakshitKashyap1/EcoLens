try {
  importScripts("config.js");
} catch {
  console.warn("[EcoLens] config.js not found; using fallback grid defaults.");
}

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
const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_ACCOUNT_NAME = "Personal account";
const ACTIVITY_RETENTION_DAYS = 90;
const DAILY_RETENTION_DAYS = 180;

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

function buildEmptyDailySnapshot() {
  return {
    totalCo2: 0,
    bySite: {},
    byModel: {},
    counts: {},
    eventCount: 0,
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

function pruneAccountHistory(account, now = Date.now()) {
  const activityCutoff = now - (ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  account.activityLog = account.activityLog.filter((event) => (event?.ts || 0) >= activityCutoff);

  const dailyCutoffKey = getDayKey(now - (DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000));
  Object.keys(account.dailyTotals).forEach((key) => {
    if (key < dailyCutoffKey) {
      delete account.dailyTotals[key];
    }
  });

  return account;
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

async function setFallbackGridIntensity() {
  try {
    const geoRes = await fetch("https://ipapi.co/country/");
    const zone = (await geoRes.text()).trim();
    const intensity = (GRID_FALLBACKS[zone] ?? GRID_FALLBACKS.DEFAULT) / 1000;
    await chrome.storage.local.set({ gridIntensity: intensity, gridZone: zone, gridSource: "fallback" });
    console.log(`[EcoLens] Fallback grid: ${zone} = ${intensity} kg/kWh`);
  } catch {
    await chrome.storage.local.set({
      gridIntensity: GRID_FALLBACKS.DEFAULT / 1000,
      gridZone: "?",
      gridSource: "default",
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
    await chrome.storage.local.set({ gridIntensity: intensity, gridZone: zone, gridSource: "live" });
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

  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!(changes.accounts || changes.totalCo2 || changes.currentAccountId)) return;

  maybeResetDaily().then(maybeSendBudgetAlert);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabBytes[tabId];
});

chrome.runtime.onInstalled.addListener(async () => {
  const { currentAccountId, currentAccountName, accounts } = await getAccountStorage();
  accounts[currentAccountId] = normalizeAccountState(accounts[currentAccountId], currentAccountName);
  await saveAccountStorage(currentAccountId, currentAccountName, accounts);
  await fetchGridIntensity();
});

chrome.runtime.onStartup.addListener(async () => {
  await maybeResetDaily();
  await pruneAllAccounts();
  await fetchGridIntensity();
  await maybeSendBudgetAlert();
});

chrome.alarms.create("refreshGrid", { periodInMinutes: 120 });
chrome.alarms.create("dailyMaintenance", { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refreshGrid") {
    fetchGridIntensity();
    return;
  }

  if (alarm.name === "dailyMaintenance") {
    maybeResetDaily().then(pruneAllAccounts).then(maybeSendBudgetAlert);
  }
});
