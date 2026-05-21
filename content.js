// ============================================================
//  EcoLens — content.js  (Phase 1: Accuracy upgrade)
//
//  Improvements over v1:
//   1. Grid-intensity-aware CO₂ (location-based)
//   2. Real bytes-transferred measurement for data-transfer model
//   3. Live time-on-page ticker for streaming sites (Netflix/YouTube)
//   4. Device energy layer (via getBattery or device-type picker)
// ============================================================

// ── Base energy constants (kWh per unit) ─────────────────────
// Source: Shift Project (2022), IEA (2023)
// These are BASE values assuming global average grid (0.350 kg/kWh).
// We multiply by the user's actual grid intensity at runtime.

const BASE = {
  // kWh per query/session — network + datacenter only
  google:  { kWh: 0.0003,  label: "Google Search",   perUnit: "search"  },
  chatgpt: { kWh: 0.003,   label: "ChatGPT",         perUnit: "query"   },
  netflix: { kWh: 0.1,     label: "Netflix",          perUnit: "hour"    },
  youtube: { kWh: 0.036,   label: "YouTube",          perUnit: "hour"    },

  // Data-transfer model: kWh per GB (Shift Project)
  DATA_KWH_PER_GB: 0.06,

  // Device energy draw: kWh per hour
  DEVICE: {
    phone:   0.005,
    laptop:  0.020,
    desktop: 0.080,
    tv:      0.100,
  },
};

// ── Site detection ────────────────────────────────────────────

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

function detectSite() {
  for (const [key, cfg] of Object.entries(SITES)) {
    if (cfg.match()) return { key, ...cfg };
  }
  return null;
}

// ── Grid intensity (fetched from storage, set by background.js) ──

async function getGridIntensity() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["gridIntensity", "gridZone", "gridSource"], (d) => {
      resolve({
        intensity: d.gridIntensity ?? 0.350 / 1000,   // default: 350 g/kWh in kg/kWh
        zone:      d.gridZone     ?? "?",
        source:    d.gridSource   ?? "default",
      });
    });
  });
}

// ── Device energy ─────────────────────────────────────────────

async function getDeviceKwhPerHour() {
  // Try Battery API first (gives a rough power draw hint)
  if ("getBattery" in navigator) {
    try {
      const bat = await navigator.getBattery();
      // If battery is discharging, estimate power from discharge rate
      if (!bat.charging && bat.dischargingTime !== Infinity) {
        // dischargingTime is in seconds for full discharge
        // Typical battery = 50 Wh → power draw = 50 / (dischargingTime / 3600)
        const watts = 50 / (bat.dischargingTime / 3600);
        if (watts > 0 && watts < 150) return watts / 1000; // kW → kWh/hr
      }
    } catch { /* ignore */ }
  }
  // Fallback: read device type from storage (set by user in popup)
  return new Promise((resolve) => {
    chrome.storage.local.get("deviceType", (d) => {
      resolve(BASE.DEVICE[d.deviceType ?? "laptop"]);
    });
  });
}

// ── CO₂ calculation engine ────────────────────────────────────
// Returns grams of CO₂ for a given site visit.
// Uses bytes-transferred model when data is available,
// falls back to base-energy model.

async function calcCo2(site, elapsedHours = 0) {
  const grid      = await getGridIntensity();
  const deviceKwh = await getDeviceKwhPerHour();

  // Ask background.js for bytes transferred on this tab
  const { bytes } = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_TAB_BYTES" }, resolve);
  });

  let networkKwh = 0;

  if (bytes > 10_000) {
    // Data-transfer model: more accurate when bytes are known
    const gb  = bytes / 1e9;
    networkKwh = gb * BASE.DATA_KWH_PER_GB;
  } else {
    // Base model: use hardcoded kWh per session
    networkKwh = site.base.kWh;
  }

  // For streaming sites: scale by actual time watched
  if (site.streaming && elapsedHours > 0) {
    networkKwh = site.base.kWh * elapsedHours;
  }

  // Device energy (what your screen + CPU uses)
  const deviceHours = site.streaming ? elapsedHours : (1 / 60); // 1 min for non-streaming
  const totalKwh    = networkKwh + (deviceKwh * deviceHours);

  // Convert: kWh × kg_CO2/kWh × 1000 = grams
  const grams = totalKwh * grid.intensity * 1000;

  return {
    grams:   Math.max(0.01, grams),
    grid,
    bytes,
    networkKwh,
    deviceKwh,
    model:   bytes > 10_000 ? "measured" : "estimated",
  };
}

