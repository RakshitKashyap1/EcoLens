// ============================================================
//  EcoLens - content.js
// ============================================================

// Baseline energy estimates and device profiles used when a site does not expose measurements.
const BASE = {
  google: { kWh: 0.0003, label: "Google Search", perUnit: "search" },
  chatgpt: { kWh: 0.003, label: "ChatGPT", perUnit: "query" },
  claude: { kWh: 0.0025, label: "Claude", perUnit: "query" },
  gemini: { kWh: 0.002, label: "Gemini", perUnit: "query" },
  perplexity: { kWh: 0.0022, label: "Perplexity", perUnit: "query" },
  netflix: { kWh: 0.1, label: "Netflix", perUnit: "hour" },
  youtube: { kWh: 0.036, label: "YouTube", perUnit: "hour" },
  spotify: { kWh: 0.012, label: "Spotify", perUnit: "hour" },

  DATA_KWH_PER_GB: 0.06,

  DEVICE: {
    phone: 0.005,
    laptop: 0.02,
    desktop: 0.08,
    tv: 0.1,
  },
};

// Heuristic model catalogs let us recognize common labels in visible UI text.
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

const PERPLEXITY_MODELS = [
  { id: "perplexity-sonar", label: "Sonar", kWh: 0.0015, aliases: ["sonar"] },
  { id: "perplexity-pro", label: "Perplexity Pro", kWh: 0.0028, aliases: ["pro search", "perplexity pro"] },
  { id: "perplexity-reasoning", label: "Reasoning", kWh: 0.0038, aliases: ["reasoning", "deep research"] },
];

// Site definitions keep matching, styling, and behavior in one place.
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
  perplexity: {
    match: () => location.href.includes("perplexity.ai"),
    base: BASE.perplexity,
    color: "#4FD1C5",
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
  spotify: {
    match: () => location.href.includes("open.spotify.com"),
    base: BASE.spotify,
    color: "#1ED760",
    streaming: true,
  },
};

const GRID_INTENSITY_FALLBACK = 0.35 / 1000;
const BYTES_MEASURED_THRESHOLD = 10_000;
const AI_SUBMIT_DEBOUNCE_MS = 1500;
const STREAM_INTERVAL_MS = 15_000;

const {
  DEFAULT_ACCOUNT_ID,
  DEFAULT_ACCOUNT_NAME,
  MEASUREMENT_MODES,
  GRID_SOURCES,
  DEVICE_SOURCES,
  MODEL_CONFIDENCE,
  normalizeAccountState,
  normalizeUsageEvent,
  applyUsageEvent,
  pruneAccountHistory,
  detectModelFromText,
} = globalThis.EcoLensShared;

// Shared helpers for account loading and site classification.
function isAiSiteKey(siteKey) {
  return siteKey === "chatgpt" || siteKey === "claude" || siteKey === "gemini" || siteKey === "perplexity";
}

// Mirror the background-page account loading logic inside the content script.
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

// Persist the active account summary after a new usage event is recorded.
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

// Identify which supported site is currently open.
function detectSite() {
  for (const [key, cfg] of Object.entries(SITES)) {
    if (cfg.match()) return { key, ...cfg };
  }
  return null;
}

// Read the last known grid intensity so the badge can show the source context.
function getGridIntensity() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["gridIntensity", "gridZone", "gridSource"], (d) => {
      resolve({
        intensity: d.gridIntensity ?? GRID_INTENSITY_FALLBACK,
        zone: d.gridZone ?? "?",
        source: d.gridSource ?? GRID_SOURCES.DEFAULT,
      });
    });
  });
}

// Prefer battery-derived energy if available, otherwise use the selected device type.
async function getDeviceEnergyInfo() {
  if ("getBattery" in navigator) {
    try {
      const battery = await navigator.getBattery();
      if (!battery.charging && battery.dischargingTime !== Infinity) {
        const watts = 50 / (battery.dischargingTime / 3600);
        if (watts > 0 && watts < 150) {
          return {
            kwhPerHour: watts / 1000,
            source: DEVICE_SOURCES.BATTERY_HEURISTIC,
            deviceType: "battery-derived",
          };
        }
      }
    } catch {
      // Ignore and fall back to the selected device profile.
    }
  }

  return new Promise((resolve) => {
    chrome.storage.local.get("deviceType", (d) => {
      const deviceType = d.deviceType ?? "laptop";
      resolve({
        kwhPerHour: BASE.DEVICE[deviceType] || BASE.DEVICE.laptop,
        source: DEVICE_SOURCES.SELECTED_DEVICE,
        deviceType,
      });
    });
  });
}

