// ============================================================
//  EcoLens popup.js
// ============================================================

const SITE_META = {
  google: { label: "Google Search", color: "#5dbf72", bg: "#0d1f0e" },
  chatgpt: { label: "ChatGPT", color: "#EF9F27", bg: "#1f180a" },
  claude: { label: "Claude", color: "#D97706", bg: "#211406" },
  gemini: { label: "Gemini", color: "#4F86F7", bg: "#0a1530" },
  netflix: { label: "Netflix", color: "#E24B4A", bg: "#1f0a0a" },
  youtube: { label: "YouTube", color: "#E24B4A", bg: "#1f0a0a" },
};

const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_ACCOUNT_NAME = "Personal account";

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
          gridIntensity: stored.gridIntensity ?? 0.35 / 1000,
          gridZone: stored.gridZone ?? "-",
          gridSource: stored.gridSource ?? "default",
        });
      }
    );
  });
}

function saveAccountStorage(currentAccountId, currentAccountName, accounts, callback) {
  const account = normalizeAccountState(accounts[currentAccountId], currentAccountName);
  accounts[currentAccountId] = account;

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

function renderSummary(account) {
  const totalCo2 = account.totalCo2 || 0;
  const equiv = getEquiv(totalCo2);
  const clr = co2Color(totalCo2);
  const maxCo2 = Math.max(...Object.keys(SITE_META).map((key) => account.siteTotals[key] || 0), 0.001);

  const rows = Object.entries(SITE_META).map(([key, meta]) => {
    const hits = account.counts[key] || 0;
    const grams = account.siteTotals[key] || 0;
    const pct = ((grams / maxCo2) * 100).toFixed(1);

    return `
      <div class="site-row" style="opacity:${hits > 0 || grams > 0 ? 1 : 0.28}">
        <div class="site-icon" style="background:${meta.bg};color:${meta.color}">
          ${key === "google" ? "G" : key === "chatgpt" ? "AI" : key === "claude" ? "C" : key === "gemini" ? "GM" : key === "netflix" ? "N" : "YT"}
        </div>
        <div class="row-main">
          <div class="row-head">
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
    <div class="session-card">
      <div class="sess-label">Today</div>
      <div class="sess-num ${clr}">${fmt(totalCo2)}</div>
      <div class="sess-sub">CO2 emitted today</div>
      ${equiv ? `<div class="equiv-box"><strong>That's like...</strong>~ ${equiv}</div>` : ""}
    </div>
    <div class="section">
      <div class="section-label">By platform</div>
      <div class="breakdown">${rows}</div>
    </div>`;
}

function renderEmpty() {
  return `
    <div class="empty">
      <div class="empty-icon">o</div>
      <div class="empty-msg">
        No activity yet.<br>
        Visit <span>chatgpt.com</span>, <span>claude.ai</span>,<br>
        <span>gemini.google.com</span>, or <span>netflix.com</span>.
      </div>
    </div>`;
}

function animateBars(root = document) {
  requestAnimationFrame(() => {
    setTimeout(() => {
      root.querySelectorAll(".bar-fill[data-pct]").forEach((el) => {
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

function getPastDayKeys(numDays) {
  const out = [];
  for (let i = numDays - 1; i >= 0; i -= 1) {
    out.push(getDayKey(Date.now() - (i * 24 * 60 * 60 * 1000)));
  }
  return out;
}

function labelForDayKey(dayKey, compact = false) {
  const [, month, day] = dayKey.split("-");
  return compact ? day : `${month}/${day}`;
}

function renderChart(dailyTotals, numDays, monthStyle = false) {
  const keys = getPastDayKeys(numDays);
  const data = keys.map((key) => ({
    key,
    grams: dailyTotals[key]?.totalCo2 || 0,
    label: labelForDayKey(key, numDays > 7),
  }));

  const max = Math.max(...data.map((item) => item.grams), 0.01);
  const cols = data.map((item) => {
    const height = item.grams > 0 ? Math.max((item.grams / max) * 100, 6) : 2;
    return `
      <div class="chart-col">
        <div class="chart-val">${item.grams > 0 ? fmt(item.grams) : "0g"}</div>
        <div class="chart-bar-wrap">
          <div class="chart-bar${monthStyle ? " month" : ""}" style="height:${height}%"></div>
        </div>
        <div class="chart-lbl">${item.label}</div>
      </div>`;
  }).join("");

  return `<div class="chart">${cols}</div>`;
}

function renderModelBreakdown(modelTotals) {
  const entries = Object.entries(modelTotals || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (!entries.length) {
    return `<div class="empty-msg">No model-specific AI activity yet.</div>`;
  }

  const max = Math.max(...entries.map(([, grams]) => grams), 0.001);
  const total = entries.reduce((sum, [, grams]) => sum + grams, 0);

  return `
    <div class="breakdown">
      ${entries.map(([model, grams]) => {
        const pct = ((grams / max) * 100).toFixed(1);
        const share = total > 0 ? `${Math.round((grams / total) * 100)}%` : "0%";
        return `
          <div class="model-row">
            <div class="row-main">
              <div class="row-head">
                <span class="model-name">${model}</span>
                <span class="model-share">${share}</span>
                <span class="model-g">${fmt(grams)}</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill" data-pct="${pct}" style="background:#EF9F27"></div>
              </div>
            </div>
          </div>`;
      }).join("")}
    </div>`;
}

function buildSuggestions(account) {
  const suggestions = [];
  const total = account.totalCo2 || 0;
  const chatgptTotal = account.siteTotals.chatgpt || 0;
  const claudeTotal = account.siteTotals.claude || 0;
  const geminiTotal = account.siteTotals.gemini || 0;
  const googleTotal = account.siteTotals.google || 0;
  const youtubeTotal = account.siteTotals.youtube || 0;
  const netflixTotal = account.siteTotals.netflix || 0;
  const modelTotals = account.modelTotals || {};

  const heavyModels = Object.entries(modelTotals)
    .sort((a, b) => b[1] - a[1]);

  const topModel = heavyModels[0];
  if (topModel) {
    const [modelId, grams] = topModel;
    if (["o3", "gpt-4.1", "gpt-4o", "claude-opus", "claude-sonnet", "gemini-ultra", "gemini-pro", "gemini-2.5-pro"].includes(modelId) && grams >= 2) {
      const lighter =
        modelId === "o3" ? "o4-mini" :
        modelId === "gpt-4.1" ? "gpt-4.1 mini" :
        modelId === "gpt-4o" ? "gpt-4o mini" :
        modelId === "claude-opus" ? "Claude Haiku" :
        modelId === "claude-sonnet" ? "Claude Haiku" :
        "Gemini Flash";
      suggestions.push({
        title: "Use a lighter AI model first",
        text: `${modelId} produced ${fmt(grams)} today. For drafting, summaries, and search-style prompts, try ${lighter} first and only switch up when the answer quality really needs it.`,
      });
    }
  }

  if (chatgptTotal >= 5 && (account.counts.chatgpt || 0) >= 5) {
    suggestions.push({
      title: "Batch AI prompts",
      text: `ChatGPT accounted for ${fmt(chatgptTotal)} today across ${account.counts.chatgpt} prompts. Combining follow-up questions into one prompt can reduce repeated model spins and lower the total.`,
    });
  }

  if (claudeTotal >= 3 && (account.counts.claude || 0) >= 3) {
    suggestions.push({
      title: "Use Claude Haiku for lighter tasks",
      text: `Claude contributed ${fmt(claudeTotal)} today. For simpler drafting or classification work, Claude Haiku is usually a better first step than jumping straight to Sonnet or Opus.`,
    });
  }

  if (geminiTotal >= 3 && (account.counts.gemini || 0) >= 3) {
    suggestions.push({
      title: "Try Gemini Flash first",
      text: `Gemini contributed ${fmt(geminiTotal)} today. Flash-style models are often enough for quick brainstorming and can keep your AI footprint lower than heavier Gemini variants.`,
    });
  }

  if ((youtubeTotal + netflixTotal) >= 15) {
    const streamTotal = youtubeTotal + netflixTotal;
    suggestions.push({
      title: "Trim streaming impact",
      text: `Streaming contributed ${fmt(streamTotal)} today. Lower resolution, shorter autoplay sessions, or switching long background videos to audio can meaningfully cut digital carbon use.`,
    });
  }

  if (googleTotal >= 1 && (chatgptTotal + claudeTotal + geminiTotal) >= 1) {
    suggestions.push({
      title: "Match the tool to the task",
      text: `You used both search and AI today. Quick factual lookups are usually cheaper in search, while synthesis-heavy tasks justify AI better. Picking the lighter tool first can keep totals down.`,
    });
  }

  if (total >= 25) {
    suggestions.push({
      title: "Set a tighter budget",
      text: `You are at ${fmt(total)} today. If that feels high, try setting tomorrow's budget just below that level so EcoLens can nudge you before the heaviest usage happens.`,
    });
  }

  if (!suggestions.length) {
    suggestions.push({
      title: "You're in a good range",
      text: "Today's activity is still light. Keep using lighter models for simple prompts and reserve heavier tools for work that actually benefits from them.",
    });
  }

  return suggestions.slice(0, 3);
}

