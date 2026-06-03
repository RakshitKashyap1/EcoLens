// ============================================================
//  EcoLens popup.js
// ============================================================

// Metadata used to label and color the supported sites in the popup.
const SITE_META = {
  google: { label: "Google Search", color: "#5dbf72", bg: "#0d1f0e" },
  chatgpt: { label: "ChatGPT", color: "#EF9F27", bg: "#1f180a" },
  claude: { label: "Claude", color: "#D97706", bg: "#211406" },
  gemini: { label: "Gemini", color: "#4F86F7", bg: "#0a1530" },
  perplexity: { label: "Perplexity", color: "#4FD1C5", bg: "#081c1a" },
  netflix: { label: "Netflix", color: "#E24B4A", bg: "#1f0a0a" },
  youtube: { label: "YouTube", color: "#E24B4A", bg: "#1f0a0a" },
  spotify: { label: "Spotify", color: "#1ED760", bg: "#061a0e" },
};

const {
  DEFAULT_ACCOUNT_ID,
  DEFAULT_ACCOUNT_NAME,
  GRID_SOURCES,
  DEVICE_SOURCES,
  MODEL_CONFIDENCE,
  CLOUD_SYNC_BATCH_DAYS,
  ACTIVITY_RETENTION_DAYS,
  DAILY_RETENTION_DAYS,
  getDayKey,
  normalizeAccountState,
  normalizeUsageEvent,
  normalizeBreakdownTotals,
  formatGridZoneLabel,
  getBackendConfig,
  buildSyncState,
  fmtDateTime,
} = globalThis.EcoLensShared;

const { buildSignedOutState, normalizeAuthState } = globalThis.EcoLensAuth;

// Load the current account and migrate older storage into the newer account map when needed.
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
          gridSource: stored.gridSource ?? GRID_SOURCES.DEFAULT,
        });
      }
    );
  });
}

// Persist the active account back to storage so the popup stays in sync with changes.
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

// Compact number formatting keeps the dashboard readable.
function fmt(g) {
  if (g <= 0) return "0g";
  if (g < 0.1) return `${g.toFixed(3)}g`;
  if (g < 10) return `${g.toFixed(2)}g`;
  if (g < 1000) return `${g.toFixed(1)}g`;
  return `${(g / 1000).toFixed(2)} kg`;
}

// Show methodology energy totals in the trust section.
function fmtKwh(kwh) {
  if (kwh <= 0) return "0 kWh";
  if (kwh < 0.01) return `${kwh.toFixed(4)} kWh`;
  return `${kwh.toFixed(3)} kWh`;
}

// Color today's total based on how large the footprint is.
function co2Color(g) {
  if (g < 5) return "";
  if (g < 30) return "amber";
  return "red";
}

// Convert grams into a familiar comparison phrase.
function getEquiv(g) {
  if (g <= 0) return null;
  if (g < 1) return `${(g / 0.007 * 60).toFixed(0)} sec of a LED bulb`;
  if (g < 5) return `${(g / 0.3).toFixed(1)} Google searches`;
  if (g < 20) return `boiling ${(g * 2).toFixed(0)} ml of water`;
  if (g < 100) return `driving ~${(g * 4).toFixed(0)} m by car`;
  return `${(g / 36).toFixed(1)} hrs of Netflix`;
}

// Label whether grid data came from a live source or a fallback.
function labelGridSource(source) {
  return source === GRID_SOURCES.LIVE ? "live grid" : "regional average";
}

// Normalize the measurement mode text shown in pills and event rows.
function labelMeasurementMode(mode) {
  return mode === "measured" ? "measured" : "estimated";
}

// Normalize the model-confidence text shown in pills and event rows.
function labelModelConfidence(confidence) {
  return confidence === MODEL_CONFIDENCE.DETECTED ? "model detected" : "model default";
}

// Label the device-energy source used for today's estimate.
function labelDeviceSource(source) {
  return source === DEVICE_SOURCES.BATTERY_HEURISTIC ? "battery heuristic" : "selected device";
}

// Present byte counts in a small human-readable format.
function formatBytes(bytes) {
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes > 1000) return `${(bytes / 1000).toFixed(0)} KB`;
  return "baseline estimate";
}