// Ask the background worker how many bytes have been observed for the current tab.
function queryTabBytes() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_TAB_BYTES" }, (response) => {
      resolve(response?.bytes ?? 0);
    });
  });
}

// Reset the background worker's byte counter when we start a fresh session.
function resetTabBytes() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "RESET_TAB_BYTES" }, () => resolve());
  });
}

// Pull together visible labels and attributes so we can guess the active AI model.
function collectModelDetectionText() {
  const selectors = [
    "button",
    "[role='button']",
    "[data-testid]",
    "[aria-label]",
    "[data-value]",
    "[data-state]",
    "[title]",
    "main",
    "nav",
    "header",
  ];

  return selectors
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)).slice(0, 80))
    .map((el) => {
      const aria = el.getAttribute("aria-label") || "";
      const dataValue = el.getAttribute("data-value") || "";
      const dataState = el.getAttribute("data-state") || "";
      const title = el.getAttribute("title") || "";
      const text = el.textContent || "";
      return `${aria} ${dataValue} ${dataState} ${title} ${text}`.trim();
    })
    .join(" ")
    .toLowerCase();
}

// Each provider gets its own model detector because the visible labels differ.
function detectChatGptModel() {
  return detectModelFromText(collectModelDetectionText(), CHATGPT_MODELS, {
    provider: "openai",
    modelId: "chatgpt-default",
    label: "ChatGPT default",
    kWh: BASE.chatgpt.kWh,
    confidence: MODEL_CONFIDENCE.DEFAULT,
  });
}

// Detect Claude model names from visible UI text.
function detectClaudeModel() {
  return detectModelFromText(collectModelDetectionText(), CLAUDE_MODELS, {
    provider: "anthropic",
    modelId: "claude-default",
    label: "Claude default",
    kWh: BASE.claude.kWh,
    confidence: MODEL_CONFIDENCE.DEFAULT,
  });
}

// Detect Gemini model names from visible UI text.
function detectGeminiModel() {
  return detectModelFromText(collectModelDetectionText(), GEMINI_MODELS, {
    provider: "google",
    modelId: "gemini-default",
    label: "Gemini default",
    kWh: BASE.gemini.kWh,
    confidence: MODEL_CONFIDENCE.DEFAULT,
  });
}

// Detect Perplexity model names from visible UI text.
function detectPerplexityModel() {
  return detectModelFromText(collectModelDetectionText(), PERPLEXITY_MODELS, {
    provider: "perplexity",
    modelId: "perplexity-default",
    label: "Perplexity default",
    kWh: BASE.perplexity.kWh,
    confidence: MODEL_CONFIDENCE.DEFAULT,
  });
}

// Dispatch to the right provider-specific model detector for the current site.
function detectAiModel(site) {
  if (site.key === "chatgpt") return detectChatGptModel();
  if (site.key === "claude") return detectClaudeModel();
  if (site.key === "gemini") return detectGeminiModel();
  if (site.key === "perplexity") return detectPerplexityModel();
  return null;
}

// Convert bytes, model cost, device cost, and grid intensity into a CO2 estimate.
function buildEnergyBreakdown({ site, bytes, elapsedHours, aiModel, deviceInfo, grid }) {
  const deviceHours = site.streaming ? elapsedHours : (1 / 60);
  const measuredNetworkKwh = bytes > BYTES_MEASURED_THRESHOLD
    ? (bytes / 1e9) * BASE.DATA_KWH_PER_GB
    : 0;

  let baselineKwhUsed = 0;
  let networkKwhUsed = measuredNetworkKwh;

  if (site.streaming && elapsedHours > 0) {
    networkKwhUsed = 0;
    baselineKwhUsed = site.base.kWh * elapsedHours;
  } else if (measuredNetworkKwh > 0) {
    if (isAiSiteKey(site.key) && aiModel?.kWh) {
      baselineKwhUsed = Math.max(aiModel.kWh - measuredNetworkKwh, 0);
    }
  } else {
    baselineKwhUsed = aiModel?.kWh || site.base.kWh;
  }

  const deviceKwhUsed = deviceInfo.kwhPerHour * deviceHours;
  const totalKwhUsed = networkKwhUsed + baselineKwhUsed + deviceKwhUsed;
  const grams = totalKwhUsed * grid.intensity * 1000;

  return {
    grams: Math.max(0.01, grams),
    measurementMode: measuredNetworkKwh > 0 && !site.streaming
      ? MEASUREMENT_MODES.MEASURED
      : MEASUREMENT_MODES.ESTIMATED,
    networkBytesUsed: bytes,
    networkKwhUsed,
    baselineKwhUsed,
    deviceKwhUsed,
    totalKwhUsed,
  };
}