function renderSuggestions(account) {
  const suggestions = buildSuggestions(account);
  return suggestions.map((item) => `
    <div class="suggestion-card">
      <div class="suggestion-title">${item.title}</div>
      <div class="suggestion-text">${item.text}</div>
    </div>
  `).join("");
}

function renderBudget(account) {
  const budget = account.budget;
  const limit = Number(budget.dailyGrams) || 50;
  const used = account.totalCo2 || 0;
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const tone = pct >= 100 ? "#E24B4A" : pct >= 80 ? "#EF9F27" : "#5dbf72";

  document.getElementById("budget-enabled").checked = !!budget.enabled;
  document.getElementById("budget-grams").value = String(limit);
  document.getElementById("budget-status").textContent =
    budget.enabled
      ? `${fmt(used)} used of ${limit}g today (${pct.toFixed(0)}%)`
      : "Budget alerts are currently disabled.";

  document.getElementById("budget-meter").innerHTML = `
    <div class="bar-track">
      <div class="bar-fill" data-pct="${pct.toFixed(1)}" style="background:${tone}"></div>
    </div>`;
}

function wireEvents() {
  document.querySelectorAll(".dev-btn").forEach((btn) => {
    btn.addEventListener("click", () => setDevice(btn));
  });

  document.getElementById("account-save").addEventListener("click", async () => {
    const input = document.getElementById("account-name");
    const nextName = input.value.trim() || DEFAULT_ACCOUNT_NAME;
    const { currentAccountId, accounts } = await getAccountStorage();
    const account = normalizeAccountState(accounts[currentAccountId], nextName);
    account.profile.name = nextName;
    accounts[currentAccountId] = account;
    saveAccountStorage(currentAccountId, nextName, accounts, boot);
  });

  document.getElementById("budget-save").addEventListener("click", async () => {
    const enabled = document.getElementById("budget-enabled").checked;
    const grams = Math.max(1, Number(document.getElementById("budget-grams").value) || 50);
    const { currentAccountId, currentAccountName, accounts } = await getAccountStorage();
    const account = normalizeAccountState(accounts[currentAccountId], currentAccountName);
    account.budget.enabled = enabled;
    account.budget.dailyGrams = grams;
    if (!enabled) {
      account.budget.alert80Date = null;
      account.budget.alert100Date = null;
    }
    accounts[currentAccountId] = account;
    saveAccountStorage(currentAccountId, currentAccountName, accounts, boot);
  });

  document.getElementById("reset-btn").addEventListener("click", async () => {
    const { currentAccountId, currentAccountName, accounts } = await getAccountStorage();
    const account = normalizeAccountState(accounts[currentAccountId], currentAccountName);
    delete account.dailyTotals[getDayKey()];
    account.totalCo2 = 0;
    account.counts = {};
    account.siteTotals = {};
    account.modelTotals = {};
    account.lastSite = null;
    account.lastTs = null;
    account.lastResetTs = Date.now();
    account.budget.alert80Date = null;
    account.budget.alert100Date = null;
    accounts[currentAccountId] = account;
    saveAccountStorage(currentAccountId, currentAccountName, accounts, boot);
  });
}

async function boot() {
  const d = await getAccountStorage();
  const account = normalizeAccountState(d.accounts[d.currentAccountId], d.currentAccountName);

  renderGridStrip({
    intensity: d.gridIntensity,
    zone: d.gridZone,
    source: d.gridSource,
  });

  document.getElementById("account-name").value = d.currentAccountName;
  document.getElementById("summary-content").innerHTML =
    account.totalCo2 > 0 ? renderSummary(account) : renderEmpty();
  document.getElementById("model-breakdown").innerHTML = renderModelBreakdown(account.modelTotals);
  document.getElementById("suggestions").innerHTML = renderSuggestions(account);
  document.getElementById("week-chart").innerHTML = renderChart(account.dailyTotals, 7, false);
  document.getElementById("month-chart").innerHTML = renderChart(account.dailyTotals, 30, true);

  renderBudget(account);
  animateBars(document);
  restoreDevice();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (
    changes.totalCo2 ||
    changes.counts ||
    changes.siteTotals ||
    changes.modelTotals ||
    changes.gridIntensity ||
    changes.currentAccountName ||
    changes.accounts
  )) {
    boot();
  }
});

wireEvents();
boot();
