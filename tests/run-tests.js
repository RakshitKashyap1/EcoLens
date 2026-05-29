const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadShared() {
  const code = fs.readFileSync(path.join(__dirname, "..", "shared.js"), "utf8");
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.globalThis.EcoLensShared;
}

const shared = loadShared();

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

function run() {
  testNormalizeUsageEvent();
  testApplyUsageEventBuildsBreakdownTotals();
  testPruneAccountHistoryRemovesOldData();
  testDetectModelFromTextPrefersLongestAliasAndFallsBack();
  console.log("EcoLens tests passed");
}

run();
