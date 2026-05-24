// ============================================================
//  EcoLens - content.js
// ============================================================

const BASE = {
  google: { kWh: 0.0003, label: "Google Search", perUnit: "search" },
  chatgpt: { kWh: 0.003, label: "ChatGPT", perUnit: "query" },
  netflix: { kWh: 0.1, label: "Netflix", perUnit: "hour" },
  youtube: { kWh: 0.036, label: "YouTube", perUnit: "hour" },

  DATA_KWH_PER_GB: 0.06,

  DEVICE: {
    phone: 0.005,
    laptop: 0.02,
    desktop: 0.08,
    tv: 0.1,
  },
};

const SITES = {
  google: {
    match: () => location.href.includes("google.com/search"),
    base: BASE.google,
    color: "#5dbf72",
    streaming: false,
  },
  chatgpt: {
    match: () => location.href.includes("chat.openai.com") || location.href.includes("chatgpt.com"),
    base: BASE.chatgpt,
    color: "#EF9F27",
    streaming: false,
  },
  netflix: {
    match: () => location.href.includes("netflix.com/watch"),
    base: BASE.netflix,
    color: "#E24B4A",
    streaming: true,
  },
  youtube: {
    match: () => location.href.includes("youtube.com/watch") || location.href.includes("youtu.be"),
    base: BASE.youtube,
    color: "#E24B4A",
    streaming: true,
  },
};

const DEFAULT_ACCOUNT_ID = "default";

function buildEmptyAccountState(now = Date.now()) {
  return {
    totalCo2: 0,
    counts: {},
    siteTotals: {},
    lastSite: null,
    lastTs: null,
    lastResetTs: now,
  };
}

function getAccountStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        "currentAccountId",
        "accounts",
        "totalCo2",
        "counts",
        "siteTotals",
        "lastSite",
        "lastTs",
        "lastResetTs",
      ],
      (stored) => {
        const currentAccountId = stored.currentAccountId || DEFAULT_ACCOUNT_ID;
        const accounts = stored.accounts || {};

        if (!accounts[currentAccountId] && (
          stored.totalCo2 !== undefined ||
          stored.counts !== undefined ||
          stored.siteTotals !== undefined ||
          stored.lastSite !== undefined ||
          stored.lastTs !== undefined ||
          stored.lastResetTs !== undefined
        )) {
          accounts[currentAccountId] = {
            ...buildEmptyAccountState(),
            totalCo2: stored.totalCo2 || 0,
            counts: stored.counts || {},
            siteTotals: stored.siteTotals || {},
            lastSite: stored.lastSite || null,
            lastTs: stored.lastTs || null,
            lastResetTs: stored.lastResetTs || Date.now(),
          };
        }

        if (!accounts[currentAccountId]) {
          accounts[currentAccountId] = buildEmptyAccountState();
        }

        resolve({ currentAccountId, accounts });
      }
    );
  });
}

function saveAccountStorage(currentAccountId, accounts) {
  const account = accounts[currentAccountId] || buildEmptyAccountState();
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        currentAccountId,
        accounts,
        totalCo2: account.totalCo2,
        counts: account.counts,
        siteTotals: account.siteTotals,
        lastSite: account.lastSite,
        lastTs: account.lastTs,
        lastResetTs: account.lastResetTs,
      },
      resolve
    );
  });
}

function detectSite() {
  for (const [key, cfg] of Object.entries(SITES)) {
    if (cfg.match()) return { key, ...cfg };
  }
  return null;
}

async function getGridIntensity() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["gridIntensity", "gridZone", "gridSource"], (d) => {
      resolve({
        intensity: d.gridIntensity ?? 0.35 / 1000,
        zone: d.gridZone ?? "?",
        source: d.gridSource ?? "default",
      });
    });
  });
}

async function getDeviceKwhPerHour() {
  if ("getBattery" in navigator) {
    try {
      const bat = await navigator.getBattery();
      if (!bat.charging && bat.dischargingTime !== Infinity) {
        const watts = 50 / (bat.dischargingTime / 3600);
        if (watts > 0 && watts < 150) return watts / 1000;
      }
    } catch {
      // Ignore and fall back to the user-selected device type.
    }
  }

  return new Promise((resolve) => {
    chrome.storage.local.get("deviceType", (d) => {
      resolve(BASE.DEVICE[d.deviceType ?? "laptop"]);
    });
  });
}

function queryTabBytes() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_TAB_BYTES" }, (response) => {
      resolve(response?.bytes ?? 0);
    });
  });
}

function resetTabBytes() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "RESET_TAB_BYTES" }, () => resolve());
  });
}

