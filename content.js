// ============================================================
//  EcoLens - content.js
// ============================================================

const BASE = {
  google: { kWh: 0.0003, label: "Google Search", perUnit: "search" },
  chatgpt: { kWh: 0.003, label: "ChatGPT", perUnit: "query" },
  claude: { kWh: 0.0025, label: "Claude", perUnit: "query" },
  gemini: { kWh: 0.002, label: "Gemini", perUnit: "query" },
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

const CHATGPT_MODELS = [
  { id: "gpt-3.5", label: "GPT-3.5", kWh: 0.0003, aliases: ["gpt-3.5", "3.5"] },
  { id: "gpt-4o-mini", label: "GPT-4o mini", kWh: 0.0006, aliases: ["gpt-4o mini", "4o mini"] },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", kWh: 0.0008, aliases: ["gpt-4.1 mini", "4.1 mini"] },
  { id: "o4-mini", label: "o4-mini", kWh: 0.0015, aliases: ["o4-mini", "o4 mini"] },
  { id: "gpt-4o", label: "GPT-4o", kWh: 0.003, aliases: ["gpt-4o", "4o"] },
  { id: "gpt-4.1", label: "GPT-4.1", kWh: 0.0035, aliases: ["gpt-4.1", "4.1"] },
  { id: "o3", label: "o3", kWh: 0.006, aliases: ["o3"] },
];

const CLAUDE_MODELS = [
  { id: "claude-haiku", label: "Claude Haiku", kWh: 0.0005, aliases: ["haiku"] },
  { id: "claude-sonnet", label: "Claude Sonnet", kWh: 0.0018, aliases: ["sonnet"] },
  { id: "claude-opus", label: "Claude Opus", kWh: 0.0045, aliases: ["opus"] },
];

const GEMINI_MODELS = [
  { id: "gemini-flash", label: "Gemini Flash", kWh: 0.0006, aliases: ["flash"] },
  { id: "gemini-pro", label: "Gemini Pro", kWh: 0.0018, aliases: ["pro"] },
  { id: "gemini-ultra", label: "Gemini Ultra", kWh: 0.004, aliases: ["ultra"] },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", kWh: 0.0035, aliases: ["2.5 pro"] },
];

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
  claude: {
    match: () => location.href.includes("claude.ai"),
    base: BASE.claude,
    color: "#D97706",
    streaming: false,
  },
  gemini: {
    match: () => location.href.includes("gemini.google.com"),
    base: BASE.gemini,
    color: "#4F86F7",
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
const DEFAULT_ACCOUNT_NAME = "Personal account";
const ACTIVITY_RETENTION_DAYS = 90;

function isAiSiteKey(siteKey) {
  return siteKey === "chatgpt" || siteKey === "claude" || siteKey === "gemini";
}

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

function ensureActiveDay(account, now = Date.now()) {
  if (getDayKey(account.lastResetTs) === getDayKey(now)) return account;

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
  const cutoff = now - (ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  account.activityLog = account.activityLog.filter((event) => (event?.ts || 0) >= cutoff);
  return account;
}

function applyUsageEvent(account, event) {
  const ts = event.ts || Date.now();
  ensureActiveDay(account, ts);

  const grams = Math.max(0, event.grams || 0);
  const dayKey = getDayKey(ts);
  const siteKey = event.siteKey;
  const modelId = event.modelId || "unknown";
  const shouldIncrementCount = event.incrementCount !== false;

  account.totalCo2 += grams;
  account.siteTotals[siteKey] = (account.siteTotals[siteKey] || 0) + grams;
  if (shouldIncrementCount) {
    account.counts[siteKey] = (account.counts[siteKey] || 0) + 1;
  }

  if (event.modelLabel) {
    account.modelTotals[modelId] = (account.modelTotals[modelId] || 0) + grams;
  }

  const day = account.dailyTotals[dayKey] || buildEmptyDailySnapshot();
  day.totalCo2 += grams;
  day.bySite[siteKey] = (day.bySite[siteKey] || 0) + grams;
  if (event.modelLabel) {
    day.byModel[modelId] = (day.byModel[modelId] || 0) + grams;
  }
  if (shouldIncrementCount) {
    day.counts[siteKey] = (day.counts[siteKey] || 0) + 1;
  }
  day.eventCount += 1;
  account.dailyTotals[dayKey] = day;

  account.activityLog.push({
    ts,
    siteKey,
    grams,
    bytes: event.bytes || 0,
    provider: event.provider || null,
    modelId: event.modelId || null,
    modelLabel: event.modelLabel || null,
    measurementMode: event.measurementMode || "estimated",
    type: event.type || "visit",
  });

  pruneAccountHistory(account, ts);
  account.lastSite = siteKey;
  account.lastTs = ts;
  return account;
}

function getAccountStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        "currentAccountId",
        "currentAccountName",
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

        resolve({
          currentAccountId,
          currentAccountName: accounts[currentAccountId].profile.name || currentAccountName,
          accounts,
        });
      }
    );
  });
}

