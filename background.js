// Import configuration (API keys, etc.)
importScripts('config.js');

// ============================================================
//  EcoLens — background.js  (Phase 1 upgrade)
//  Service worker that:
//   1. Fetches real-time grid carbon intensity on startup
//   2. Tracks per-tab byte transfers via webRequest
//   3. Resets session daily
// ============================================================

// ── Grid intensity fetch ─────────────────────────────────────
// Uses electricitymap.org free API (sign up at app.electricitymaps.com)
// Falls back to regional defaults if API is unavailable.

const GRID_FALLBACKS = {
  IN: 0.708,   // India   — coal-heavy
  US: 0.386,   // USA     — mixed
  GB: 0.233,   // UK      — gas + renewables
  DE: 0.350,   // Germany
  FR: 0.052,   // France  — mostly nuclear
  NO: 0.024,   // Norway  — almost all hydro
  AU: 0.490,   // Australia
  CN: 0.555,   // China
  DEFAULT: 0.350,
};

// Loaded from config.js via importScripts
const ELECTRICITY_MAPS_KEY = CONFIG.ELECTRICITY_MAPS_KEY;

async function fetchGridIntensity() {
  try {
    // Step 1: get user's country via a free IP-geolocation endpoint
    const geoRes = await fetch("https://ipapi.co/json/");
    const geo    = await geoRes.json();
    const zone   = geo.country_code || "DEFAULT";

    // Step 2: fetch live intensity from Electricity Maps
    const emRes = await fetch(
      `https://api.electricitymap.org/v3/carbon-intensity/latest?zone=${zone}`,
      { headers: { "auth-token": ELECTRICITY_MAPS_KEY } }
    );

    if (emRes.ok) {
      const em = await emRes.json();
      const intensity = em.carbonIntensity / 1000; // g/Wh → kg/Wh
      await chrome.storage.local.set({ gridIntensity: intensity, gridZone: zone, gridSource: "live" });
      console.log(`[EcoLens] Live grid: ${zone} = ${intensity} kg/Wh`);
    } else {
      // API key not set or rate-limited — use fallback
      throw new Error("API unavailable");
    }
  } catch {
    // Graceful fallback: detect country from IP alone
    try {
      const geoRes = await fetch("https://ipapi.co/country/");
      const zone   = (await geoRes.text()).trim();
      const intensity = (GRID_FALLBACKS[zone] ?? GRID_FALLBACKS.DEFAULT) / 1000;
      await chrome.storage.local.set({ gridIntensity: intensity, gridZone: zone, gridSource: "fallback" });
      console.log(`[EcoLens] Fallback grid: ${zone} = ${intensity} kg/Wh`);
    } catch {
      await chrome.storage.local.set({ gridIntensity: GRID_FALLBACKS.DEFAULT / 1000, gridZone: "?", gridSource: "default" });
    }
  }
}

// ── Byte tracking via declarativeNetRequest / webRequest ─────
// We accumulate bytes per tab so content.js can query them.

const tabBytes = {};   // { [tabId]: totalBytes }

// Listen to completed requests and sum response sizes
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const bytes = details.responseHeaders
      ?.find(h => h.name.toLowerCase() === "content-length")
      ?.value;
    if (bytes) {
      tabBytes[details.tabId] = (tabBytes[details.tabId] || 0) + parseInt(bytes, 10);
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Content script queries bytes for its tab
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "GET_TAB_BYTES") {
    reply({ bytes: tabBytes[sender.tab?.id] || 0 });
    return true;
  }
  if (msg.type === "RESET_TAB_BYTES") {
    tabBytes[sender.tab?.id] = 0;
    reply({ ok: true });
    return true;
  }
});

// Clean up when tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabBytes[tabId];
});

// ── Daily reset ───────────────────────────────────────────────

function isSameDay(ts) {
  if (!ts) return false;
  const then = new Date(ts), now = new Date();
  return then.toDateString() === now.toDateString();
}

async function maybeResetDaily() {
  const { lastResetTs } = await chrome.storage.local.get("lastResetTs");
  if (!isSameDay(lastResetTs)) {
    await chrome.storage.local.set({
      totalCo2: 0,
      counts: {},
      lastSite: null,
      lastTs: null,
      lastResetTs: Date.now(),
    });
    console.log("[EcoLens] Daily reset.");
  }
}

// ── Boot ──────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ totalCo2: 0, counts: {}, lastResetTs: Date.now() });
  await fetchGridIntensity();
});

chrome.runtime.onStartup.addListener(async () => {
  await maybeResetDaily();
  await fetchGridIntensity();
});

// Refresh grid intensity every 2 hours
chrome.alarms.create("refreshGrid", { periodInMinutes: 120 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refreshGrid") fetchGridIntensity();
});