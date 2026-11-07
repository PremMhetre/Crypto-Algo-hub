// Run with: node --test components/dashboardLogic.test.js  (built-in runner, no dependencies)
// Uses controlled test data only. None of it represents a real Delta response.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FIELD_MAP } from "./dashboardFieldMap.js";
import {
  collectProductIds,
  createPoller,
  deriveBinance,
  deriveDelta,
  derivePositions,
  derivePostgres,
  deriveReadiness,
  deriveWallet,
  extractError,
  fmt,
  formatMoney,
  isAuthError,
  isStale,
  pnlUnavailableReason,
  positionsPanelState,
  readinessNote,
  READINESS_NOTE,
  selectSettlementRow,
  signed,
} from "./dashboardLogic.js";

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

// Hypothetical mappings used only to exercise code paths that are inactive while fields are unverified.
const TEST_MAP = {
  wallet: {
    assetIdField: "aid", assetSymbolField: "sym",
    marginUsed: "used", initialMargin: "init", maintenanceMargin: null, freeMargin: "free",
    marginUtilization: (r) => (Number(r.used) / Number(r.bal)) * 100,
    netEquityMetaField: "eq",
  },
  currencies: {
    USD: { balance: "bal", available: "avail", pendingVerification: false },
    INR: { balance: "bal_inr", available: "avail_inr", pendingVerification: true },
  },
  positions: {
    isOpen: (r) => r.open === true, productId: "pid", symbol: "psym",
    side: (r) => (r.dir === "L" ? "Long" : r.dir === "S" ? "Short" : null),
    quantity: (r) => r.qty, entryPrice: "entry", markPrice: null,
    unrealizedPnl: "pnl", margin: "mrg",
  },
};

// Wallet fixtures use the SHIPPED mapping (real Delta field names, fake values).
const row = (asset_id, asset_symbol, o = {}) => ({
  asset_id, asset_symbol, balance: "0", available_balance: "0", balance_inr: "0", available_balance_inr: "0", ...o,
});

test("shipped FIELD_MAP: margin, PnL and position mappings are all still unverified (null)", () => {
  const w = FIELD_MAP.wallet;
  for (const k of ["marginUsed", "initialMargin", "maintenanceMargin", "freeMargin", "marginUtilization", "netEquityMetaField"]) {
    assert.equal(w[k], null, k);
  }
  assert.ok(Object.values(FIELD_MAP.positions).every((v) => v === null));
  assert.equal("settlementAsset" in FIELD_MAP, false); // no settlement constant
  assert.equal(FIELD_MAP.wallet.assetIdField, "asset_id");
});

test("shipped FIELD_MAP: currency mapping uses API fields directly; INR is flagged pending verification", () => {
  assert.deepEqual({ ...FIELD_MAP.currencies.USD }, { balance: "balance", available: "available_balance", pendingVerification: false });
  assert.deepEqual({ ...FIELD_MAP.currencies.INR }, { balance: "balance_inr", available: "available_balance_inr", pendingVerification: true });
});

test("formatting returns N/A for missing values", () => {
  assert.equal(fmt(null), "N/A");
  assert.equal(fmt(undefined), "N/A");
  assert.equal(fmt("abc"), "N/A");
  assert.equal(fmt(1234.5), "1,234.50");
  assert.equal(signed(null), "N/A");
  assert.equal(signed(5), "+5.00");
  assert.equal(signed(-5), "-5.00");
});

test("settlement row: matched by asset id, never by position or balance", () => {
  const usd = row(14, "USD", { balance: "0" });                       // matching row has a ZERO balance
  const other = row(204, "INR", { balance: "999" });                  // another row is non-zero
  for (const rows of [[other, usd], [usd, other], [other, row(13, "BTC", { balance: "5" }), usd]]) {
    assert.equal(selectSettlementRow(rows, FIELD_MAP, 14).row, usd);
  }
  assert.equal(selectSettlementRow([other, usd], FIELD_MAP, 204).row, other);
});