async function calcCo2(site, elapsedHours = 0) {
  const grid = await getGridIntensity();
  const deviceKwh = await getDeviceKwhPerHour();
  const bytes = await queryTabBytes();

  let networkKwh = 0;

  if (bytes > 10_000) {
    const gb = bytes / 1e9;
    networkKwh = gb * BASE.DATA_KWH_PER_GB;
  } else {
    networkKwh = site.base.kWh;
  }

  if (site.streaming && elapsedHours > 0) {
    networkKwh = site.base.kWh * elapsedHours;
  }

  const deviceHours = site.streaming ? elapsedHours : (1 / 60);
  const totalKwh = networkKwh + (deviceKwh * deviceHours);
  const grams = totalKwh * grid.intensity * 1000;

  return {
    grams: Math.max(0.01, grams),
    grid,
    bytes,
    networkKwh,
    deviceKwh,
    model: bytes > 10_000 ? "measured" : "estimated",
  };
}

const EQUIVS = [
  { threshold: 0, text: (g) => `${(g / 0.007 * 60).toFixed(0)} sec of a LED bulb` },
  { threshold: 1, text: (g) => `${(g / 0.3).toFixed(1)} Google searches` },
  { threshold: 5, text: (g) => `boiling ${(g * 2).toFixed(0)} ml of water` },
  { threshold: 20, text: (g) => `driving ~${(g * 4).toFixed(0)} m by petrol car` },
  { threshold: 100, text: (g) => `${(g / 36).toFixed(1)} hrs of Netflix` },
];

function getEquiv(grams) {
  let fn = EQUIVS[0].text;
  for (const e of EQUIVS) {
    if (grams >= e.threshold) fn = e.text;
  }
  return fn(grams);
}

function fmt(g) {
  if (g < 0.1) return `${g.toFixed(3)}g`;
  if (g < 10) return `${g.toFixed(2)}g`;
  if (g < 1000) return `${g.toFixed(1)}g`;
  return `${(g / 1000).toFixed(2)} kg`;
}

function injectStyles() {
  if (document.getElementById("ecolens-styles")) return;
  const s = document.createElement("style");
  s.id = "ecolens-styles";
  s.textContent = `
    @keyframes el-in {
      0%   { opacity:0; transform:translateY(18px) scale(0.93); }
      65%  { opacity:1; transform:translateY(-3px) scale(1.02); }
      100% { opacity:1; transform:translateY(0) scale(1); }
    }
    @keyframes el-out {
      to { opacity:0; transform:translateY(10px) scale(0.94); }
    }
    @keyframes el-pulse {
      0%,100% { box-shadow:0 0 0 0 rgba(93,191,114,0); }
      50% { box-shadow:0 0 0 5px rgba(93,191,114,0.12); }
    }
    @keyframes el-dot {
      0%,100% { opacity:1; transform:scale(1); }
      50% { opacity:0.4; transform:scale(0.7); }
    }
    #ecolens-badge {
      position:fixed; bottom:22px; right:22px; z-index:2147483647;
      min-width:210px; background:#0a0e0b;
      border-radius:14px; border:1px solid #2a4a2c;
      padding:12px 16px 11px;
      font-family:'DM Mono','Courier New',monospace;
      cursor:pointer; user-select:none;
      animation:el-in 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards,
                el-pulse 3s ease-in-out 0.7s infinite;
    }
    #ecolens-badge.hiding { animation:el-out 0.28s ease forwards; }
    #ecolens-badge .el-hd { display:flex; align-items:center; gap:6px; margin-bottom:8px; }
    #ecolens-badge .el-dot { width:7px;height:7px;border-radius:50%;animation:el-dot 2s ease-in-out infinite; }
    #ecolens-badge .el-brand { font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#5dbf72;font-weight:500; }
    #ecolens-badge .el-site-tag { font-size:10px;color:#3a5a3c;margin-left:auto; }
    #ecolens-badge .el-co2 { font-size:26px;font-weight:500;line-height:1;margin-bottom:3px; }
    #ecolens-badge .el-unit { font-size:10px;color:#4a6b4c;margin-bottom:9px; }
    #ecolens-badge .el-divider { height:1px;background:#1e2e1f;margin:0 -16px 9px; }
    #ecolens-badge .el-row { display:flex;align-items:baseline;gap:6px;margin-bottom:4px; }
    #ecolens-badge .el-label { font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#3a5a3c;flex:1; }
    #ecolens-badge .el-val { font-size:11px;color:#7a9b7c; }
    #ecolens-badge .el-model-pill {
      display:inline-block;font-size:9px;padding:1px 6px;border-radius:100px;margin-bottom:8px;
      background:#0d1f0e;color:#5dbf72;border:1px solid #2a4a2c;
    }
    #ecolens-badge .el-bar-track { height:3px;background:#111a12;border-radius:100px;overflow:hidden;margin-top:8px; }
    #ecolens-badge .el-bar-fill { height:100%;border-radius:100px;width:0%;transition:width 1.1s cubic-bezier(0.25,1,0.5,1); }
    #ecolens-badge .el-compare { display:flex;justify-content:space-between;font-size:9px;color:#2a4a2c;margin-top:3px; }
    #ecolens-badge .el-close { position:absolute;top:9px;right:11px;font-size:14px;color:#2a4a2c;padding:2px 5px;border-radius:4px;line-height:1;transition:color .15s,background .15s; }
    #ecolens-badge .el-close:hover { color:#5dbf72;background:#0f1a10; }
  `;
  document.head.appendChild(s);
}