function saveAccountStorage(currentAccountId, currentAccountName, accounts) {
  const account = normalizeAccountState(accounts[currentAccountId], currentAccountName);
  accounts[currentAccountId] = account;

  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
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

function detectChatGptModel() {
  const text = collectModelDetectionText();

  for (const model of CHATGPT_MODELS) {
    if (model.aliases.some((alias) => text.includes(alias.toLowerCase()))) {
      return {
        provider: "openai",
        modelId: model.id,
        label: model.label,
        kWh: model.kWh,
        confidence: "heuristic",
      };
    }
  }

  return {
    provider: "openai",
    modelId: "chatgpt-default",
    label: "ChatGPT default",
    kWh: BASE.chatgpt.kWh,
    confidence: "unknown",
  };
}

function collectModelDetectionText() {
  const selectors = [
    "button",
    "[role='button']",
    "[data-testid]",
    "[aria-label]",
    "[data-value]",
    "main",
    "nav",
    "header",
  ];

  return selectors
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)).slice(0, 60))
    .map((el) => {
      const aria = el.getAttribute("aria-label") || "";
      const dataValue = el.getAttribute("data-value") || "";
      const text = el.textContent || "";
      return `${aria} ${dataValue} ${text}`.trim();
    })
    .join(" ")
    .toLowerCase();
}

function detectModelFromCatalog(catalog, fallback) {
  const text = collectModelDetectionText();

  for (const model of catalog) {
    if (model.aliases.some((alias) => text.includes(alias.toLowerCase()))) {
      return {
        provider: fallback.provider,
        modelId: model.id,
        label: model.label,
        kWh: model.kWh,
        confidence: "heuristic",
      };
    }
  }

  return fallback;
}

function detectClaudeModel() {
  return detectModelFromCatalog(CLAUDE_MODELS, {
    provider: "anthropic",
    modelId: "claude-default",
    label: "Claude default",
    kWh: BASE.claude.kWh,
    confidence: "unknown",
  });
}

function detectGeminiModel() {
  return detectModelFromCatalog(GEMINI_MODELS, {
    provider: "google",
    modelId: "gemini-default",
    label: "Gemini default",
    kWh: BASE.gemini.kWh,
    confidence: "unknown",
  });
}

function detectAiModel(site) {
  if (site.key === "chatgpt") return detectChatGptModel();
  if (site.key === "claude") return detectClaudeModel();
  if (site.key === "gemini") return detectGeminiModel();
  return null;
}