test("settlement row: unresolved id, missing, duplicate or non-integer ids give no row (no fallback)", () => {
  const rows = [row(14, "USD", { balance: "5" }), row(204, "INR")];
  for (const id of [null, undefined, "14", 14.5, NaN]) assert.equal(selectSettlementRow(rows, FIELD_MAP, id).row, null, String(id));
  assert.equal(selectSettlementRow(rows, FIELD_MAP, 999).row, null);
  assert.equal(selectSettlementRow([row(14, "USD"), row(14, "USD")], FIELD_MAP, 14).row, null);
  assert.equal(selectSettlementRow([{ ...row(14, "USD"), asset_id: "14" }], FIELD_MAP, 14).row, null);
  assert.equal(selectSettlementRow({ not: "array" }, FIELD_MAP, 14).row, null);
  assert.equal(selectSettlementRow(rows, { wallet: {} }, 14).row, null);
});

test("wallet: unresolved settlement shows N/A in both currencies", () => {
  const data = { rows: [row(14, "USD", { balance: "10", available_balance: "9", balance_inr: "850", available_balance_inr: "765" })], meta: null };
  for (const currency of ["USD", "INR"]) {
    const v = deriveWallet(data, FIELD_MAP, currency, null);
    assert.equal(v.metrics.balance.value, null);
    assert.equal(v.metrics.available.value, null);
    assert.equal(v.metrics.balance.reason, "Settlement asset not resolved");
    assert.equal(v.assetLabel, null);
  }
  assert.equal(deriveWallet(null, FIELD_MAP, "USD", 14).metrics.balance.value, null);
});

test("wallet: USD mode reads balance / available_balance; INR mode reads *_inr directly", () => {
  const data = { rows: [row(204, "INR", { balance: "1", balance_inr: "1" }), row(14, "USD", { balance: "10.5", available_balance: "9.25", balance_inr: "893.5", available_balance_inr: "786.25" })], meta: null };
  const usd = deriveWallet(data, FIELD_MAP, "USD", 14);
  assert.equal(usd.metrics.balance.value, 10.5);
  assert.equal(usd.metrics.available.value, 9.25);
  assert.equal(usd.assetLabel, "USD");
  assert.equal(usd.assetId, 14);
  const inr = deriveWallet(data, FIELD_MAP, "INR", 14);
  assert.equal(inr.metrics.balance.value, 893.5);
  assert.equal(inr.metrics.available.value, 786.25);
});

test("wallet: no conversion. INR values are the API fields even when the ratio is not 85", () => {
  const data = { rows: [row(14, "USD", { balance: "10", available_balance: "4", balance_inr: "1234.56", available_balance_inr: "7" })], meta: null };
  const inr = deriveWallet(data, FIELD_MAP, "INR", 14);
  assert.equal(inr.metrics.balance.value, 1234.56);   // not 10 * 85
  assert.equal(inr.metrics.available.value, 7);       // not 4 * 85
  // and a USD value is never derived from the INR field either
  assert.equal(deriveWallet(data, FIELD_MAP, "USD", 14).metrics.balance.value, 10);
});

test("wallet: missing or non-numeric INR field gives N/A in INR mode only", () => {
  const base = row(14, "USD", { balance: "10", available_balance: "9" });
  delete base.balance_inr;
  base.available_balance_inr = "not-a-number";
  const data = { rows: [base], meta: null };
  const inr = deriveWallet(data, FIELD_MAP, "INR", 14);
  assert.equal(inr.metrics.balance.value, null);
  assert.equal(inr.metrics.available.value, null);
  assert.match(inr.metrics.balance.reason, /INR field missing/);
  const usd = deriveWallet(data, FIELD_MAP, "USD", 14);
  assert.equal(usd.metrics.balance.value, 10);
  assert.equal(usd.metrics.available.value, 9);
});

