// Run with: node --test components/dashboardRender.test.js  (built-in runner; uses the project's own vite + react-dom)
// Renders DashboardView server-side with controlled test data. None of it is a real Delta response.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { renderToString } from "react-dom/server";

const require = createRequire(import.meta.url);
const React = require("react");

let vite, DashboardView, FIELD_MAP;
before(async () => {
  vite = await createServer({
    configFile: fileURLToPath(new URL("../vite.config.js", import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    logLevel: "error",
    ssr: { noExternal: [/@mui/] },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ DashboardView } = await vite.ssrLoadModule("/components/TradingDashboard.jsx"));
  ({ FIELD_MAP } = await vite.ssrLoadModule("/components/dashboardFieldMap.js"));
});
after(async () => { await vite.close(); });

const NOW = 1_800_000_000_000;
const empty = { data: null, lastSuccess: null, error: null, loading: true };
const ok = (data, ageMs = 1000) => ({ data, lastSuccess: NOW - ageMs, error: null, loading: false });
// Visible text: emotion injects <style> blocks between nodes, so drop them first.
const plain = (html) =>
  html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const walletRow = (asset_id, asset_symbol, o = {}) => ({
  asset_id, asset_symbol, balance: "0", available_balance: "0", balance_inr: "0", available_balance_inr: "0", ...o,
});
// Fake values. The INR figures are deliberately NOT 85x the USD figures, so any hidden conversion would show.
const WALLET = ok({
  rows: [
    walletRow(204, "INR", { balance: "777", balance_inr: "777" }),
    walletRow(14, "USD", { balance: "123.45", available_balance: "100.00", balance_inr: "123456.78", available_balance_inr: "9999.5" }),
  ],
  meta: { net_equity: "123.45" },
});
const SETTLE = ok({ underlying: "ETH", assetId: 14, symbol: "USD", productCount: 2, consistent: true, reason: null });
const STATUS = ok({
  binance: { state: "connected", lastTickAt: NOW - 500, ageMs: 500 },
  delta: { ok: true, latencyMs: 100, error: null },
  postgres: { ok: true, latencyMs: 5, error: null },
  engine: { ready: true, blockers: [] },
  checkedAt: NOW,
});
// Built lazily: DashboardView and FIELD_MAP are loaded in before().
const base = () => ({ wallet: empty, positions: empty, instrumentsError: null, instrumentMap: {}, status: empty, settlement: empty, currency: "USD", onCurrencyChange: () => {}, now: NOW, map: FIELD_MAP });
const render = (p) => renderToString(React.createElement(DashboardView, { ...base(), ...p }));
const full = (p = {}) => render({ wallet: WALLET, settlement: SETTLE, status: STATUS, positions: ok([]), ...p });

const moneyUsd = /\$\d[\d,]*\.\d\d/g;
const moneyInr = /₹\d[\d,]*\.\d\d/g;

test("default is USD: USD values shown, no INR value, no unverified-INR marker", () => {
  const t = plain(full());
  assert.match(t, /Total Wallet Balance \(USD\) \$123\.45/);
  assert.match(t, /Available Balance \(USD\) \$100\.00/);
  assert.equal((t.match(moneyInr) || []).length, 0);
  assert.ok(!t.includes("INR fields unverified"));
});

test("INR mode: INR fields shown directly with Indian grouping, no USD value, unverified marker visible", () => {
  const t = plain(full({ currency: "INR" }));
  assert.match(t, /Total Wallet Balance \(INR\) ₹1,23,456\.78/);   // field value, not 123.45 x 85
  assert.match(t, /Available Balance \(INR\) ₹9,999\.50/);
  assert.equal((t.match(moneyUsd) || []).length, 0);
  assert.ok(t.includes("INR fields unverified"));
});

test("only one currency's values are visible at a time, in both modes", () => {
  for (const currency of ["USD", "INR"]) {
    const t = plain(full({ currency }));
    const usd = (t.match(moneyUsd) || []).length, inr = (t.match(moneyInr) || []).length;
    assert.ok((usd > 0) !== (inr > 0), `${currency}: usd=${usd} inr=${inr}`);
  }
});

test("toggle exists once, inside Account Overview, with USD selected by default", () => {
  const html = full();
  assert.equal((html.match(/aria-label="Display currency"/g) || []).length, 1);
  const a = html.indexOf("Account Overview"), toggle = html.indexOf('aria-label="Display currency"'), m = html.indexOf("Margin Overview");
  assert.ok(a < toggle && toggle < m);
  const buttons = (h) => [...h.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
  const pressed = (h, v) => (buttons(h).find((b) => b.includes(`value="${v}"`)) || "").match(/aria-pressed="(true|false)"/)?.[1];
  assert.equal(pressed(html, "USD"), "true");
  assert.equal(pressed(html, "INR"), "false");
  assert.match(plain(full({ currency: "INR" })), /Total Wallet Balance \(INR\)/);
  assert.equal(pressed(full({ currency: "INR" }), "INR"), "true");
});

test("unresolved settlement: wallet values N/A in both currencies, with a visible reason", () => {
  for (const currency of ["USD", "INR"]) {
    for (const settlement of [{ data: null, lastSuccess: null, error: { message: "Network Error" }, loading: false },
      ok({ assetId: null, reason: "ETH options have different settling assets" })]) {
      const t = plain(full({ currency, settlement }));
      assert.equal((t.match(moneyUsd) || []).length + (t.match(moneyInr) || []).length, 0);
      assert.match(t, /Total Wallet Balance \((USD|INR)\) N\/A/);
    }
  }
  assert.match(plain(full({ settlement: ok({ assetId: null, reason: "ETH options have different settling assets" }) })), /Settlement asset unresolved \(ETH options have different settling assets\)/);
});

test("settlement row is matched by id: reordered rows and zero-balance match behave the same", () => {
  const rows = [walletRow(14, "USD", { balance: "0", balance_inr: "0" }), walletRow(204, "INR", { balance: "555", balance_inr: "555" })];
  const t = plain(full({ wallet: ok({ rows, meta: null }) }));
  assert.match(t, /Total Wallet Balance \(USD\) \$0\.00/);
  assert.ok(!t.includes("555"));
  const missing = plain(full({ wallet: ok({ rows: [walletRow(204, "INR", { balance: "555" })], meta: null }) }));
  assert.match(missing, /Total Wallet Balance \(USD\) N\/A/);
});

test("missing INR field: N/A in INR mode only", () => {
  const r = walletRow(14, "USD", { balance: "10", available_balance: "9" });
  delete r.balance_inr;
  const wallet = ok({ rows: [r], meta: null });
  assert.match(plain(full({ wallet, currency: "INR" })), /Total Wallet Balance \(INR\) N\/A/);
  assert.match(plain(full({ wallet, currency: "USD" })), /Total Wallet Balance \(USD\) \$10\.00/);
});

test("margin and PnL stay N/A in both currencies; nothing else changes with the toggle", () => {
  const usd = plain(full({ currency: "USD" })), inr = plain(full({ currency: "INR" }));
  for (const t of [usd, inr]) {
    for (const label of ["Margin Used", "Unrealized PnL", "Initial Margin", "Maintenance Margin", "Free Margin", "Margin Utilization"]) {
      assert.match(t, new RegExp(`${label} N/A`), label);
    }
  }
  const section = (t, name) => t.slice(t.indexOf(name));
  assert.equal(section(usd, "Margin Overview"), section(inr, "Margin Overview"));  // margin, positions and status unchanged
});

test("settlement caption, stale and error handling still work in INR mode", () => {
  const stale = plain(full({ currency: "INR", wallet: ok(WALLET.data, 30_000) }));
  assert.match(stale, /Stale/);
  assert.match(stale, /Settlement asset USD \(id 14\)/);
  const err = plain(full({ currency: "INR", wallet: { ...WALLET, error: { message: "expired_signature", httpStatus: 500 } } }));
  assert.match(err, /Wallet: expired_signature \(HTTP 500\) — showing last known data/);
  assert.match(err, /Total Wallet Balance \(INR\) ₹1,23,456\.78/); // last values preserved
  const none = plain(full({ currency: "INR", wallet: { data: null, lastSuccess: null, error: { message: "expired_signature", httpStatus: 500 }, loading: false } }));
  assert.match(none, /Total Wallet Balance \(INR\) N\/A/);
});

test("position detection and system status are unchanged by the feature", () => {
  const t = plain(full({ positions: ok([]) }));
  assert.match(t, /Open-position detection is not verified/);
  assert.match(t, /The exchange returned 0 row\(s\)/);
  assert.ok(!t.includes("No open positions"));
  assert.match(t, /Webhook Readiness Ready Prerequisites met/);
  assert.match(t, /Delta Exchange API Connected/);
});

// ---- Regression: settlement resolving slower than the wallet response ----
const accountSection = (html) => {
  const p = plain(html);
  return p.slice(p.indexOf("Account Overview"), p.indexOf("Margin Overview"));
};
const accountHtml = (html) => html.slice(html.indexOf("Account Overview"), html.indexOf("Margin Overview"));

test("settlement slower than wallet: Account tiles stay in the loading state, no N/A, no warning", () => {
  for (const currency of ["USD", "INR"]) {
    const html = full({ currency, settlement: empty }); // wallet has data, settlement still pending
    const sec = accountSection(html);
    // Settlement-dependent tiles must not show N/A. (Unrealized PnL comes from positions and is always N/A for now.)
    assert.ok(!/(Total Wallet Balance \(\w+\)|Available Balance \(\w+\)|Margin Used) N\/A/.test(sec), `${currency}: N/A shown while settlement pending: ${sec.slice(0, 200)}`);
    assert.ok(!/Settlement asset unresolved/.test(sec), "warning must not appear while pending");
    assert.equal((sec.match(moneyUsd) || []).length + (sec.match(moneyInr) || []).length, 0);
    assert.ok(/MuiSkeleton/.test(accountHtml(html)), `${currency}: skeleton expected`);
  }
});

test("settlement resolving later: skeleton, then the real value", () => {
  const pending = accountSection(full({ settlement: empty }));
  const done = accountSection(full({ settlement: SETTLE }));
  assert.ok(!/\$123\.45/.test(pending));
  assert.match(done, /Total Wallet Balance \(USD\) \$123\.45/);
  assert.ok(!/MuiSkeleton/.test(accountHtml(full({ settlement: SETTLE }))));
});

test("settlement resolution fails or is inconsistent: N/A plus the reason (after pending)", () => {
  const failed = accountSection(full({ settlement: { data: null, lastSuccess: null, error: { message: "boom" }, loading: false } }));
  assert.match(failed, /Total Wallet Balance \(USD\) N\/A/);
  assert.match(failed, /Settlement asset unresolved \(boom\)/);
  const mixed = accountSection(full({ settlement: ok({ assetId: null, reason: "ETH options have different settling assets" }) }));
  assert.match(mixed, /Total Wallet Balance \(USD\) N\/A/);
  assert.match(mixed, /different settling assets/);
});

test("wallet error with no data while settlement is pending: N/A with the wallet error (not an endless skeleton)", () => {
  const w = { data: null, lastSuccess: null, error: { message: "expired_signature", httpStatus: 500 }, loading: false };
  const html = full({ wallet: w, settlement: empty });
  const sec = accountSection(html);
  assert.match(sec, /Wallet: expired_signature \(HTTP 500\)/);
  assert.match(sec, /Total Wallet Balance \(USD\) N\/A/);
  assert.ok(!/MuiSkeleton/.test(accountHtml(html)));
});

test("wallet still loading: skeleton regardless of settlement", () => {
  for (const settlement of [empty, SETTLE]) {
    const html = full({ wallet: empty, settlement });
    assert.ok(/MuiSkeleton/.test(accountHtml(html)));
    assert.ok(!/Total Wallet Balance \(USD\) N\/A/.test(accountSection(html)));
  }
});

test("later settlement refresh failure or stale wallet keeps the last values (existing behaviour preserved)", () => {
  const kept = accountSection(full({ settlement: { ...SETTLE, error: { message: "x" } } }));
  assert.match(kept, /Total Wallet Balance \(USD\) \$123\.45/);
  const stale = accountSection(full({ wallet: ok(WALLET.data, 30_000), settlement: SETTLE }));
  assert.match(stale, /Stale/);
  assert.match(stale, /Total Wallet Balance \(USD\) \$123\.45/);
  const err = accountSection(full({ wallet: { ...WALLET, error: { message: "expired_signature", httpStatus: 500 } }, settlement: SETTLE }));
  assert.match(err, /showing last known data/);
  assert.match(err, /\$123\.45/);
});