// Render the live grid summary strip at the top of the popup.
function renderGridStrip({ intensity, zone, source }) {
  const gPerKwh = (intensity * 1000).toFixed(0);
  const dot = document.getElementById("grid-dot");
  const val = document.getElementById("grid-val");
  const src = document.getElementById("grid-source");
  const zoneLabel = formatGridZoneLabel(zone, source);

  const dotColor = gPerKwh < 100 ? "#5dbf72"
    : gPerKwh < 300 ? "#EF9F27"
    : "#E24B4A";

  if (dot) dot.style.background = dotColor;
  if (val) val.textContent = `${gPerKwh} g/kWh - ${zoneLabel}`;
  if (src) src.textContent = labelGridSource(source);
}

// Build a rolling list of day keys for the requested chart window.
function getPastDayKeys(numDays) {
  const out = [];
  for (let i = numDays - 1; i >= 0; i -= 1) {
    out.push(getDayKey(Date.now() - (i * 24 * 60 * 60 * 1000)));
  }
  return out;
}

// Format a day key for either compact or standard chart labels.
function labelForDayKey(dayKey, compact = false) {
  const [, month, day] = dayKey.split("-");
  return compact ? day : `${month}/${day}`;
}

// Compare the most recent week with the week before it.
function buildWeeklyInsight(account) {
  const keys = getPastDayKeys(14);
  const previous = keys.slice(0, 7).reduce((sum, key) => sum + (account.dailyTotals[key]?.totalCo2 || 0), 0);
  const current = keys.slice(7).reduce((sum, key) => sum + (account.dailyTotals[key]?.totalCo2 || 0), 0);
  const diff = current - previous;
  const direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  return { current, previous, diff, direction };
}

// Identify the biggest emitting site in the account history.
function getTopEmitter(account) {
  return Object.entries(account.siteTotals || {})
    .sort((a, b) => b[1] - a[1])[0] || null;
}

// Render the two top-level insight cards for weekly change and top emitter.
// Render the two top-level insight cards for weekly change and top emitter.
function renderInsights(account) {
  const weekly = buildWeeklyInsight(account);
  const topEmitter = getTopEmitter(account);
  const topMeta = topEmitter ? SITE_META[topEmitter[0]] : null;
  const deltaText = weekly.direction === "flat"
    ? "You matched last week."
    : weekly.direction === "up"
    ? `${fmt(Math.abs(weekly.diff))} higher than the previous 7 days.`
    : `${fmt(Math.abs(weekly.diff))} lower than the previous 7 days.`;

  return `
    <div class="stack">
      <div class="insight-card">
        <div class="insight-label">7-day delta</div>
        <div class="insight-value">${fmt(weekly.current)}</div>
        <div class="insight-text">${deltaText}</div>
      </div>
      <div class="insight-card">
        <div class="insight-label">Top emitter</div>
        <div class="insight-value">${topMeta ? topMeta.label : "None yet"}</div>
        <div class="insight-text">${topEmitter ? `${fmt(topEmitter[1])} today` : "Browse or stream to start tracking."}</div>
      </div>
    </div>
  `;
}

// Render the main "today" card and the per-platform breakdown.
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
          ${key === "google" ? "G" : key === "chatgpt" ? "AI" : key === "claude" ? "C" : key === "gemini" ? "GM" : key === "perplexity" ? "PX" : key === "netflix" ? "N" : key === "youtube" ? "YT" : "SP"}
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

// Show the empty state when the user has not tracked any activity yet.
function renderEmpty() {
  return `
    <div class="empty">
      <div class="empty-icon">o</div>
      <div class="empty-msg">
        No activity yet.<br>
        Visit <span>chatgpt.com</span>, <span>claude.ai</span>,<br>
        <span>gemini.google.com</span>, <span>perplexity.ai</span>,<br>
        <span>spotify.com</span>, or <span>netflix.com</span>.
      </div>
    </div>`;
}

// Break today's totals into network, baseline, and device components.
function renderTrustBreakdown(account) {
  const today = account.dailyTotals[getDayKey()] || {};
  const breakdown = normalizeBreakdownTotals(today.breakdownTotals);

  return `
    <div class="stack">
      <div class="trust-row">
        <span>Measured network</span>
        <strong>${fmtKwh(breakdown.network)}</strong>
      </div>
      <div class="trust-row">
        <span>Baseline estimate</span>
        <strong>${fmtKwh(breakdown.baseline)}</strong>
      </div>
      <div class="trust-row">
        <span>Device energy</span>
        <strong>${fmtKwh(breakdown.device)}</strong>
      </div>
      <div class="muted-text">Totals are local estimates using transfer size, fallback baselines, device energy, and your current grid intensity.</div>
    </div>
  `;
}