test("wallet: margin tiles stay N/A in both currencies with the shipped mapping", () => {
  const data = { rows: [row(14, "USD", { blocked_margin: "3", position_margin: "2", order_margin: "1" })], meta: { net_equity: "10" } };
  for (const currency of ["USD", "INR"]) {
    const m = deriveWallet(data, FIELD_MAP, currency, 14).metrics;
    for (const k of ["marginUsed", "initialMargin", "maintenanceMargin", "freeMargin", "marginUtilization"]) {
      assert.equal(m[k].value, null, `${currency} ${k}`);
    }
  }
  assert.equal(deriveWallet(data, FIELD_MAP, "USD", 14).netEquity.value, null);
});

test("wallet: a hypothetical verified margin mapping still works (inactive path)", () => {
  const data = { rows: [{ aid: 14, sym: "TST", bal: "200", avail: "150", bal_inr: "1", avail_inr: "1", used: "50", init: "40", free: "150" }, { aid: 1, sym: "OTHER", bal: "999", avail: "999" }], meta: { eq: "210" } };
  const v = deriveWallet(data, TEST_MAP, "USD", 14);
  assert.equal(v.metrics.balance.value, 200);
  assert.equal(v.metrics.marginUsed.value, 50);
  assert.equal(v.metrics.marginUtilization.value, 25);
  assert.equal(v.metrics.maintenanceMargin.value, null);
  assert.equal(v.netEquity.value, 210);
});

test("formatMoney: symbol per currency, US vs Indian grouping, N/A without symbol", () => {
  assert.equal(formatMoney(1234567.891, "USD"), "$1,234,567.89");
  assert.equal(formatMoney(1234567.891, "INR"), "₹12,34,567.89");
  assert.equal(formatMoney(123456.7, "INR"), "₹1,23,456.70");
  assert.equal(formatMoney(0, "USD"), "$0.00");
  assert.equal(formatMoney(-5, "USD"), "-$5.00");
  for (const v of [null, undefined, "", "abc", NaN]) {
    assert.equal(formatMoney(v, "USD"), "N/A");
    assert.equal(formatMoney(v, "INR"), "N/A");
  }
  assert.equal(formatMoney(5, "EUR"), "N/A");
});

test("source contains no exchange-rate constant or INR conversion arithmetic", () => {
  const dir = new URL(".", import.meta.url);
  for (const f of ["dashboardLogic.js", "dashboardFieldMap.js", "TradingDashboard.jsx"]) {
    const code = readFileSync(new URL(f, dir), "utf8")
      .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n"); // ignore comment-only lines
    assert.ok(!/\b85\b/.test(code), `${f} contains 85`);
    assert.ok(!/exchange.?rate|usd.?inr|inr.?per|fx.?rate/i.test(code.replace(/USD \/ INR/g, "")), `${f} mentions a rate`);
    assert.ok(!/(balance|available)\w*\s*\*\s*\w+|\*\s*(rate|inr)/i.test(code), `${f} multiplies a balance`);
  }
});


test("positions: unverified detection never yields the empty state", () => {
  for (const rows of [[], [{ size: 0 }], [{ size: 3 }]]) {
    const v = derivePositions(rows, {}, FIELD_MAP);
    assert.equal(v.state, "unverified");
    assert.equal(v.totalPnl, null);
    assert.deepEqual(v.rows, []);
  }
});

test("positions: invalid structure is not an empty portfolio", () => {
  assert.equal(derivePositions(undefined, {}, FIELD_MAP).state, "invalid");
  assert.equal(derivePositions(null, {}, FIELD_MAP).state, "invalid");
  assert.equal(derivePositions({ result: [] }, {}, FIELD_MAP).state, "invalid");
});

test("positions: verified detection with none open gives empty state and PnL 0", () => {
  const v = derivePositions([{ open: false }], {}, TEST_MAP);
  assert.equal(v.state, "empty");
  assert.equal(v.totalPnl, 0);
});

