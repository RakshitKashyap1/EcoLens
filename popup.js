// ============================================================
//  EcoLens popup.js
// ============================================================

const SITE_META = {
  google: { label: "Google Search", color: "#5dbf72", bg: "#0d1f0e" },
  chatgpt: { label: "ChatGPT", color: "#EF9F27", bg: "#1f180a" },
  netflix: { label: "Netflix", color: "#E24B4A", bg: "#1f0a0a" },
  youtube: { label: "YouTube", color: "#E24B4A", bg: "#1f0a0a" },
};

const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_ACCOUNT_NAME = "Personal account";

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
        "currentAccountName",
        "accounts",
        "totalCo2",
        "counts",
        "siteTotals",
        "lastSite",
        "lastTs",
        "lastResetTs",
        "gridIntensity",
        "gridZone",
        "gridSource",
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

        resolve({
          currentAccountId,
          currentAccountName,
          accounts,
          gridIntensity: stored.gridIntensity ?? 0.35 / 1000,
          gridZone: stored.gridZone ?? "-",
          gridSource: stored.gridSource ?? "default",
        });
      }
    );
  });
}

function saveAccountStorage(currentAccountId, currentAccountName, accounts, callback) {
  const account = accounts[currentAccountId] || buildEmptyAccountState();
  chrome.storage.local.set(
    {
      currentAccountId,
      currentAccountName,
      accounts,
      totalCo2: account.totalCo2,
      counts: account.counts,
      siteTotals: account.siteTotals,
      lastSite: account.lastSite,
      lastTs: account.lastTs,
      lastResetTs: account.lastResetTs,
    },
    callback
  );
}

function fmt(g) {
  if (g <= 0) return "0g";
  if (g < 0.1) return `${g.toFixed(3)}g`;
  if (g < 10) return `${g.toFixed(2)}g`;
  if (g < 1000) return `${g.toFixed(1)}g`;
  return `${(g / 1000).toFixed(2)} kg`;
}

function co2Color(g) {
  if (g < 5) return "";
  if (g < 30) return "amber";
  return "red";
}

function getEquiv(g) {
  if (g <= 0) return null;
  if (g < 1) return `${(g / 0.007 * 60).toFixed(0)} sec of a LED bulb`;
  if (g < 5) return `${(g / 0.3).toFixed(1)} Google searches`;
  if (g < 20) return `boiling ${(g * 2).toFixed(0)} ml of water`;
  if (g < 100) return `driving ~${(g * 4).toFixed(0)} m by car`;
  return `${(g / 36).toFixed(1)} hrs of Netflix`;
}

function renderGridStrip({ intensity, zone, source }) {
  const gPerKwh = (intensity * 1000).toFixed(0);
  const dot = document.getElementById("grid-dot");
  const val = document.getElementById("grid-val");
  const src = document.getElementById("grid-source");

  const dotColor = gPerKwh < 100 ? "#5dbf72"
    : gPerKwh < 300 ? "#EF9F27"
    : "#E24B4A";

  if (dot) dot.style.background = dotColor;
  if (val) val.textContent = `${gPerKwh} g/kWh - ${zone}`;
  if (src) src.textContent = source === "live" ? "live" : "regional avg";
}