// Run the whole calculation pipeline in parallel so the badge can render quickly.
async function calcCo2(site, elapsedHours = 0, aiModel = null) {
  const [grid, deviceInfo, bytes] = await Promise.all([
    getGridIntensity(),
    getDeviceEnergyInfo(),
    queryTabBytes(),
  ]);

  const breakdown = buildEnergyBreakdown({
    site,
    bytes,
    elapsedHours,
    aiModel,
    deviceInfo,
    grid,
  });

  return {
    ...breakdown,
    grid,
    bytes,
    deviceInfo,
    aiModel,
  };
}

// Real-world equivalence phrases help make the gram values easier to understand.
const EQUIVS = [
  { threshold: 0, text: (g) => `${(g / 0.007 * 60).toFixed(0)} sec of a LED bulb` },
  { threshold: 1, text: (g) => `${(g / 0.3).toFixed(1)} Google searches` },
  { threshold: 5, text: (g) => `boiling ${(g * 2).toFixed(0)} ml of water` },
  { threshold: 20, text: (g) => `driving ~${(g * 4).toFixed(0)} m by petrol car` },
  { threshold: 100, text: (g) => `${(g / 36).toFixed(1)} hrs of Netflix` },
];

// Pick the best analogy for the current amount of CO2.
function getEquiv(grams) {
  let fn = EQUIVS[0].text;
  for (const e of EQUIVS) {
    if (grams >= e.threshold) fn = e.text;
  }
  return fn(grams);
}

// Format grams into a compact, human-readable value for the badge.
function fmt(g) {
  if (g < 0.1) return `${g.toFixed(3)}g`;
  if (g < 10) return `${g.toFixed(2)}g`;
  if (g < 1000) return `${g.toFixed(1)}g`;
  return `${(g / 1000).toFixed(2)} kg`;
}

// Format energy usage values in a compact form for the methodology section.
function fmtKwh(kwh) {
  if (kwh <= 0) return "0 kWh";
  if (kwh < 0.01) return `${kwh.toFixed(4)} kWh`;
  return `${kwh.toFixed(3)} kWh`;
}

// Format network bytes so the badge can show whether transfer data was measured.
function formatBytes(bytes) {
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} MB transferred`;
  if (bytes > 1000) return `${(bytes / 1000).toFixed(0)} KB transferred`;
  return "baseline estimate";
}

// Translate confidence flags into the small labels shown in the badge.
function formatModelConfidence(confidence) {
  return confidence === MODEL_CONFIDENCE.DETECTED ? "model detected" : "model default";
}

function formatGridSource(source) {
  return source === GRID_SOURCES.LIVE ? "live grid" : "regional average";
}

// Inject the badge stylesheet once so the in-page UI is self-contained.
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
      min-width:260px; max-width:300px; background:#0a0e0b;
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
    #ecolens-badge .el-val { font-size:11px;color:#7a9b7c; text-align:right; }
    #ecolens-badge .el-pills { display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap; }
    #ecolens-badge .el-pill {
      display:inline-block;font-size:9px;padding:1px 6px;border-radius:100px;
      background:#0d1f0e;color:#5dbf72;border:1px solid #2a4a2c;
    }
    #ecolens-badge .el-method {
      margin-top:8px; padding:7px 8px; border:1px solid #182418; border-radius:8px;
      background:#0d130e;
    }
    #ecolens-badge .el-method-grid { display:grid; grid-template-columns:1fr 1fr; gap:4px 10px; }
    #ecolens-badge .el-mini { font-size:9px; color:#3a5a3c; text-transform:uppercase; letter-spacing:.06em; }
    #ecolens-badge .el-mini-val { font-size:10px; color:#7a9b7c; }
    #ecolens-badge .el-bar-track { height:3px;background:#111a12;border-radius:100px;overflow:hidden;margin-top:8px; }
    #ecolens-badge .el-bar-fill { height:100%;border-radius:100px;width:0%;transition:width 1.1s cubic-bezier(0.25,1,0.5,1); }
    #ecolens-badge .el-compare { display:flex;justify-content:space-between;font-size:9px;color:#2a4a2c;margin-top:3px; }
    #ecolens-badge .el-close { position:absolute;top:9px;right:11px;font-size:14px;color:#2a4a2c;padding:2px 5px;border-radius:4px;line-height:1;transition:color .15s,background .15s; }
    #ecolens-badge .el-close:hover { color:#5dbf72;background:#0f1a10; }
  `;
  document.head.appendChild(s);
}