function buildBadge(site, result, elapsedHours = 0) {
  const { grams, grid, bytes, model } = result;
  const pct = Math.min((grams / 36) * 100, 100).toFixed(1);
  const badge = document.createElement("div");
  badge.id = "ecolens-badge";

  const bytesStr = bytes > 1e6
    ? `${(bytes / 1e6).toFixed(1)} MB transferred`
    : bytes > 1000
    ? `${(bytes / 1000).toFixed(0)} KB transferred`
    : "measuring...";

  const gridStr = `${(grid.intensity * 1000).toFixed(0)} g/kWh - ${grid.zone}`;
  const timeRow = site.streaming
    ? `<div class="el-row"><span class="el-label">Time</span><span class="el-val el-time-val">${Math.round(elapsedHours * 60)} min watched</span></div>`
    : "";

  badge.innerHTML = `
    <div class="el-hd">
      <span class="el-dot" style="background:${site.color}"></span>
      <span class="el-brand">EcoLens</span>
      <span class="el-site-tag">${site.base.label}</span>
    </div>

    <div class="el-co2" style="color:${site.color}" id="el-co2-num">${fmt(grams)}</div>
    <div class="el-unit">CO2${site.streaming ? " so far" : " this visit"}</div>

    <span class="el-model-pill">${model === "measured" ? "measured" : "estimated"}</span>

    <div class="el-divider"></div>

    <div class="el-row">
      <span class="el-label">Grid</span>
      <span class="el-val">${gridStr}</span>
    </div>
    <div class="el-row">
      <span class="el-label">Data</span>
      <span class="el-val el-data-val">${bytesStr}</span>
    </div>
    ${timeRow}
    <div class="el-row">
      <span class="el-label">Like...</span>
      <span class="el-val el-like-val">~ ${getEquiv(grams)}</span>
    </div>

    <div class="el-bar-track">
      <div class="el-bar-fill" id="el-bar" style="background:${site.color}"></div>
    </div>
    <div class="el-compare">
      <span>0g</span><span class="el-compare-current" style="color:${site.color}">${fmt(grams)}</span><span>36g (Netflix/hr)</span>
    </div>

    <span class="el-close" id="el-close" title="Dismiss">x</span>
  `;

  return { badge, pct };
}

function updateBadgeNumber(grams, color) {
  const el = document.getElementById("el-co2-num");
  if (el) {
    el.textContent = fmt(grams);
    el.style.color = color;
  }
}

function updateBadgeMeta({ grams, bytes, elapsedHours, site }) {
  const dataEl = document.querySelector("#ecolens-badge .el-data-val");
  const likeEl = document.querySelector("#ecolens-badge .el-like-val");
  const compareEl = document.querySelector("#ecolens-badge .el-compare-current");
  const barEl = document.getElementById("el-bar");
  const timeEl = document.querySelector("#ecolens-badge .el-time-val");

  const bytesStr = bytes > 1e6
    ? `${(bytes / 1e6).toFixed(1)} MB transferred`
    : bytes > 1000
    ? `${(bytes / 1000).toFixed(0)} KB transferred`
    : "measuring...";

  if (dataEl) dataEl.textContent = bytesStr;
  if (likeEl) likeEl.textContent = `~ ${getEquiv(grams)}`;
  if (compareEl) compareEl.textContent = fmt(grams);
  if (barEl) barEl.style.width = `${Math.min((grams / 36) * 100, 100).toFixed(1)}%`;
  if (site.streaming && timeEl) timeEl.textContent = `${Math.round(elapsedHours * 60)} min watched`;
}