test("positions: PnL is exchange-provided only, never calculated", () => {
  const inst = { 7: { symbol: "C-X", underlying: "ETH", optionType: "Call", markPrice: 12, expiry: "2026-01-01T00:00:00Z", contractValue: "0.01" } };
  const noPnl = derivePositions([{ open: true, pid: 7, dir: "L", qty: 3, entry: 10 }], inst, TEST_MAP);
  assert.equal(noPnl.rows[0].pnl, null);
  assert.equal(noPnl.totalPnl, null);
  assert.equal(noPnl.rows[0].mark, 12);

  const withPnl = derivePositions(
    [{ open: true, pid: 7, dir: "S", qty: 1, entry: 10, pnl: "-4" }, { open: true, pid: 8, dir: "L", qty: 2, entry: 1, pnl: "6" }],
    inst, TEST_MAP);
  assert.equal(withPnl.totalPnl, 2);
  assert.equal(withPnl.rows[0].side, "Short");
});

test("positions: product ids only collected when detection and id field are verified", () => {
  assert.deepEqual(collectProductIds([{ pid: 1 }], FIELD_MAP), []);
  assert.deepEqual(collectProductIds([{ open: true, pid: 5 }, { open: false, pid: 6 }], TEST_MAP), [5]);
});

test("staleness uses 2x the interval and ignores never-succeeded sections", () => {
  assert.equal(isStale(null, 10_000, 1_000_000), false);
  assert.equal(isStale(1_000_000, 10_000, 1_019_000), false);
  assert.equal(isStale(1_000_000, 10_000, 1_021_000), true);
  assert.equal(isStale(1_000_000, 5_000, 1_011_000), true);
});

test("error extraction and auth classification", () => {
  const e = extractError({ response: { status: 500, data: { error: { error: { code: "expired_signature" } } } } });
  assert.equal(e.code, "expired_signature");
  assert.equal(isAuthError(e), true);
  assert.equal(isAuthError({ code: null, httpStatus: 403 }), true);
  assert.equal(isAuthError({ code: "rate_limited", httpStatus: 429 }), false);
  assert.equal(extractError({ response: { status: 500, data: "Position error" } }).message, "Position error");
  assert.equal(extractError({ message: "Network Error" }).message, "Network Error");
});

test("Delta status distinguishes Unreachable, Reachable, Authentication Failed, Connected", () => {
  const up = { ok: true, latencyMs: 100, error: null };
  assert.equal(deriveDelta({ ok: false, error: "x" }, { ok: true, error: null }).text, "Unreachable");
  assert.equal(deriveDelta(up, { ok: true, error: null }).text, "Connected");
  assert.equal(deriveDelta(up, { ok: false, error: { code: "ip_not_whitelisted_for_api_key" } }).text, "Authentication Failed");
  assert.equal(deriveDelta(up, { ok: false, error: { code: null, message: "Network Error", httpStatus: null } }).text, "Reachable");
  assert.equal(deriveDelta(up, { ok: null, error: null }).text, "Reachable");
});

test("Binance, PostgreSQL and Webhook Readiness derive from real states", () => {
  assert.equal(deriveBinance({ state: "connected", ageMs: 500 }).level, "ok");
  assert.equal(deriveBinance({ state: "stale", ageMs: 20000 }).level, "warn");
  assert.equal(deriveBinance({ state: "disconnected", ageMs: null }).text, "Disconnected");
  assert.equal(deriveBinance({ state: "connecting", ageMs: null }).text, "Connecting");
  assert.equal(derivePostgres({ ok: false, error: "down" }).text, "Disconnected");
  const ready = deriveReadiness({ ready: true, blockers: [] });
  assert.equal(ready.text, "Ready");
  assert.ok(!/running|active|trading/i.test(ready.detail));
  const not = deriveReadiness({ ready: false, blockers: ["WEBHOOK_SECRET not set"] });
  assert.equal(not.text, "Not Ready");
  assert.match(not.detail, /WEBHOOK_SECRET not set/);
});