// Surface the latest stored event with provenance and methodology details.
function renderLatestActivity(account) {
  const rawEvent = (account.activityLog || []).slice(-1)[0];
  if (!rawEvent) {
    return `<div class="empty-msg">No tracked activity yet.</div>`;
  }

  const event = normalizeUsageEvent(rawEvent);
  const site = SITE_META[event.siteKey] || { label: event.siteKey, color: "#7a9b7c" };
  const sep = " - ";
  const modelLine = event.modelLabel ? `<div class="muted-text">Model: ${event.modelLabel}${sep}${labelModelConfidence(event.modelConfidence)}</div>` : "";

  return `
    <div class="stack">
      <div class="minor-text"><strong style="color:${site.color}">${site.label}</strong>${sep}${fmt(event.grams)}${sep}${new Date(event.ts).toLocaleTimeString()}</div>
      <div class="pill-row">
        <span class="mini-pill">${labelMeasurementMode(event.measurementMode)}</span>
        <span class="mini-pill">${labelGridSource(event.gridSource)}</span>
        <span class="mini-pill">${labelDeviceSource(event.deviceSource)}</span>
      </div>
      <div class="muted-text">Grid zone: ${formatGridZoneLabel(event.gridZone, event.gridSource)}${sep}Data: ${formatBytes(event.networkBytesUsed)}</div>
      <div class="muted-text">Network ${fmtKwh(event.networkKwhUsed)}${sep}Baseline ${fmtKwh(event.baselineKwhUsed)}${sep}Device ${fmtKwh(event.deviceKwhUsed)}</div>
      ${modelLine}
    </div>
  `;
}

// Build a compact bar chart for the selected time window.
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

// Show the top five AI models if there is enough activity to compare them.
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

// Create a few user-facing recommendations based on recent usage patterns.
function buildSuggestions(account) {
  const suggestions = [];
  const total = account.totalCo2 || 0;
  const aiKeys = ["chatgpt", "claude", "gemini", "perplexity"];
  const streamKeys = ["youtube", "netflix", "spotify"];
  const modelTotals = account.modelTotals || {};

  const heavyModels = Object.entries(modelTotals).sort((a, b) => b[1] - a[1]);
  const topModel = heavyModels[0];
  if (topModel) {
    const [modelId, grams] = topModel;
    if (["o3", "gpt-4.1", "gpt-4o", "claude-opus", "claude-sonnet", "gemini-ultra", "gemini-pro", "gemini-2.5-pro", "perplexity-reasoning"].includes(modelId) && grams >= 2) {
      suggestions.push({
        title: "Use a lighter AI model first",
        text: `${modelId} produced ${fmt(grams)} today. Use a lighter model for drafts or quick lookups, then switch up only when quality needs it.`,
      });
    }
  }

  const aiTotal = aiKeys.reduce((sum, key) => sum + (account.siteTotals[key] || 0), 0);
  if (aiTotal >= 5) {
    suggestions.push({
      title: "Batch AI prompts",
      text: `AI assistants contributed ${fmt(aiTotal)} today. Combining follow-ups into one prompt can reduce repeated model spins.`,
    });
  }

  const streamTotal = streamKeys.reduce((sum, key) => sum + (account.siteTotals[key] || 0), 0);
  if (streamTotal >= 15) {
    suggestions.push({
      title: "Trim streaming impact",
      text: `Streaming contributed ${fmt(streamTotal)} today. Lower resolution, shorter autoplay sessions, or audio-first listening can meaningfully cut the total.`,
    });
  }

  if ((account.siteTotals.google || 0) >= 1 && aiTotal >= 1) {
    suggestions.push({
      title: "Match the tool to the task",
      text: "Quick factual lookups are usually cheaper in search, while synthesis-heavy tasks justify AI better. Picking the lighter tool first helps.",
    });
  }

  if (total >= 25) {
    suggestions.push({
      title: "Set a tighter budget",
      text: `You are at ${fmt(total)} today. Set tomorrow's budget just below that level so EcoLens can warn you earlier.`,
    });
  }

  if (!suggestions.length) {
    suggestions.push({
      title: "You're in a good range",
      text: "Today's activity is still light. Keep simpler tasks on lighter models and reserve heavier tools for work that benefits from them.",
    });
  }

  return suggestions.slice(0, 3);
}

// Render the suggestion cards into the popup DOM.
function renderSuggestions(account) {
  const suggestions = buildSuggestions(account);
  return suggestions.map((item) => `
    <div class="suggestion-card">
      <div class="suggestion-title">${item.title}</div>
      <div class="suggestion-text">${item.text}</div>
    </div>
  `).join("");
}