async function calcCo2(site, elapsedHours = 0, aiModel = null) {
  const grid = await getGridIntensity();
  const deviceKwh = await getDeviceKwhPerHour();
  const bytes = await queryTabBytes();

  let networkKwh = 0;
  const fallbackBaseKwh = aiModel?.kWh || site.base.kWh;

  if (bytes > 10_000) {
    const gb = bytes / 1e9;
    networkKwh = gb * BASE.DATA_KWH_PER_GB;
    if (isAiSiteKey(site.key) && aiModel?.kWh) {
      networkKwh = Math.max(networkKwh, aiModel.kWh);
    }
  } else {
    networkKwh = fallbackBaseKwh;
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
    measurementMode: bytes > 10_000 ? "measured" : "estimated",
    aiModel,
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
      min-width:230px; background:#0a0e0b;
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
    #ecolens-badge .el-pills { display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap; }
    #ecolens-badge .el-model-pill {
      display:inline-block;font-size:9px;padding:1px 6px;border-radius:100px;
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
  const { grams, grid, bytes, measurementMode, aiModel } = result;
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
  const modelRow = aiModel
    ? `<div class="el-row"><span class="el-label">Model</span><span class="el-val el-model-name">${aiModel.label}</span></div>`
    : "";
  const modelPill = aiModel
    ? `<span class="el-model-pill">${aiModel.confidence === "heuristic" ? "model heuristic" : "model default"}</span>`
    : "";

  badge.innerHTML = `
    <div class="el-hd">
      <span class="el-dot" style="background:${site.color}"></span>
      <span class="el-brand">EcoLens</span>
      <span class="el-site-tag">${site.base.label}</span>
    </div>

    <div class="el-co2" style="color:${site.color}" id="el-co2-num">${fmt(grams)}</div>
    <div class="el-unit">CO2${site.streaming ? " so far" : isAiSiteKey(site.key) ? " per prompt" : " this visit"}</div>

    <div class="el-pills">
      <span class="el-model-pill">${measurementMode}</span>
      ${modelPill}
    </div>

    <div class="el-divider"></div>

    <div class="el-row">
      <span class="el-label">Grid</span>
      <span class="el-val">${gridStr}</span>
    </div>
    <div class="el-row">
      <span class="el-label">Data</span>
      <span class="el-val el-data-val">${bytesStr}</span>
    </div>
    ${modelRow}
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

function updateBadgeMeta({ grams, bytes, elapsedHours, site, aiModel, measurementMode }) {
  const dataEl = document.querySelector("#ecolens-badge .el-data-val");
  const likeEl = document.querySelector("#ecolens-badge .el-like-val");
  const compareEl = document.querySelector("#ecolens-badge .el-compare-current");
  const barEl = document.getElementById("el-bar");
  const timeEl = document.querySelector("#ecolens-badge .el-time-val");
  const modelEl = document.querySelector("#ecolens-badge .el-model-name");
  const pillEl = document.querySelector("#ecolens-badge .el-pills .el-model-pill");

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
  if (modelEl && aiModel) modelEl.textContent = aiModel.label;
  if (pillEl && measurementMode) pillEl.textContent = measurementMode;
}

function recordUsageEvent(event) {
  return getAccountStorage().then(({ currentAccountId, currentAccountName, accounts }) => {
    const account = normalizeAccountState(accounts[currentAccountId], currentAccountName);
    applyUsageEvent(account, event);
    accounts[currentAccountId] = account;
    return saveAccountStorage(currentAccountId, currentAccountName, accounts);
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
let aiQueryTrackerBound = false;
let lastAiSubmitAt = 0;

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
  aiQueryTrackerBound = false;
  lastAiSubmitAt = 0;
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
      measurementMode: updated.measurementMode,
    });

    const delta = updated.grams - lastStreamingGrams;
    if (delta > 0) {
      await recordUsageEvent({
        ts: Date.now(),
        siteKey: site.key,
        grams: delta,
        bytes: updated.bytes,
        type: "stream",
        incrementCount: false,
        measurementMode: updated.measurementMode,
      });
      lastStreamingGrams = updated.grams;
    }
  }, 10_000);
}

function isAiSendButton(target) {
  const button = target?.closest?.("button");
  if (!button) return false;

  const label = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`.toLowerCase();
  const testId = (button.getAttribute("data-testid") || "").toLowerCase();

  return (
    testId.includes("send") ||
    label.includes("send message") ||
    label.includes("send") ||
    label.includes("submit") ||
    label.includes("run") ||
    label.includes("ask") ||
    label.includes("arrow up") ||
    label.includes("new chat") === false && (label.includes("send") || label.includes("submit")) ||
    label === "send" ||
    label.includes("submit")
  );
}

function isAiInputSubmit(event) {
  const target = event.target;
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  const isTypingField = tag === "textarea" || target.getAttribute?.("contenteditable") === "true";
  return isTypingField && event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

function bindAiQueryTracker(site) {
  if (aiQueryTrackerBound) return;
  aiQueryTrackerBound = true;

  const scheduleRecord = () => {
    const now = Date.now();
    if (now - lastAiSubmitAt < 1500) return;
    lastAiSubmitAt = now;

    setTimeout(async () => {
      const aiModel = detectAiModel(site);
      const result = await calcCo2(site, 0, aiModel);
      updateBadgeNumber(result.grams, site.color);
      updateBadgeMeta({
        grams: result.grams,
        bytes: result.bytes,
        elapsedHours: 0,
        site,
        aiModel,
        measurementMode: result.measurementMode,
      });

      await recordUsageEvent({
        ts: Date.now(),
        siteKey: site.key,
        grams: result.grams,
        bytes: result.bytes,
        provider: aiModel?.provider || null,
        modelId: aiModel?.modelId || null,
        modelLabel: aiModel?.label || null,
        type: "query",
        incrementCount: true,
        measurementMode: result.measurementMode,
      });
    }, 1200);
  };

  document.addEventListener("click", (event) => {
    if (isAiSendButton(event.target)) {
      scheduleRecord();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (isAiInputSubmit(event)) {
      scheduleRecord();
    }
  });
}

async function init() {
  const site = detectSite();
  if (!site || document.getElementById("ecolens-badge")) return;

  injectStyles();

  if (site.streaming) {
    await resetTabBytes();
    resetStreamingSession();
  }

  const aiModel = detectAiModel(site);
  const result = await calcCo2(site, 0, aiModel);
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

  if (!site.streaming && !isAiSiteKey(site.key)) {
    setTimeout(dismiss, 15000);
  }

  if (isAiSiteKey(site.key)) {
    bindAiQueryTracker(site);
    return;
  }

  await recordUsageEvent({
    ts: Date.now(),
    siteKey: site.key,
    grams: result.grams,
    bytes: result.bytes,
    type: site.streaming ? "stream-start" : "visit",
    incrementCount: true,
    measurementMode: result.measurementMode,
  });

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