function renderSession(totalCo2, counts, siteTotals) {
  const equiv = getEquiv(totalCo2);
  const clr = co2Color(totalCo2);
  const maxCo2 = Math.max(...Object.keys(SITE_META).map((key) => siteTotals[key] || 0), 0.001);

  const rows = Object.entries(SITE_META).map(([key, meta]) => {
    const hits = counts[key] || 0;
    const grams = siteTotals[key] || 0;
    const pct = ((grams / maxCo2) * 100).toFixed(1);

    return `
      <div class="site-row" style="opacity:${hits > 0 || grams > 0 ? 1 : 0.28}">
        <div class="site-icon" style="background:${meta.bg};color:${meta.color}">
          ${key === "google" ? "G" : key === "chatgpt" ? "AI" : key === "netflix" ? "N" : "YT"}
        </div>
        <div style="flex:1">
          <div style="display:flex;align-items:center">
            <span class="site-name">${meta.label}</span>
            <span class="site-count">${hits > 0 ? `x${hits}` : ""}</span>
            <span class="site-g">${grams > 0 ? fmt(grams) : "-"}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" data-pct="${pct}" style="background:${meta.color}"></div>
          </div>
        </div>
      </div>`;
  }).join("");

  return `
    <div class="session">
      <div class="sess-label">Account total</div>
      <div class="sess-num ${clr}">${fmt(totalCo2)}</div>
      <div class="sess-sub">CO2 emitted today</div>
      ${equiv ? `<div class="equiv-box"><strong>That's like...</strong>~ ${equiv}</div>` : ""}
    </div>
    <div class="breakdown">
      <div class="bd-label">By platform</div>
      ${rows}
    </div>`;
}

function renderEmpty() {
  return `
    <div class="empty">
      <div class="empty-icon">o</div>
      <div class="empty-msg">
        No activity yet.<br>
        Visit <span>google.com</span>, <span>chatgpt.com</span>,<br>
        or <span>netflix.com</span> to start tracking.
      </div>
    </div>`;
}

function animateBars() {
  requestAnimationFrame(() => {
    setTimeout(() => {
      document.querySelectorAll(".bar-fill[data-pct]").forEach((el) => {
        el.style.width = `${el.dataset.pct}%`;
      });
    }, 80);
  });
}

function setDevice(btn) {
  document.querySelectorAll(".dev-btn").forEach((b) => b.classList.remove("sel"));
  btn.classList.add("sel");
  chrome.storage.local.set({ deviceType: btn.dataset.device });
}

function restoreDevice() {
  chrome.storage.local.get("deviceType", ({ deviceType }) => {
    const type = deviceType || "laptop";
    document.querySelectorAll(".dev-btn").forEach((b) => {
      b.classList.toggle("sel", b.dataset.device === type);
    });
  });
}

function wireEvents() {
  document.querySelectorAll(".dev-btn").forEach((btn) => {
    btn.addEventListener("click", () => setDevice(btn));
  });

  document.getElementById("account-save").addEventListener("click", async () => {
    const input = document.getElementById("account-name");
    const nextName = input.value.trim() || DEFAULT_ACCOUNT_NAME;
    const { currentAccountId, accounts } = await getAccountStorage();
    saveAccountStorage(currentAccountId, nextName, accounts, boot);
  });

  document.getElementById("account-name").addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    const nextName = event.currentTarget.value.trim() || DEFAULT_ACCOUNT_NAME;
    const { currentAccountId, accounts } = await getAccountStorage();
    saveAccountStorage(currentAccountId, nextName, accounts, boot);
  });

  document.getElementById("reset-btn").addEventListener("click", async () => {
    const { currentAccountId, currentAccountName, accounts } = await getAccountStorage();
    accounts[currentAccountId] = buildEmptyAccountState();
    saveAccountStorage(currentAccountId, currentAccountName, accounts, boot);
  });
}

async function boot() {
  const d = await getAccountStorage();
  const account = d.accounts[d.currentAccountId] || buildEmptyAccountState();

  renderGridStrip({
    intensity: d.gridIntensity,
    zone: d.gridZone,
    source: d.gridSource,
  });

  document.getElementById("account-name").value = d.currentAccountName;
  document.getElementById("main-content").innerHTML =
    account.totalCo2 > 0 ? renderSession(account.totalCo2, account.counts, account.siteTotals) : renderEmpty();

  if (account.totalCo2 > 0) animateBars();
  restoreDevice();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (
    changes.totalCo2 ||
    changes.counts ||
    changes.siteTotals ||
    changes.gridIntensity ||
    changes.currentAccountName ||
    changes.accounts
  )) {
    boot();
  }
});

wireEvents();
boot();
