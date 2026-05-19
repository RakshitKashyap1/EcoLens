// ============================================================
//  EcoLens — content.js
//  Detects the current site, calculates CO₂, and injects
//  an animated badge into the bottom-right of the page.
// ============================================================

const SITES = {
  google: {
    match: () => location.href.includes("google.com/search"),
    co2: 0.3,
    label: "Google Search",
    color: "#5dbf72",       // green  — low impact
    equiv: [
      "3 seconds of a LED bulb",
      "charging your phone 0.02%",
      "streaming 1 second of music",
    ],
  },
  chatgpt: {
    match: () =>
      location.href.includes("chat.openai.com") ||
      location.href.includes("chatgpt.com"),
    co2: 3.0,
    label: "ChatGPT query",
    color: "#EF9F27",       // amber  — medium impact
    equiv: [
      "boiling 2 ml of water",
      "30 seconds of a LED bulb",
      "driving your car ~15 metres",
    ],
  },
  netflix: {
    match: () => location.href.includes("netflix.com/watch"),
    co2: 36,
    label: "Netflix (1 hr)",
    color: "#E24B4A",       // red    — high impact
    equiv: [
      "driving ~150 metres",
      "leaving a 40W bulb on for an hour",
      "boiling a full kettle twice",
    ],
  },
  youtube: {
    match: () =>
      location.href.includes("youtube.com/watch") ||
      location.href.includes("youtu.be"),
    co2: 1.0,
    label: "YouTube (10 min)",
    color: "#EF9F27",
    equiv: [
      "10 Google searches",
      "a 6-minute phone charge",
      "10 seconds of a hair dryer",
    ],
  },
};

// ── helpers ──────────────────────────────────────────────────

function detectSite() {
  for (const [key, cfg] of Object.entries(SITES)) {
    if (cfg.match()) return { key, ...cfg };
  }
  return null;
}

function pickEquiv(site) {
  const list = site.equiv;
  return list[Math.floor(Math.random() * list.length)];
}

function formatGrams(g) {
  return g < 1 ? g.toFixed(2) + "g" : g.toFixed(1) + "g";
}

// ── CSS injected once per page ────────────────────────────────

function injectStyles() {
  if (document.getElementById("ecolens-styles")) return;
  const style = document.createElement("style");
  style.id = "ecolens-styles";
  style.textContent = `
    @keyframes ecolens-in {
      0%   { opacity: 0; transform: translateY(18px) scale(0.92); }
      60%  { opacity: 1; transform: translateY(-4px) scale(1.02); }
      100% { opacity: 1; transform: translateY(0)    scale(1);    }
    }
    @keyframes ecolens-out {
      to   { opacity: 0; transform: translateY(12px) scale(0.92); }
    }
    @keyframes ecolens-pulse {
      0%, 100% { box-shadow: 0 0 0 0px rgba(93,191,114,0); }
      50%       { box-shadow: 0 0 0 5px rgba(93,191,114,0.15); }
    }
    @keyframes ecolens-dot {
      0%, 100% { opacity: 1; transform: scale(1);   }
      50%       { opacity: 0.4; transform: scale(0.7); }
    }
    #ecolens-badge {
      position: fixed;
      bottom: 22px;
      right: 22px;
      z-index: 2147483647;
      min-width: 190px;
      background: #0a0e0b;
      border-radius: 14px;
      border: 1px solid #2a4a2c;
      padding: 12px 16px 11px;
      font-family: 'DM Mono', 'Courier New', monospace;
      cursor: pointer;
      animation: ecolens-in 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards,
                 ecolens-pulse 3s ease-in-out 0.6s infinite;
      user-select: none;
    }
    #ecolens-badge.hiding {
      animation: ecolens-out 0.3s ease forwards;
    }
    #ecolens-badge .el-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }
    #ecolens-badge .el-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      animation: ecolens-dot 2s ease-in-out infinite;
    }
    #ecolens-badge .el-brand {
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #5dbf72;
      font-weight: 500;
    }
    #ecolens-badge .el-site {
      font-size: 10px;
      color: #3a5a3c;
      margin-left: auto;
    }
    #ecolens-badge .el-co2 {
      font-size: 26px;
      font-weight: 500;
      line-height: 1;
      margin-bottom: 3px;
      color: #f0f7f0;
    }
    #ecolens-badge .el-unit {
      font-size: 12px;
      color: #4a6b4c;
      margin-bottom: 9px;
    }
    #ecolens-badge .el-divider {
      height: 1px;
      background: #1e2e1f;
      margin: 0 -16px 9px;
    }
    #ecolens-badge .el-equiv-label {
      font-size: 9px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #3a5a3c;
      margin-bottom: 3px;
    }
    #ecolens-badge .el-equiv {
      font-size: 11px;
      color: #7a9b7c;
      line-height: 1.4;
    }
    #ecolens-badge .el-close {
      position: absolute;
      top: 9px;
      right: 11px;
      font-size: 14px;
      color: #2a4a2c;
      line-height: 1;
      padding: 2px 4px;
      border-radius: 4px;
      transition: color 0.15s, background 0.15s;
    }
    #ecolens-badge .el-close:hover {
      color: #5dbf72;
      background: #0f1a10;
    }
    #ecolens-badge .el-bar-track {
      height: 3px;
      background: #111a12;
      border-radius: 100px;
      margin-top: 10px;
      overflow: hidden;
    }
    #ecolens-badge .el-bar-fill {
      height: 100%;
      border-radius: 100px;
      width: 0%;
      transition: width 1.2s cubic-bezier(0.25,1,0.5,1);
    }
    #ecolens-badge .el-compare {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #2a4a2c;
      margin-top: 4px;
    }
  `;
  document.head.appendChild(style);
}