// Update the budget toggle, input, status text, and progress meter.
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

// Render the cloud auth and sync block based on local storage state.
function renderCloudState(authState, syncState) {
  const authStatus = document.getElementById("cloud-auth-status");
  const syncStatus = document.getElementById("sync-status");
  const syncDetail = document.getElementById("sync-detail");
  const codeRow = document.getElementById("auth-code-row");
  const emailInput = document.getElementById("auth-email");
  const startBtn = document.getElementById("auth-start-btn");
  const verifyBtn = document.getElementById("auth-verify-btn");
  const signOutBtn = document.getElementById("auth-signout-btn");
  const refreshBtn = document.getElementById("auth-refresh-btn");
  const syncBtn = document.getElementById("sync-now-btn");
  const backendConfig = getBackendConfig();
  const pendingEmail = syncState.pendingEmail || "";
  const signedIn = !!authState.signedIn;

  if (!backendConfig.configured) {
    authStatus.textContent = "Cloud sync is disabled until CONFIG.API_BASE_URL is set.";
    syncStatus.textContent = "Last cloud sync: never";
    syncDetail.textContent = "Add your backend URL and anon key in config.js, then sign in here.";
    codeRow.classList.remove("show");
    startBtn.disabled = true;
    verifyBtn.disabled = true;
    signOutBtn.disabled = true;
    refreshBtn.disabled = true;
    syncBtn.disabled = true;
    return;
  }

  if (signedIn) {
    authStatus.textContent = `Signed in as ${authState.displayName || authState.email || "EcoLens user"}.`;
  } else if (pendingEmail) {
    authStatus.textContent = `Verification code sent to ${pendingEmail}.`;
  } else {
    authStatus.textContent = "Sign in to sync daily totals and unlock social features.";
  }

  const detailMap = {
    syncing: "Syncing your last 30 days to the backend...",
    success: "Cloud sync is healthy. Friends and challenges can read your latest totals.",
    error: syncState.lastError || "The last sync failed.",
    idle: signedIn
      ? "Your data stays local first, then syncs in the background."
      : "Sign in to sync daily totals, challenges, and leaderboards.",
  };

  syncStatus.textContent = `Last cloud sync: ${fmtDateTime(syncState.lastSyncAt)}`;
  syncDetail.textContent = detailMap[syncState.status] || detailMap.idle;
  codeRow.classList.toggle("show", !signedIn && !!pendingEmail);

  if (pendingEmail && !signedIn && !emailInput.value) {
    emailInput.value = pendingEmail;
  }

  startBtn.disabled = syncState.status === "syncing";
  verifyBtn.disabled = syncState.status === "syncing" || !pendingEmail;
  signOutBtn.disabled = !signedIn;
  refreshBtn.disabled = !signedIn || syncState.status === "syncing";
  syncBtn.disabled = !signedIn || syncState.status === "syncing";
}

// Surface a compact diagnostic panel for storage, grid, and sync health.
function renderDiagnostics(account, grid, authState, syncState, accountId) {
  const backendConfig = getBackendConfig();
  const items = [
    { label: "Account", value: account.profile?.name || DEFAULT_ACCOUNT_NAME },
    { label: "Account ID", value: accountId },
    { label: "Grid source", value: labelGridSource(grid.source) },
    { label: "Grid zone", value: formatGridZoneLabel(grid.zone, grid.source) },
    { label: "Backend", value: backendConfig.configured ? "configured" : "not configured" },
    { label: "Auth", value: authState.signedIn ? "signed in" : "signed out" },
    { label: "Sync", value: syncState.status || "idle" },
    { label: "Cloud batch", value: `${CLOUD_SYNC_BATCH_DAYS} days` },
    { label: "Activity retention", value: `${ACTIVITY_RETENTION_DAYS} days` },
    { label: "Daily retention", value: `${DAILY_RETENTION_DAYS} days` },
  ];

  return `
    <div class="diag-grid">
      ${items.map((item) => `
        <div class="diag-item">
          <div class="diag-label">${item.label}</div>
          <div class="diag-value">${item.value}</div>
        </div>
      `).join("")}
    </div>
  `;
}

// Read the stored cloud auth and sync records for the popup.
async function getCloudState() {
  const stored = await chrome.storage.local.get(["cloudAuth", "cloudSync"]);
  return {
    authState: normalizeAuthState(stored.cloudAuth || buildSignedOutState()),
    syncState: buildSyncState(stored.cloudSync || {}),
  };
}