// Build the floating badge DOM from the latest measurement result.
function buildBadge(site, result, elapsedHours = 0) {
  const { grams, grid, bytes, measurementMode, aiModel, deviceInfo } = result;
  const pct = Math.min((grams / 36) * 100, 100).toFixed(1);
  const badge = document.createElement("div");
  badge.id = "ecolens-badge";

  const timeRow = site.streaming
    ? `<div class="el-row"><span class="el-label">Time</span><span class="el-val el-time-val">${Math.round(elapsedHours * 60)} min active</span></div>`
    : "";
  const modelRow = aiModel
    ? `<div class="el-row"><span class="el-label">Model</span><span class="el-val el-model-name">${aiModel.label}</span></div>`
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
      <span class="el-pill el-measurement-pill">${measurementMode}</span>
      <span class="el-pill el-grid-pill">${formatGridSource(grid.source)}</span>
      ${aiModel ? `<span class="el-pill el-model-pill">${formatModelConfidence(aiModel.confidence)}</span>` : ""}
    </div>

    <div class="el-divider"></div>

    <div class="el-row">
      <span class="el-label">Grid</span>
      <span class="el-val el-grid-val">${(grid.intensity * 1000).toFixed(0)} g/kWh - ${grid.zone}</span>
    </div>
    <div class="el-row">
      <span class="el-label">Data</span>
      <span class="el-val el-data-val">${formatBytes(bytes)}</span>
    </div>
    <div class="el-row">
      <span class="el-label">Device</span>
      <span class="el-val el-device-val">${deviceInfo.source === DEVICE_SOURCES.BATTERY_HEURISTIC ? "battery heuristic" : deviceInfo.deviceType}</span>
    </div>
    ${modelRow}
    ${timeRow}
    <div class="el-row">
      <span class="el-label">Like...</span>
      <span class="el-val el-like-val">~ ${getEquiv(grams)}</span>
    </div>

    <div class="el-method">
      <div class="el-mini" style="margin-bottom:4px;">How this was estimated</div>
      <div class="el-method-grid">
        <span class="el-mini">Network</span><span class="el-mini-val el-network-kwh">${fmtKwh(result.networkKwhUsed)}</span>
        <span class="el-mini">Baseline</span><span class="el-mini-val el-baseline-kwh">${fmtKwh(result.baselineKwhUsed)}</span>
        <span class="el-mini">Device</span><span class="el-mini-val el-device-kwh">${fmtKwh(result.deviceKwhUsed)}</span>
        <span class="el-mini">Total</span><span class="el-mini-val el-total-kwh">${fmtKwh(result.totalKwhUsed)}</span>
      </div>
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

// Update only the main number when the badge is already on screen.
function updateBadgeNumber(grams, color) {
  const el = document.getElementById("el-co2-num");
  if (el) {
    el.textContent = fmt(grams);
    el.style.color = color;
  }
}

// Update the rest of the badge fields after a fresh measurement.
function updateBadgeMeta({ result, elapsedHours, site }) {
  const dataEl = document.querySelector("#ecolens-badge .el-data-val");
  const likeEl = document.querySelector("#ecolens-badge .el-like-val");
  const compareEl = document.querySelector("#ecolens-badge .el-compare-current");
  const barEl = document.getElementById("el-bar");
  const timeEl = document.querySelector("#ecolens-badge .el-time-val");
  const modelEl = document.querySelector("#ecolens-badge .el-model-name");
  const measurementPill = document.querySelector("#ecolens-badge .el-measurement-pill");
  const gridPill = document.querySelector("#ecolens-badge .el-grid-pill");
  const modelPill = document.querySelector("#ecolens-badge .el-model-pill");
  const gridVal = document.querySelector("#ecolens-badge .el-grid-val");
  const deviceVal = document.querySelector("#ecolens-badge .el-device-val");
  const networkEl = document.querySelector("#ecolens-badge .el-network-kwh");
  const baselineEl = document.querySelector("#ecolens-badge .el-baseline-kwh");
  const deviceEl = document.querySelector("#ecolens-badge .el-device-kwh");
  const totalEl = document.querySelector("#ecolens-badge .el-total-kwh");

  if (dataEl) dataEl.textContent = formatBytes(result.bytes);
  if (likeEl) likeEl.textContent = `~ ${getEquiv(result.grams)}`;
  if (compareEl) compareEl.textContent = fmt(result.grams);
  if (barEl) barEl.style.width = `${Math.min((result.grams / 36) * 100, 100).toFixed(1)}%`;
  if (site.streaming && timeEl) timeEl.textContent = `${Math.round(elapsedHours * 60)} min active`;
  if (modelEl && result.aiModel) modelEl.textContent = result.aiModel.label;
  if (measurementPill) measurementPill.textContent = result.measurementMode;
  if (gridPill) gridPill.textContent = formatGridSource(result.grid.source);
  if (modelPill && result.aiModel) modelPill.textContent = formatModelConfidence(result.aiModel.confidence);
  if (gridVal) gridVal.textContent = `${(result.grid.intensity * 1000).toFixed(0)} g/kWh - ${result.grid.zone}`;
  if (deviceVal) {
    deviceVal.textContent = result.deviceInfo.source === DEVICE_SOURCES.BATTERY_HEURISTIC
      ? "battery heuristic"
      : result.deviceInfo.deviceType;
  }
  if (networkEl) networkEl.textContent = fmtKwh(result.networkKwhUsed);
  if (baselineEl) baselineEl.textContent = fmtKwh(result.baselineKwhUsed);
  if (deviceEl) deviceEl.textContent = fmtKwh(result.deviceKwhUsed);
  if (totalEl) totalEl.textContent = fmtKwh(result.totalKwhUsed);
}

// Persist one usage event through the shared account normalization pipeline.
function recordUsageEvent(event) {
  return getAccountStorage().then(({ currentAccountId, currentAccountName, accounts }) => {
    const account = normalizeAccountState(accounts[currentAccountId], currentAccountName);
    applyUsageEvent(account, event);
    pruneAccountHistory(account);
    accounts[currentAccountId] = account;
    return saveAccountStorage(currentAccountId, currentAccountName, accounts);
  });
}

// Dismiss the badge with a small exit animation instead of removing it instantly.
function dismiss() {
  const badge = document.getElementById("ecolens-badge");
  if (!badge) return;
  badge.classList.add("hiding");
  setTimeout(() => badge.remove(), 300);
}

// Track a streaming session across visibility changes so we do not overcount.
let streamingInterval = null;
let sessionVisibleMs = 0;
let sessionVisibleStartedAt = null;
let lastStreamingGrams = 0;
let activeStreamingSite = null;
let lastUrl = location.href;
let aiQueryTrackerBound = false;
let lastAiSubmitAt = 0;

// Combine paused and currently visible time into a total streaming duration.
function getElapsedStreamingHours() {
  const liveVisibleMs = sessionVisibleStartedAt ? Date.now() - sessionVisibleStartedAt : 0;
  return (sessionVisibleMs + liveVisibleMs) / 3_600_000;
}

// Stop the repeating streaming tick and optionally add the visible time to history.
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

// Clear the current streaming session state before starting a new one.
function resetStreamingSession() {
  stopStreamingTicker(false);
  sessionVisibleMs = 0;
  sessionVisibleStartedAt = null;
  lastStreamingGrams = 0;
  activeStreamingSite = null;
  aiQueryTrackerBound = false;
  lastAiSubmitAt = 0;
}

// Recompute the streaming estimate and record the incremental delta.
async function updateStreamingUsage(site) {
  const elapsedHours = getElapsedStreamingHours();
  const result = await calcCo2(site, elapsedHours);

  updateBadgeNumber(result.grams, site.color);
  updateBadgeMeta({ result, elapsedHours, site });

  const delta = result.grams - lastStreamingGrams;
  if (delta <= 0) return;

  const ratio = result.grams > 0 ? delta / result.grams : 0;
  await recordUsageEvent({
    ts: Date.now(),
    siteKey: site.key,
    grams: delta,
    bytes: result.bytes,
    type: "stream",
    incrementCount: false,
    measurementMode: result.measurementMode,
    gridSource: result.grid.source,
    gridZone: result.grid.zone,
    deviceSource: result.deviceInfo.source,
    modelConfidence: MODEL_CONFIDENCE.UNKNOWN,
    networkBytesUsed: result.networkBytesUsed,
    networkKwhUsed: result.networkKwhUsed * ratio,
    baselineKwhUsed: result.baselineKwhUsed * ratio,
    deviceKwhUsed: result.deviceKwhUsed * ratio,
    totalKwhUsed: result.totalKwhUsed * ratio,
  });
  lastStreamingGrams = result.grams;
}

// Start periodic updates for streaming pages while they remain visible.
function startStreamingTicker(site) {
  activeStreamingSite = site;
  sessionVisibleStartedAt = Date.now();

  streamingInterval = setInterval(() => {
    if (document.visibilityState === "hidden") return;
    updateStreamingUsage(site);
  }, STREAM_INTERVAL_MS);
}

// Detect whether a click target is the send/submit control for an AI assistant.
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
    label.includes("search")
  );
}