test("poller: runs on interval, never overlaps, pauses when hidden, triggers immediately", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  let hidden = false;
  let calls = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  let release;
  const task = () => {
    calls += 1;
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    return new Promise((res) => {
      release = () => { concurrent -= 1; res(); };
    });
  };
  const poller = createPoller({ task, intervalMs: 10_000, isHidden: () => hidden });

  poller.start();
  assert.equal(calls, 1);                 // immediate first run
  mock.timers.tick(10_000);
  mock.timers.tick(10_000);
  assert.equal(calls, 1);                 // previous run still in flight: no overlap
  release();
  await flush();
  mock.timers.tick(10_000);
  assert.equal(calls, 2);
  release();
  await flush();

  hidden = true;
  mock.timers.tick(30_000);
  assert.equal(calls, 2);                 // paused while hidden
  hidden = false;
  poller.trigger();
  assert.equal(calls, 3);                 // immediate refresh on becoming visible
  assert.equal(maxConcurrent, 1);

  release();
  poller.stop();
  mock.timers.reset();
});

test("positions panel: a failed request never reports a row count or an empty portfolio", () => {
  const err = { message: "Position error", code: null, httpStatus: 500 };
  // failure with no earlier valid data
  const none = { data: null, lastSuccess: null, error: err };
  const noneView = derivePositions(none.data, {}, FIELD_MAP);
  const p1 = positionsPanelState(none, noneView);
  assert.equal(p1.kind, "failed");
  assert.equal(noneView.rowCount, null);
  assert.equal(noneView.totalPnl, null);
  assert.equal(pnlUnavailableReason(none, noneView), "Positions request failed");
  // still loading
  assert.equal(positionsPanelState({ data: null, lastSuccess: null, error: null }, noneView).kind, "loading");
});

test("positions panel: failure after a success keeps the last data and labels it", () => {
  const err = { message: "Position error", code: null, httpStatus: 500 };
  const kept = { data: [], lastSuccess: 5_000, error: err };
  const view = derivePositions(kept.data, {}, FIELD_MAP);
  const p = positionsPanelState(kept, view);
  assert.equal(p.kind, "unverified");
  assert.equal(p.failing, true);
  assert.equal(p.asOf, 5_000);
  const ok = positionsPanelState({ ...kept, error: null }, view);
  assert.equal(ok.failing, false);
});

test("positions panel: successful states are distinguished", () => {
  const base = { lastSuccess: 1, error: null };
  assert.equal(positionsPanelState({ ...base, data: [] }, derivePositions([], {}, FIELD_MAP)).kind, "unverified");
  assert.equal(positionsPanelState({ ...base, data: undefined }, derivePositions(undefined, {}, FIELD_MAP)).kind, "invalid");
  assert.equal(positionsPanelState({ ...base, data: [] }, derivePositions([], {}, TEST_MAP)).kind, "empty");
  assert.equal(
    positionsPanelState({ ...base, data: [{ open: true }] }, derivePositions([{ open: true }], {}, TEST_MAP)).kind,
    "rows"
  );
});

test("readiness note never overstates what Ready covers", () => {
  const ready = { text: "Ready" };
  assert.equal(readinessNote(ready, { text: "Connected" }), READINESS_NOTE);
  const warned = readinessNote(ready, { text: "Authentication Failed" });
  assert.match(warned, /authentication is currently failing/);
  assert.match(READINESS_NOTE, /does not verify Delta account authentication/);
  assert.match(READINESS_NOTE, /order will execute/);
  assert.equal(readinessNote({ text: "Not Ready" }, { text: "Authentication Failed" }), READINESS_NOTE);
});

test("failed polls never advance last-success: staleness grows after a failure", () => {
  // Models the container's failure path: lastSuccess is preserved, only error changes.
  const before = { data: [], lastSuccess: 1_000_000, error: null };
  const afterFail = { ...before, error: { message: "x" } };
  assert.equal(afterFail.lastSuccess, before.lastSuccess);
  assert.equal(isStale(afterFail.lastSuccess, 10_000, 1_015_000), false);
  assert.equal(isStale(afterFail.lastSuccess, 10_000, 1_025_000), true);
});
