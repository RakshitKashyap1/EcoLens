const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Load the shared browser-extension helpers into a sandboxed Node context.
function loadShared() {
  const code = fs.readFileSync(path.join(__dirname, "..", "shared.js"), "utf8");
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(code, context);
  return { shared: context.globalThis.EcoLensShared, context };
}

function loadAuth(shared) {
  const code = fs.readFileSync(path.join(__dirname, "..", "auth.js"), "utf8");
  const context = { globalThis: { EcoLensShared: shared } };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.globalThis.EcoLensAuth;
}

function loadApi(shared, auth, fetchImpl, sharedContext = null) {
  const code = fs.readFileSync(path.join(__dirname, "..", "api.js"), "utf8");
  if (sharedContext) {
    sharedContext.globalThis.CONFIG = {
      API_BASE_URL: "https://example.invalid",
      SUPABASE_ANON_KEY: "anon",
    };
  }
  const context = {
    globalThis: {
      EcoLensShared: shared,
      EcoLensAuth: auth,
    },
    fetch: fetchImpl,
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.globalThis.EcoLensApi;
}

function createChromeMock(initial = {}) {
  const store = { ...initial };
  const listeners = {
    webRequest: [],
    runtimeMessage: [],
    storageChanged: [],
    tabsRemoved: [],
    alarms: [],
    installed: [],
    startup: [],
  };

  const addListener = (bucket) => (fn) => {
    bucket.push(fn);
  };

  const chrome = {
    storage: {
      local: {
        get(keys, callback) {
          const result = {};
          const keyList = Array.isArray(keys) ? keys : [keys];
          keyList.filter(Boolean).forEach((key) => {
            result[key] = store[key];
          });
          callback(result);
        },
        set(value, callback) {
          Object.assign(store, value);
          if (callback) callback();
        },
      },
      onChanged: { addListener: addListener(listeners.storageChanged) },
    },
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        if (callback) callback();
      },
      onMessage: { addListener: addListener(listeners.runtimeMessage) },
      onInstalled: { addListener: addListener(listeners.installed) },
      onStartup: { addListener: addListener(listeners.startup) },
    },
    webRequest: {
      onBeforeRequest: { addListener: addListener(listeners.webRequest) },
      onCompleted: { addListener: addListener(listeners.webRequest) },
    },
    tabs: {
      onRemoved: { addListener: addListener(listeners.tabsRemoved) },
    },
    alarms: {
      create() {},
      onAlarm: { addListener: addListener(listeners.alarms) },
    },
    notifications: {
      create() {},
    },
  };

  return { chrome, store, listeners };
}