function saveVisitToStorage(siteKey, grams) {
  getAccountStorage().then(({ currentAccountId, accounts }) => {
    const account = accounts[currentAccountId] || buildEmptyAccountState();
    account.counts[siteKey] = (account.counts[siteKey] || 0) + 1;
    account.siteTotals[siteKey] = (account.siteTotals[siteKey] || 0) + grams;
    account.totalCo2 += grams;
    account.lastSite = siteKey;
    account.lastTs = Date.now();
    accounts[currentAccountId] = account;
    return saveAccountStorage(currentAccountId, accounts);
  });
}

function addToSiteTotals(siteKey, grams) {
  if (grams <= 0) return;

  getAccountStorage().then(({ currentAccountId, accounts }) => {
    const account = accounts[currentAccountId] || buildEmptyAccountState();
    account.siteTotals[siteKey] = (account.siteTotals[siteKey] || 0) + grams;
    account.totalCo2 += grams;
    account.lastSite = siteKey;
    account.lastTs = Date.now();
    accounts[currentAccountId] = account;
    return saveAccountStorage(currentAccountId, accounts);
  });
}

function dismiss() {
  const badge = document.getElementById("ecolens-badge");
  if (!badge) return;
  badge.classList.add("hiding");
  setTimeout(() => badge.remove(), 300);
}

let streamingInterval = null;
let sessionVisibleMs = 0;
let sessionVisibleStartedAt = null;
let lastStreamingGrams = 0;
let activeStreamingSite = null;
let lastUrl = location.href;

function getElapsedStreamingHours() {
  const liveVisibleMs = sessionVisibleStartedAt ? Date.now() - sessionVisibleStartedAt : 0;
  return (sessionVisibleMs + liveVisibleMs) / 3_600_000;
}

function stopStreamingTicker(trackElapsed = true) {
  if (streamingInterval) {
    clearInterval(streamingInterval);
    streamingInterval = null;
  }

  if (trackElapsed && sessionVisibleStartedAt) {
    sessionVisibleMs += Date.now() - sessionVisibleStartedAt;
    sessionVisibleStartedAt = null;
  }
}

function resetStreamingSession() {
  stopStreamingTicker(false);
  sessionVisibleMs = 0;
  sessionVisibleStartedAt = null;
  lastStreamingGrams = 0;
  activeStreamingSite = null;
}

function startStreamingTicker(site) {
  activeStreamingSite = site;
  sessionVisibleStartedAt = Date.now();

  streamingInterval = setInterval(async () => {
    if (document.visibilityState === "hidden") return;

    const elapsedHours = getElapsedStreamingHours();
    const updated = await calcCo2(site, elapsedHours);

    updateBadgeNumber(updated.grams, site.color);
    updateBadgeMeta({
      grams: updated.grams,
      bytes: updated.bytes,
      elapsedHours,
      site,
    });

    const delta = updated.grams - lastStreamingGrams;
    if (delta > 0) {
      addToSiteTotals(site.key, delta);
      lastStreamingGrams = updated.grams;
    }
  }, 10_000);
}

async function init() {
  const site = detectSite();
  if (!site || document.getElementById("ecolens-badge")) return;

  injectStyles();

  if (site.streaming) {
    await resetTabBytes();
    resetStreamingSession();
  }

  const result = await calcCo2(site, 0);
  const { badge, pct } = buildBadge(site, result, 0);
  document.body.appendChild(badge);

  requestAnimationFrame(() => {
    setTimeout(() => {
      const bar = document.getElementById("el-bar");
      if (bar) bar.style.width = `${pct}%`;
    }, 100);
  });

  document.getElementById("el-close").addEventListener("click", (e) => {
    e.stopPropagation();
    dismiss();
  });

  if (!site.streaming) {
    setTimeout(dismiss, 15000);
  }

  saveVisitToStorage(site.key, result.grams);

  if (site.streaming) {
    lastStreamingGrams = result.grams;
    startStreamingTicker(site);
  }
}

document.addEventListener("visibilitychange", () => {
  if (!activeStreamingSite) return;

  if (document.visibilityState === "hidden") {
    stopStreamingTicker(true);
    return;
  }

  if (!streamingInterval) {
    startStreamingTicker(activeStreamingSite);
  }
});

const navObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    resetStreamingSession();
    dismiss();
    resetTabBytes().finally(() => setTimeout(init, 800));
  }
});

navObserver.observe(document.documentElement, { subtree: true, childList: true });
window.addEventListener("popstate", () => setTimeout(init, 800));
window.addEventListener("beforeunload", () => {
  resetStreamingSession();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