// ── badge rendering ───────────────────────────────────────────

function buildBadge(site) {
  const equiv = pickEquiv(site);

  // percentage of max tracked (netflix = 36g = 100%)
  const maxCo2 = 36;
  const pct = Math.min((site.co2 / maxCo2) * 100, 100).toFixed(1);

  const badge = document.createElement("div");
  badge.id = "ecolens-badge";

  badge.innerHTML = `
    <div class="el-header">
      <span class="el-dot" style="background:${site.color}"></span>
      <span class="el-brand">EcoLens</span>
      <span class="el-site">${site.label}</span>
    </div>

    <div class="el-co2" style="color:${site.color}">${formatGrams(site.co2)}</div>
    <div class="el-unit">CO₂ per session</div>

    <div class="el-divider"></div>

    <div class="el-equiv-label">Real-world equivalent</div>
    <div class="el-equiv">≈ ${equiv}</div>

    <div class="el-bar-track">
      <div class="el-bar-fill" id="ecolens-bar" style="background:${site.color}"></div>
    </div>
    <div class="el-compare">
      <span>0g</span>
      <span style="color:${site.color}">${formatGrams(site.co2)}</span>
      <span>36g (Netflix)</span>
    </div>

    <span class="el-close" id="ecolens-close" title="Dismiss">✕</span>
  `;

  return badge;
}

function dismissBadge() {
  const badge = document.getElementById("ecolens-badge");
  if (!badge) return;
  badge.classList.add("hiding");
  setTimeout(() => badge.remove(), 320);
}

// ── storage update ────────────────────────────────────────────

function updateStorage(siteKey, co2) {
  chrome.storage.local.get(
    ["totalCo2", "counts"],
    ({ totalCo2 = 0, counts = {} }) => {
      counts[siteKey] = (counts[siteKey] || 0) + 1;
      chrome.storage.local.set({
        totalCo2: totalCo2 + co2,
        counts,
        lastSite: siteKey,
        lastTs: Date.now(),
      });
    }
  );
}

// ── main ──────────────────────────────────────────────────────

function init() {
  const site = detectSite();
  if (!site) return;

  // Only show once per navigation (avoid re-running on SPAs)
  if (document.getElementById("ecolens-badge")) return;

  injectStyles();

  const badge = buildBadge(site);
  document.body.appendChild(badge);

  // Animate the impact bar after paint
  requestAnimationFrame(() => {
    setTimeout(() => {
      const bar = document.getElementById("ecolens-bar");
      const maxCo2 = 36;
      if (bar) bar.style.width =
        Math.min((site.co2 / maxCo2) * 100, 100).toFixed(1) + "%";
    }, 120);
  });

  // Close button
  document.getElementById("ecolens-close").addEventListener("click", (e) => {
    e.stopPropagation();
    dismissBadge();
  });

  // Click badge body to dismiss too
  badge.addEventListener("click", dismissBadge);

  // Auto-dismiss after 12 seconds
  setTimeout(dismissBadge, 12000);

  // Save to storage for popup
  updateStorage(site.key, site.co2);
}

// ── SPA navigation support (Google, YouTube, ChatGPT all use it) ──

let lastUrl = location.href;

function onNavigate() {
  const current = location.href;
  if (current !== lastUrl) {
    lastUrl = current;
    // Small delay so the new page's DOM is ready
    setTimeout(init, 800);
  }
}

// MutationObserver catches pushState/replaceState navigations
const observer = new MutationObserver(onNavigate);
observer.observe(document.documentElement, { subtree: true, childList: true });

// Also hook popstate for back/forward
window.addEventListener("popstate", () => setTimeout(init, 800));

// Initial load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}