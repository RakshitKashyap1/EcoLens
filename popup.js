// ============================================================
//  EcoLens popup.js  — Phase 1 upgrade
//  Shows: grid intensity badge, session total, breakdown,
//  model source (measured vs estimated), device picker.
// ============================================================

const SITE_META = {
  google:  { label: "Google Search", color: "#5dbf72", bg: "#0d1f0e" },
  chatgpt: { label: "ChatGPT",       color: "#EF9F27", bg: "#1f180a" },
  netflix: { label: "Netflix",        color: "#E24B4A", bg: "#1f0a0a" },
  youtube: { label: "YouTube",        color: "#E24B4A", bg: "#1f0a0a" },
};

const CO2_PER_HIT = { google: 0.3, chatgpt: 3.0, netflix: 36, youtube: 1.0 };

// ── Helpers ───────────────────────────────────────────────────

function fmt(g) {
  if (g <= 0)   return "0g";
  if (g < 0.1)  return g.toFixed(3) + "g";
  if (g < 10)   return g.toFixed(2) + "g";
  if (g < 1000) return g.toFixed(1) + "g";
  return (g / 1000).toFixed(2) + " kg";
}

function co2Color(g) {
  if (g < 5)  return "";
  if (g < 30) return "amber";
  return "red";
}

function getEquiv(g) {
  if (g <= 0)   return null;
  if (g < 1)    return `${(g / 0.007 * 60).toFixed(0)} sec of a LED bulb`;
  if (g < 5)    return `${(g / 0.3).toFixed(1)} Google searches`;
  if (g < 20)   return `boiling ${(g * 2).toFixed(0)} ml of water`;
  if (g < 100)  return `driving ~${(g * 4).toFixed(0)} m by car`;
  return `${(g / 36).toFixed(1)} hrs of Netflix`;
}

// ── Grid strip ────────────────────────────────────────────────

function renderGridStrip({ intensity, zone, source }) {
  const gPerKwh = (intensity * 1000).toFixed(0);
  const dot     = document.getElementById("grid-dot");
  const val     = document.getElementById("grid-val");
  const src     = document.getElementById("grid-source");

  // Colour the dot by grid cleanliness
  const dotColor = gPerKwh < 100 ? "#5dbf72"
                 : gPerKwh < 300 ? "#EF9F27"
                 :                  "#E24B4A";

  if (dot) dot.style.background = dotColor;
  if (val) val.textContent = `${gPerKwh} g/kWh · ${zone}`;
  if (src) src.textContent = source === "live" ? "⬡ live" : "~ regional avg";
}

// ── Session panel ─────────────────────────────────────────────

function renderSession(totalCo2, counts) {
  const equiv   = getEquiv(totalCo2);
  const clr     = co2Color(totalCo2);
  const maxCo2  = Math.max(...Object.keys(SITE_META).map(k => (counts[k]||0) * CO2_PER_HIT[k]), 0.001);

  const rows = Object.entries(SITE_META).map(([key, m]) => {
    const hits  = counts[key] || 0;
    const grams = hits * CO2_PER_HIT[key];
    const pct   = ((grams / maxCo2) * 100).toFixed(1);
    return `
      <div class="site-row" style="opacity:${hits > 0 ? 1 : 0.28}">
        <div class="site-icon" style="background:${m.bg};color:${m.color}">
          ${key === "google" ? "G" : key === "chatgpt" ? "AI" : key === "netflix" ? "N" : "YT"}
        </div>
        <div style="flex:1">
          <div style="display:flex;align-items:center">
            <span class="site-name">${m.label}</span>
            <span class="site-count">${hits > 0 ? "×" + hits : ""}</span>
            <span class="site-g">${hits > 0 ? fmt(grams) : "—"}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" data-pct="${pct}" style="background:${m.color}"></div>
          </div>
        </div>
      </div>`;
  }).join("");

  return `
    <div class="session">
      <div class="sess-label">Session total</div>
      <div class="sess-num ${clr}">${fmt(totalCo2)}</div>
      <div class="sess-sub">CO₂ emitted today</div>
      ${equiv ? `<div class="equiv-box"><strong>That's like…</strong>≈ ${equiv}</div>` : ""}
    </div>
    <div class="breakdown">
      <div class="bd-label">By platform</div>
      ${rows}
    </div>`;
}

function renderEmpty() {
  return `
    <div class="empty">
      <div class="empty-icon">⬡</div>
      <div class="empty-msg">
        No activity yet.<br>
        Visit <span>google.com</span>, <span>chat.openai.com</span>,<br>
        or <span>netflix.com</span> to start tracking.
      </div>
    </div>`;
}

// ── Animate bars ──────────────────────────────────────────────

function animateBars() {
  requestAnimationFrame(() => {
    setTimeout(() => {
      document.querySelectorAll(".bar-fill[data-pct]").forEach(el => {
        el.style.width = el.dataset.pct + "%";
      });
    }, 80);
  });
}

// ── Device picker ─────────────────────────────────────────────

function setDevice(btn) {
  document.querySelectorAll(".dev-btn").forEach(b => b.classList.remove("sel"));
  btn.classList.add("sel");
  chrome.storage.local.set({ deviceType: btn.dataset.device });
}

function restoreDevice() {
  chrome.storage.local.get("deviceType", ({ deviceType }) => {
    const type = deviceType || "laptop";
    document.querySelectorAll(".dev-btn").forEach(b => {
      b.classList.toggle("sel", b.dataset.device === type);
    });
  });
}

// ── Reset ─────────────────────────────────────────────────────

document.getElementById("reset-btn").addEventListener("click", () => {
  chrome.storage.local.set({ totalCo2: 0, counts: {}, lastSite: null }, boot);
});

// ── Boot ──────────────────────────────────────────────────────

function boot() {
  chrome.storage.local.get(
    ["totalCo2", "counts", "gridIntensity", "gridZone", "gridSource"],
    (d) => {
      const total  = d.totalCo2 || 0;
      const counts = d.counts   || {};

      renderGridStrip({
        intensity: d.gridIntensity ?? 0.350 / 1000,
        zone:      d.gridZone      ?? "—",
        source:    d.gridSource    ?? "default",
      });

      document.getElementById("main-content").innerHTML =
        total > 0 ? renderSession(total, counts) : renderEmpty();

      if (total > 0) animateBars();
      restoreDevice();
    }
  );
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.totalCo2 || changes.counts || changes.gridIntensity)) {
    boot();
  }
});

boot();