function loadBackground(shared, auth, fetchImpl, initialStore = {}) {
  const { chrome, store } = createChromeMock(initialStore);
  const apiCode = fs.readFileSync(path.join(__dirname, "..", "api.js"), "utf8");
  const code = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  const context = {
    globalThis: {
      EcoLensShared: shared,
      EcoLensAuth: auth,
      CONFIG: {
        ELECTRICITY_MAPS_KEY: "test-key",
        API_BASE_URL: "https://example.invalid",
        SUPABASE_ANON_KEY: "anon",
      },
    },
    chrome,
    fetch: fetchImpl,
    console,
    importScripts() {},
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(apiCode, context);
  vm.runInContext(code, context);
  return { hooks: context.globalThis.EcoLensBackgroundTestHooks, store, chrome };
}

function loadContent(shared, auth, fetchImpl, initialStore = {}, docOverrides = {}) {
  const { chrome, store } = createChromeMock(initialStore);
  const fakeDocument = {
    readyState: "complete",
    body: { appendChild() {} },
    head: { appendChild() {} },
    documentElement: {},
    getElementById() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    ...docOverrides,
  };
  const code = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const context = {
    globalThis: {
      EcoLensShared: shared,
      EcoLensAuth: auth,
    },
    chrome,
    fetch: fetchImpl,
    document: fakeDocument,
    window: {
      addEventListener() {},
    },
    location: { href: "https://example.com/" },
    navigator: {},
    MutationObserver: class { observe() {} },
    requestAnimationFrame(fn) { fn(); },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return { hooks: context.globalThis.EcoLensContentTestHooks, store, document: fakeDocument };
}

const { shared, context: sharedContext } = loadShared();
const auth = loadAuth(shared);

// Verify that raw event normalization fills in defaults and derived totals.
function testNormalizeUsageEvent() {
  const event = shared.normalizeUsageEvent({
    siteKey: "chatgpt",
    grams: 1.25,
    bytes: 4096,
    networkKwhUsed: 0.001,
    baselineKwhUsed: 0.002,
    deviceKwhUsed: 0.0002,
  });

  assert.equal(event.measurementMode, "estimated");
  assert.equal(event.networkBytesUsed, 4096);
  assert.equal(event.totalKwhUsed, 0.0032);
}

// Confirm that applying an event updates the per-day methodology breakdown.
function testApplyUsageEventBuildsBreakdownTotals() {
  const account = shared.buildEmptyAccountState(new Date("2026-05-29T00:00:00Z").getTime());
  shared.applyUsageEvent(account, {
    ts: new Date("2026-05-29T10:00:00Z").getTime(),
    siteKey: "google",
    grams: 2,
    networkKwhUsed: 0.001,
    baselineKwhUsed: 0.002,
    deviceKwhUsed: 0.0001,
    totalKwhUsed: 0.0031,
  });

  const day = account.dailyTotals["2026-05-29"];
  assert.equal(day.totalCo2, 2);
  assert.equal(day.breakdownTotals.network, 0.001);
  assert.equal(day.breakdownTotals.baseline, 0.002);
  assert.equal(day.breakdownTotals.device, 0.0001);
}

// Ensure old data is pruned while recent data stays available.
function testPruneAccountHistoryRemovesOldData() {
  const account = shared.buildEmptyAccountState(new Date("2026-05-29T00:00:00Z").getTime());
  account.activityLog.push(
    shared.normalizeUsageEvent({ ts: new Date("2026-01-01T00:00:00Z").getTime(), siteKey: "google", grams: 1 }),
    shared.normalizeUsageEvent({ ts: new Date("2026-05-28T00:00:00Z").getTime(), siteKey: "google", grams: 1 })
  );
  account.dailyTotals["2025-01-01"] = shared.buildEmptyDailySnapshot();
  account.dailyTotals["2026-05-28"] = shared.buildEmptyDailySnapshot();

  shared.pruneAccountHistory(account, new Date("2026-05-29T00:00:00Z").getTime());

  assert.equal(account.activityLog.length, 1);
  assert.ok(!account.dailyTotals["2025-01-01"]);
  assert.ok(account.dailyTotals["2026-05-28"]);
}

// Check model detection ordering and fallback behavior.
function testDetectModelFromTextPrefersLongestAliasAndFallsBack() {
  const catalog = [
    { id: "mini", label: "Mini", kWh: 1, aliases: ["4o"] },
    { id: "mini-long", label: "Mini Long", kWh: 2, aliases: ["gpt-4o mini"] },
  ];

  const detected = shared.detectModelFromText("Using GPT-4o mini right now", catalog, {
    provider: "openai",
    modelId: "default",
    label: "Default",
    kWh: 3,
  });

  const fallback = shared.detectModelFromText("No known model", catalog, {
    provider: "openai",
    modelId: "default",
    label: "Default",
    kWh: 3,
  });

  assert.equal(detected.modelId, "mini-long");
  assert.equal(detected.confidence, "detected");
  assert.equal(fallback.modelId, "default");
  assert.equal(fallback.confidence, "default");
}

// Ensure grid-zone normalization rejects HTML garbage and keeps valid zones.
function testNormalizeGridZoneAndFormatting() {
  assert.equal(shared.normalizeGridZone("<!DOCTYPE html>"), "");
  assert.equal(shared.normalizeGridZone("us"), "US");
  assert.equal(shared.formatGridZoneLabel("US", "live"), "US");
  assert.equal(shared.formatGridZoneLabel("<bad>", "default"), "regional average");
}

// Ensure malformed backend sessions fail fast instead of being stored.
function testBuildSessionPayloadRequiresToken() {
  assert.throws(
    () => auth.buildSessionPayload({ user: { id: "user-1" } }, "me@example.com"),
    /Invalid auth session/
  );
}

// Ensure backend responses are rejected when they are not valid JSON objects.
async function testApiRejectsInvalidJsonShapes() {
  const badApi = loadApi(shared, auth, async () => ({
    ok: true,
    text: async () => "<html>nope</html>",
  }), sharedContext);

  await assert.rejects(
    () => badApi.startEmailAuth("me@example.com"),
    /returned an invalid response/
  );
}

// Ensure a verify response must unwrap to a session with an access token.
async function testApiRejectsInvalidVerifySession() {
  const badApi = loadApi(shared, auth, async () => ({
    ok: true,
    text: async () => JSON.stringify({ session: { user: { id: "u-1" } } }),
  }), sharedContext);

  await assert.rejects(
    () => badApi.verifyEmailAuth("me@example.com", "123456"),
    /invalid session/
  );
}

// Verify the background worker falls back to a safe default zone when the lookup returns HTML.
async function testBackgroundFallbackGridUsesSafeZone() {
  const calls = [];
  const { hooks, store } = loadBackground(shared, auth, async (...args) => {
    calls.push(args[0]);
    return {
      ok: true,
      text: async () => "<!DOCTYPE html><html>challenge</html>",
    };
  });

  await hooks.setFallbackGridIntensity("Live grid lookup failed");

  assert.equal(store.gridSource, shared.GRID_SOURCES.FALLBACK);
  assert.equal(store.gridZone, "DEFAULT");
  assert.equal(store.gridFallbackReason, "Live grid lookup failed");
  assert.ok(calls[0].includes("ipapi.co/country"));
}

// Verify the live grid path stores a live source and clears any fallback note.
async function testBackgroundLiveGridFetchStoresLiveZone() {
  let callCount = 0;
  const { hooks, store } = loadBackground(shared, auth, async (url) => {
    callCount += 1;
    if (callCount === 1) {
      return {
        ok: true,
        json: async () => ({ country_code: "us" }),
      };
    }
    return {
      ok: true,
      json: async () => ({ carbonIntensity: 123 }),
    };
  });

  await hooks.fetchGridIntensity();

  assert.equal(store.gridSource, shared.GRID_SOURCES.LIVE);
  assert.equal(store.gridZone, "US");
  assert.equal(store.gridFallbackReason, null);
}

// Verify the content script can detect an AI model and compute a measured breakdown.
function testContentModelDetectionAndBreakdown() {
  const fakeDoc = {
    querySelectorAll() {
      return [
        {
          getAttribute(name) {
            if (name === "aria-label") return "GPT-4o mini";
            return "";
          },
          textContent: "GPT-4o mini",
        },
      ];
    },
  };
  const { hooks } = loadContent(shared, auth, async () => ({ ok: true }), {}, fakeDoc);
  const model = hooks.detectAiModel({ key: "chatgpt" });
  const breakdown = hooks.buildEnergyBreakdown({
    site: { streaming: false, base: { kWh: 0.003 }, key: "chatgpt" },
    bytes: 50000,
    elapsedHours: 0,
    aiModel: model,
    deviceInfo: { kwhPerHour: 0.02 },
    grid: { intensity: 0.5 },
  });

  assert.equal(model.modelId, "gpt-4o-mini");
  assert.equal(model.confidence, "detected");
  assert.equal(breakdown.measurementMode, "measured");
  assert.ok(breakdown.grams > 0);
}

// Run the lightweight shared-logic checks from the command line.
function run() {
  testNormalizeUsageEvent();
  testApplyUsageEventBuildsBreakdownTotals();
  testPruneAccountHistoryRemovesOldData();
  testDetectModelFromTextPrefersLongestAliasAndFallsBack();
  testNormalizeGridZoneAndFormatting();
  testBuildSessionPayloadRequiresToken();
  return Promise.resolve()
    .then(testApiRejectsInvalidJsonShapes)
    .then(testApiRejectsInvalidVerifySession)
    .then(testBackgroundFallbackGridUsesSafeZone)
    .then(testBackgroundLiveGridFetchStoresLiveZone)
    .then(testContentModelDetectionAndBreakdown)
    .then(() => {
      console.log("EcoLens tests passed");
    });
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