// Wrap runtime messaging in a promise so the event handlers stay linear.
function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || "Request failed"));
        return;
      }

      resolve(response);
    });
  });
}

// Trigger chart bar animations after the markup has been inserted.
function animateBars(root = document) {
  requestAnimationFrame(() => {
    setTimeout(() => {
      root.querySelectorAll(".bar-fill[data-pct]").forEach((el) => {
        el.style.width = `${el.dataset.pct}%`;
      });
    }, 80);
  });
}

// Save the selected device profile and update the UI highlight.
function setDevice(btn) {
  document.querySelectorAll(".dev-btn").forEach((b) => b.classList.remove("sel"));
  btn.classList.add("sel");
  chrome.storage.local.set({ deviceType: btn.dataset.device });
}

// Restore the selected device profile when the popup opens.
function restoreDevice() {
  chrome.storage.local.get("deviceType", ({ deviceType }) => {
    const type = deviceType || "laptop";
    document.querySelectorAll(".dev-btn").forEach((b) => {
      b.classList.toggle("sel", b.dataset.device === type);
    });
  });
}

// Wire up the popup buttons and settings controls.
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

  document.getElementById("auth-start-btn").addEventListener("click", async () => {
    const email = document.getElementById("auth-email").value.trim();
    if (!email) return;
    await sendRuntimeMessage({ type: "AUTH_START", email });
    boot();
  });

  document.getElementById("auth-verify-btn").addEventListener("click", async () => {
    const email = document.getElementById("auth-email").value.trim();
    const code = document.getElementById("auth-code").value.trim();
    if (!email || !code) return;
    await sendRuntimeMessage({ type: "AUTH_VERIFY", email, code });
    document.getElementById("auth-code").value = "";
    boot();
  });

  document.getElementById("auth-signout-btn").addEventListener("click", async () => {
    await sendRuntimeMessage({ type: "AUTH_SIGN_OUT" });
    document.getElementById("auth-code").value = "";
    boot();
  });

  document.getElementById("auth-refresh-btn").addEventListener("click", async () => {
    await sendRuntimeMessage({ type: "AUTH_REFRESH_PROFILE" });
    boot();
  });

  document.getElementById("sync-now-btn").addEventListener("click", async () => {
    await sendRuntimeMessage({ type: "SYNC_NOW", reason: "popup_manual" });
    boot();
  });
}

// Rebuild the entire popup from the latest storage snapshot.
async function boot() {
  const d = await getAccountStorage();
  const account = normalizeAccountState(d.accounts[d.currentAccountId], d.currentAccountName);
  const { authState, syncState } = await getCloudState();

  renderGridStrip({
    intensity: d.gridIntensity,
    zone: d.gridZone,
    source: d.gridSource,
  });

  document.getElementById("account-name").value = d.currentAccountName;
  document.getElementById("summary-content").innerHTML =
    account.totalCo2 > 0 ? renderSummary(account) : renderEmpty();
  document.getElementById("weekly-insights").innerHTML = renderInsights(account);
  document.getElementById("trust-breakdown").innerHTML = renderTrustBreakdown(account);
  document.getElementById("latest-activity").innerHTML = renderLatestActivity(account);
  document.getElementById("model-breakdown").innerHTML = renderModelBreakdown(account.modelTotals);
  document.getElementById("diagnostics").innerHTML = renderDiagnostics(account, {
    intensity: d.gridIntensity,
    zone: d.gridZone,
    source: d.gridSource,
  }, authState, syncState, d.currentAccountId);
  document.getElementById("suggestions").innerHTML = renderSuggestions(account);
  document.getElementById("week-chart").innerHTML = renderChart(account.dailyTotals, 7, false);
  document.getElementById("month-chart").innerHTML = renderChart(account.dailyTotals, 30, true);

  renderBudget(account);
  renderCloudState(authState, syncState);
  animateBars(document);
  restoreDevice();
}

// Re-render whenever relevant local storage records change.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (
    changes.totalCo2 ||
    changes.counts ||
    changes.siteTotals ||
    changes.modelTotals ||
    changes.gridIntensity ||
    changes.currentAccountName ||
    changes.accounts ||
    changes.cloudAuth ||
    changes.cloudSync
  )) {
    boot();
  }
});

// Prime the popup immediately after wiring the event handlers.
wireEvents();
boot();