// Detect Enter-to-send behavior in textareas and contenteditable input areas.
function isAiInputSubmit(event) {
  const target = event.target;
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  const isTypingField = tag === "textarea" || target.getAttribute?.("contenteditable") === "true";
  return isTypingField && event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

// Listen for AI submissions and record one tracked event per prompt.
function bindAiQueryTracker(site) {
  if (aiQueryTrackerBound) return;
  aiQueryTrackerBound = true;

  const scheduleRecord = () => {
    const now = Date.now();
    if (now - lastAiSubmitAt < AI_SUBMIT_DEBOUNCE_MS) return;
    lastAiSubmitAt = now;

    setTimeout(async () => {
      const aiModel = detectAiModel(site);
      const result = await calcCo2(site, 0, aiModel);
      updateBadgeNumber(result.grams, site.color);
      updateBadgeMeta({ result, elapsedHours: 0, site });

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
        gridSource: result.grid.source,
        gridZone: result.grid.zone,
        deviceSource: result.deviceInfo.source,
        modelConfidence: aiModel?.confidence || MODEL_CONFIDENCE.UNKNOWN,
        networkBytesUsed: result.networkBytesUsed,
        networkKwhUsed: result.networkKwhUsed,
        baselineKwhUsed: result.baselineKwhUsed,
        deviceKwhUsed: result.deviceKwhUsed,
        totalKwhUsed: result.totalKwhUsed,
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

// Initialize the current page, inject the badge, and record the first event.
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
    gridSource: result.grid.source,
    gridZone: result.grid.zone,
    deviceSource: result.deviceInfo.source,
    modelConfidence: MODEL_CONFIDENCE.UNKNOWN,
    networkBytesUsed: result.networkBytesUsed,
    networkKwhUsed: result.networkKwhUsed,
    baselineKwhUsed: result.baselineKwhUsed,
    deviceKwhUsed: result.deviceKwhUsed,
    totalKwhUsed: result.totalKwhUsed,
  });

  if (site.streaming) {
    lastStreamingGrams = result.grams;
    startStreamingTicker(site);
  }
}

// Pause and resume streaming tracking when the tab visibility changes.
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

// Reinitialize tracking when the app changes routes without a full page load.
const navObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    resetStreamingSession();
    dismiss();
    resetTabBytes().finally(() => setTimeout(init, 800));
  }
});

// Handle back/forward navigation and ensure the badge starts after the page settles.
navObserver.observe(document.documentElement, { subtree: true, childList: true });
window.addEventListener("popstate", () => setTimeout(init, 800));
// Reset ephemeral session counters before the page unloads.
window.addEventListener("beforeunload", () => {
  resetStreamingSession();
});

// Support both cold loads and already-ready pages.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