// ── Real-world equivalents ────────────────────────────────────

const EQUIVS = [
  { threshold: 0,   text: g => `${(g / 0.007 * 60).toFixed(0)} sec of a LED bulb` },
  { threshold: 1,   text: g => `${(g / 0.3).toFixed(1)} Google searches` },
  { threshold: 5,   text: g => `boiling ${(g * 2).toFixed(0)} ml of water` },
  { threshold: 20,  text: g => `driving ~${(g * 4).toFixed(0)} m by petrol car` },
  { threshold: 100, text: g => `${(g / 36).toFixed(1)} hrs of Netflix` },
];

function getEquiv(grams) {
  let fn = EQUIVS[0].text;
  for (const e of EQUIVS) {
    if (grams >= e.threshold) fn = e.text;
  }
  return fn(grams);
}

// ── Format helpers ────────────────────────────────────────────

function fmt(g) {
  if (g < 0.1)  return g.toFixed(3) + "g";
  if (g < 10)   return g.toFixed(2) + "g";
  if (g < 1000) return g.toFixed(1) + "g";
  return (g / 1000).toFixed(2) + " kg";
}

// ── CSS injection ─────────────────────────────────────────────

function injectStyles(color) {
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
      50%      { box-shadow:0 0 0 5px rgba(93,191,114,0.12); }
    }
    @keyframes el-dot {
      0%,100% { opacity:1; transform:scale(1); }
      50%      { opacity:0.4; transform:scale(0.7); }
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
    #ecolens-badge .el-bar-fill  { height:100%;border-radius:100px;width:0%;transition:width 1.1s cubic-bezier(0.25,1,0.5,1); }
    #ecolens-badge .el-compare   { display:flex;justify-content:space-between;font-size:9px;color:#2a4a2c;margin-top:3px; }
    #ecolens-badge .el-close     { position:absolute;top:9px;right:11px;font-size:14px;color:#2a4a2c;padding:2px 5px;border-radius:4px;line-height:1;transition:color .15s,background .15s; }
    #ecolens-badge .el-close:hover { color:#5dbf72;background:#0f1a10; }
    #ecolens-badge .el-ticker { font-size:13px;font-weight:500;transition:all 0.4s; }
  `;
  document.head.appendChild(s);
}

// ── Badge render & update ─────────────────────────────────────

function buildBadge(site, result, elapsed = 0) {
  const { grams, grid, bytes, model } = result;
  const equiv  = getEquiv(grams);
  const maxG   = 36;
  const pct    = Math.min((grams / maxG) * 100, 100).toFixed(1);

  const badge  = document.createElement("div");
  badge.id     = "ecolens-badge";

  const bytesStr = bytes > 1e6
    ? `${(bytes / 1e6).toFixed(1)} MB transferred`
    : bytes > 1000
    ? `${(bytes / 1000).toFixed(0)} KB transferred`
    : "measuring…";

  const gridStr = `${(grid.intensity * 1000).toFixed(0)} g/kWh · ${grid.zone}`;
  const timeStr  = site.streaming && elapsed > 0
    ? `${Math.round(elapsed * 60)} min watched`
    : null;

  badge.innerHTML = `
    <div class="el-hd">
      <span class="el-dot" style="background:${site.color}"></span>
      <span class="el-brand">EcoLens</span>
      <span class="el-site-tag">${site.base.label}</span>
    </div>

    <div class="el-co2" style="color:${site.color}" id="el-co2-num">${fmt(grams)}</div>
    <div class="el-unit">CO₂${site.streaming ? " so far" : " this visit"}</div>

    <span class="el-model-pill">${model === "measured" ? "⬡ measured" : "~ estimated"}</span>

    <div class="el-divider"></div>

    <div class="el-row">
      <span class="el-label">Grid</span>
      <span class="el-val">${gridStr}</span>
    </div>
    <div class="el-row">
      <span class="el-label">Data</span>
      <span class="el-val">${bytesStr}</span>
    </div>
    ${timeStr ? `<div class="el-row"><span class="el-label">Time</span><span class="el-val">${timeStr}</span></div>` : ""}
    <div class="el-row">
      <span class="el-label">Like…</span>
      <span class="el-val">≈ ${equiv}</span>
    </div>

    <div class="el-bar-track">
      <div class="el-bar-fill" id="el-bar" style="background:${site.color}"></div>
    </div>
    <div class="el-compare">
      <span>0g</span><span style="color:${site.color}">${fmt(grams)}</span><span>36g (Netflix/hr)</span>
    </div>

    <span class="el-close" id="el-close" title="Dismiss">✕</span>
  `;

  return { badge, pct };
}

function updateBadgeNumber(grams, color) {
  const el = document.getElementById("el-co2-num");
  if (el) { el.textContent = fmt(grams); el.style.color = color; }
}

// ── Storage update ────────────────────────────────────────────

function saveToStorage(siteKey, grams) {
  chrome.storage.local.get(["totalCo2", "counts"], ({ totalCo2 = 0, counts = {} }) => {
    counts[siteKey] = (counts[siteKey] || 0) + 1;
    chrome.storage.local.set({
      totalCo2: totalCo2 + grams,
      counts,
      lastSite: siteKey,
      lastTs: Date.now(),
    });
  });
}

// ── Badge dismiss ─────────────────────────────────────────────

function dismiss() {
  const b = document.getElementById("ecolens-badge");
  if (!b) return;
  b.classList.add("hiding");
  setTimeout(() => b.remove(), 300);
}

// ── Main init ─────────────────────────────────────────────────

let streamingInterval = null;
let sessionStartTime  = null;

async function init() {
  const site = detectSite();
  if (!site || document.getElementById("ecolens-badge")) return;

  injectStyles(site.color);

  const elapsedHours = 0;
  const result = await calcCo2(site, elapsedHours);

  const { badge, pct } = buildBadge(site, result, elapsedHours);
  document.body.appendChild(badge);

  // Animate bar after paint
  requestAnimationFrame(() => {
    setTimeout(() => {
      const bar = document.getElementById("el-bar");
      if (bar) bar.style.width = pct + "%";
    }, 100);
  });

  // Close handlers
  document.getElementById("el-close").addEventListener("click", (e) => {
    e.stopPropagation(); dismiss();
  });

  // Auto-dismiss after 15s (non-streaming only)
  if (!site.streaming) {
    setTimeout(dismiss, 15000);
  }

  saveToStorage(site.key, result.grams);

  // ── Live ticker for streaming sites ──────────────────────────
  // Updates the badge every 10 seconds with real elapsed time.

  if (site.streaming) {
    sessionStartTime = Date.now();

    streamingInterval = setInterval(async () => {
      // Pause if tab is hidden (Page Visibility API)
      if (document.visibilityState === "hidden") return;

      const elapsed = (Date.now() - sessionStartTime) / 3_600_000; // hours
      const updated = await calcCo2(site, elapsed);

      updateBadgeNumber(updated.grams, site.color);

      // Update storage incrementally (only the delta)
      const delta = updated.grams - result.grams;
      if (delta > 0) {
        chrome.storage.local.get("totalCo2", ({ totalCo2 = 0 }) => {
          chrome.storage.local.set({ totalCo2: totalCo2 + delta });
        });
      }
    }, 10_000);   // tick every 10 seconds

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        clearInterval(streamingInterval);
      } else {
        // Resume — re-init the interval
        sessionStartTime = sessionStartTime || Date.now();
      }
    });
  }
}

// ── SPA navigation support ────────────────────────────────────

let lastUrl = location.href;

const navObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    if (streamingInterval) { clearInterval(streamingInterval); streamingInterval = null; }
    setTimeout(init, 800);
  }
});

navObserver.observe(document.documentElement, { subtree: true, childList: true });
window.addEventListener("popstate", () => setTimeout(init, 800));

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}