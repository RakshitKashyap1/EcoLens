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

async function setFallbackGridIntensity() {
  try {
    const geoRes = await fetch("https://ipapi.co/country/");
    const zone = (await geoRes.text()).trim();
    const intensity = (GRID_FALLBACKS[zone] ?? GRID_FALLBACKS.DEFAULT) / 1000;
    await chrome.storage.local.set({ gridIntensity: intensity, gridZone: zone, gridSource: "fallback" });
    console.log(`[EcoLens] Fallback grid: ${zone} = ${intensity} kg/Wh`);
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
    console.log(`[EcoLens] Live grid: ${zone} = ${intensity} kg/Wh`);
  } catch {
    await setFallbackGridIntensity();
  }
}

function isSameDay(ts) {
  if (!ts) return false;
  const then = new Date(ts);
  const now = new Date();
  return then.toDateString() === now.toDateString();
}

async function maybeResetDaily() {
  const { lastResetTs } = await chrome.storage.local.get("lastResetTs");
  if (isSameDay(lastResetTs)) return;

  await chrome.storage.local.set({
    totalCo2: 0,
    counts: {},
    siteTotals: {},
    lastSite: null,
    lastTs: null,
    lastResetTs: Date.now(),
  });
  console.log("[EcoLens] Daily reset.");
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

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabBytes[tabId];
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ totalCo2: 0, counts: {}, siteTotals: {}, lastResetTs: Date.now() });
  await fetchGridIntensity();
});

chrome.runtime.onStartup.addListener(async () => {
  await maybeResetDaily();
  await fetchGridIntensity();
});

chrome.alarms.create("refreshGrid", { periodInMinutes: 120 });
chrome.alarms.create("dailyMaintenance", { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refreshGrid") {
    fetchGridIntensity();
    return;
  }

  if (alarm.name === "dailyMaintenance") {
    maybeResetDaily();
  }
});
