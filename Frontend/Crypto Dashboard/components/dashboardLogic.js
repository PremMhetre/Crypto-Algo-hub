// Pure logic for TradingDashboard: formatting, response interpretation, status
// derivation and polling. No React, no network calls.

export const ACCOUNT_REFRESH_MS = 10_000;
export const STATUS_REFRESH_MS = 5_000;
export const SETTLEMENT_REFRESH_MS = 300_000; // product-cache cadence
export const STALE_FACTOR = 2;

// Delta error codes that mean the account request was rejected (DASHBOARD_SPEC.md §4.4).
export const AUTH_ERROR_CODES = [
  "expired_signature",
  "ip_not_whitelisted_for_api_key",
  "invalid_api_key",
];

export const UNVERIFIED = "Exchange field and meaning not verified";

/* ---------------- formatting ---------------- */

export const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const fmt = (v, decimals = 2) =>
  num(v) === null
    ? "N/A"
    : num(v).toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });

// Display formats for the currency toggle. Display only: nothing is converted between currencies.
export const CURRENCY_FORMAT = Object.freeze({
  USD: { symbol: "$", locale: "en-US" },
  INR: { symbol: "₹", locale: "en-IN" }, // Indian digit grouping
});

export function formatMoney(value, currency) {
  const n = num(value);
  const f = CURRENCY_FORMAT[currency];
  if (n === null || !f) return "N/A";
  const body = Math.abs(n).toLocaleString(f.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}${f.symbol}${body}`;
}

export const signed = (v) => (num(v) === null ? "N/A" : `${v > 0 ? "+" : ""}${fmt(v)}`);

export const signColor = (v) =>
  num(v) === null || num(v) === 0 ? "text.primary" : num(v) > 0 ? "success.main" : "error.main";

/* ---------------- errors ---------------- */

// Normalises an axios error into { message, code, httpStatus }.
export function extractError(err) {
  const data = err?.response?.data;
  const code = data?.error?.error?.code ?? data?.error?.code ?? null;
  const message =
    code ||
    (typeof data?.error === "string" ? data.error : null) ||
    (typeof data === "string" && data ? data : null) ||
    err?.message ||
    "Request failed";
  return { message, code, httpStatus: err?.response?.status ?? null };
}

export function isAuthError(error) {
  if (!error) return false;
  return (
    AUTH_ERROR_CODES.includes(error.code) ||
    error.httpStatus === 401 ||
    error.httpStatus === 403
  );
}

/* ---------------- staleness ---------------- */

// A section is stale when it has succeeded before but not within STALE_FACTOR x its interval.
export function isStale(lastSuccessAt, intervalMs, now) {
  if (lastSuccessAt === null || lastSuccessAt === undefined) return false;
  return now - lastSuccessAt > STALE_FACTOR * intervalMs;
}

/* ---------------- wallet ---------------- */

const metric = (value, reason) => ({ value, reason: value === null ? reason : null });

function readField(row, field) {
  return field ? num(row?.[field]) : null;
}

// Picks the one wallet row whose asset id equals the product settlement asset id.
// Never by array position, symbol, or balance. No fallback of any kind.
export function selectSettlementRow(rows, map, settlementId) {
  if (!Array.isArray(rows)) return { row: null, reason: "Unexpected wallet response structure" };
  if (!Number.isInteger(settlementId)) return { row: null, reason: "Settlement asset not resolved" };
  const field = map.wallet.assetIdField;
  if (!field) return { row: null, reason: "Wallet asset id field not mapped" };
  const matches = rows.filter((r) => Number.isInteger(r?.[field]) && r[field] === settlementId);
  if (matches.length !== 1) {
    return { row: null, reason: `Settlement asset id ${settlementId} not found exactly once in wallet` };
  }
  return { row: matches[0], reason: null };
}

// currency: "USD" | "INR". Values are read straight from the mapped API field; nothing is converted.
export function deriveWallet(data, map, currency = "USD", settlementId = null) {
  const keys = [
    "balance",
    "available",
    "marginUsed",
    "initialMargin",
    "maintenanceMargin",
    "freeMargin",
    "marginUtilization",
  ];
  const empty = (reason) => ({
    assetLabel: null,
    assetId: null,
    netEquity: metric(null, reason),
    metrics: Object.fromEntries(keys.map((k) => [k, metric(null, reason)])),
  });

  if (!data) return empty("Wallet data unavailable");

  const { row, reason } = selectSettlementRow(data.rows, map, settlementId);
  if (!row) return empty(reason);

  const w = map.wallet;
  const field = (name) =>
    metric(readField(row, w[name]), w[name] ? "Field missing in response" : UNVERIFIED);

  // Currency-dependent fields (undocumented *_inr fields are flagged in the field map).
  const cur = map.currencies?.[currency];
  const money = (name) =>
    metric(
      cur?.[name] ? readField(row, cur[name]) : null,
      cur?.[name] ? `${currency} field missing in response` : "Currency field not mapped"
    );

  const utilization =
    typeof w.marginUtilization === "function"
      ? metric(num(w.marginUtilization(row)), "Field missing in response")
      : metric(null, "Formula not confirmed");

  return {
    assetLabel: typeof row[w.assetSymbolField] === "string" ? row[w.assetSymbolField] : null,
    assetId: settlementId,
    netEquity: metric(
      w.netEquityMetaField ? num(data.meta?.[w.netEquityMetaField]) : null,
      UNVERIFIED
    ),
    metrics: {
      balance: money("balance"),
      available: money("available"),
      marginUsed: field("marginUsed"),
      initialMargin: field("initialMargin"),
      maintenanceMargin: field("maintenanceMargin"),
      freeMargin: field("freeMargin"),
      marginUtilization: utilization,
    },
  };
}

/* ---------------- positions ---------------- */

// Product ids of open positions (empty unless detection and product id are both verified).
export function collectProductIds(rawRows, map) {
  const p = map.positions;
  if (!Array.isArray(rawRows) || typeof p.isOpen !== "function" || !p.productId) return [];
  return rawRows
    .filter((r) => p.isOpen(r))
    .map((r) => r?.[p.productId])
    .filter((id) => Number.isInteger(Number(id)))
    .map(Number);
}

function buildPosition(row, instruments, map) {
  const p = map.positions;
  const id = p.productId ? Number(row?.[p.productId]) : null;
  const inst = id !== null && instruments ? instruments[id] : null;
  const call = (fn) => (typeof fn === "function" ? fn(row) : null);

  const exchangeMark = readField(row, p.markPrice);
  const side = call(p.side);

  return {
    key: id ?? (p.symbol ? row?.[p.symbol] : null),
    name: (p.symbol ? row?.[p.symbol] : null) ?? inst?.symbol ?? null,
    underlying: inst?.underlying ?? null,
    optionType: inst?.optionType ?? null,
    side: side === "Long" || side === "Short" ? side : null,
    qty: num(call(p.quantity)),
    entry: readField(row, p.entryPrice),
    mark: exchangeMark ?? num(inst?.markPrice),
    pnl: readField(row, p.unrealizedPnl), // exchange-provided only, never calculated
    expiry: inst?.expiry ?? null,
    margin: readField(row, p.margin),
  };
}

// state: "invalid" | "unverified" | "empty" | "rows"
export function derivePositions(rawRows, instruments, map) {
  if (!Array.isArray(rawRows)) {
    return { state: "invalid", rowCount: null, rows: [], totalPnl: null };
  }
  if (typeof map.positions.isOpen !== "function") {
    // Open-position detection unverified: never claim "no open positions".
    return { state: "unverified", rowCount: rawRows.length, rows: [], totalPnl: null };
  }
  const open = rawRows.filter((r) => map.positions.isOpen(r));
  if (open.length === 0) {
    return { state: "empty", rowCount: rawRows.length, rows: [], totalPnl: 0 };
  }
  const rows = open.map((r) => buildPosition(r, instruments, map));
  const pnls = rows.map((r) => r.pnl);
  return {
    state: "rows",
    rowCount: rawRows.length,
    rows,
    totalPnl: pnls.some((v) => v === null) ? null : pnls.reduce((a, b) => a + b, 0),
  };
}

// What the positions panel may claim. "failed" = the request failed and there is no earlier
// successful data, so nothing (not even a row count) may be reported. When `failing` is true
// and earlier data exists, every statement is about that earlier response (`asOf`).
// kind: loading | failed | invalid | unverified | empty | rows
export function positionsPanelState(positions, view) {
  const hasData = positions.lastSuccess !== null && positions.lastSuccess !== undefined;
  const failing = !!positions.error;
  if (!hasData) return { kind: failing ? "failed" : "loading", failing, asOf: null };
  return { kind: view.state, failing, asOf: positions.lastSuccess };
}

export function pnlUnavailableReason(positions, view) {
  if (positions.lastSuccess === null || positions.lastSuccess === undefined) {
    return positions.error ? "Positions request failed" : "Positions not loaded";
  }
  if (view.state === "unverified") return "Open-position detection not verified";
  if (view.state === "invalid") return "Unexpected positions response structure";
  return "Exchange-provided PnL not available";
}

/* ---------------- system status ---------------- */

// level: ok | warn | bad | unknown
export function deriveBinance(b) {
  if (b.state === "connected") {
    return { level: "ok", text: "Connected", detail: ageDetail(b.ageMs) };
  }
  if (b.state === "stale") {
    return { level: "warn", text: "Connected, no recent ticks", detail: ageDetail(b.ageMs) };
  }
  if (b.state === "connecting") {
    return { level: "unknown", text: "Connecting", detail: ageDetail(b.ageMs) };
  }
  return { level: "bad", text: "Disconnected", detail: ageDetail(b.ageMs) };
}

const ageDetail = (ageMs) =>
  ageMs === null || ageMs === undefined
    ? "No ticks received"
    : `Last tick ${(ageMs / 1000).toFixed(1)}s ago`;

// Combines the backend's public reachability check with the outcome of the /wallet call.
export function deriveDelta(delta, walletOutcome) {
  if (!delta.ok) return { level: "bad", text: "Unreachable", detail: delta.error };
  if (walletOutcome.ok) {
    return { level: "ok", text: "Connected", detail: `Account request OK · ${delta.latencyMs} ms` };
  }
  if (isAuthError(walletOutcome.error)) {
    return {
      level: "bad",
      text: "Authentication Failed",
      detail: walletOutcome.error.code || `HTTP ${walletOutcome.error.httpStatus}`,
    };
  }
  if (walletOutcome.error) {
    return {
      level: "warn",
      text: "Reachable",
      detail: `Account request failed: ${walletOutcome.error.message}`,
    };
  }
  return { level: "warn", text: "Reachable", detail: `${delta.latencyMs} ms · account not checked yet` };
}

export const READINESS_NOTE =
  "Prerequisite check only (webhook secret and Delta keys present, ETH price feed live, option products cached). " +
  "It does not verify Delta account authentication, that a suitable ETH contract exists, or that an order will execute.";

// Extra explanation when prerequisites are met but the Delta account is being rejected.
export function readinessNote(readiness, delta) {
  if (readiness.text === "Ready" && delta.text === "Authentication Failed") {
    return `${READINESS_NOTE} Delta account authentication is currently failing, which this check does not cover.`;
  }
  return READINESS_NOTE;
}

export function derivePostgres(pg) {
  return pg.ok
    ? { level: "ok", text: "Connected", detail: `${pg.latencyMs} ms` }
    : { level: "bad", text: "Disconnected", detail: pg.error };
}

// Prerequisite check only: not a guarantee that an ETH contract exists or that an order will execute.
export function deriveReadiness(engine) {
  return engine.ready
    ? { level: "ok", text: "Ready", detail: "Prerequisites met" }
    : { level: "warn", text: "Not Ready", detail: `Prerequisites missing: ${engine.blockers.join("; ")}` };
}

/* ---------------- polling ---------------- */

// Runs `task` every `intervalMs` while `isHidden()` is false. Never overlaps runs.
// trigger() runs immediately (used when the tab becomes visible).
export function createPoller({ task, intervalMs, isHidden = () => false }) {
  let running = false;
  let timer = null;

  const run = async () => {
    if (running || isHidden()) return;
    running = true;
    try {
      await task();
    } catch {
      // task is responsible for recording its own errors
    } finally {
      running = false;
    }
  };

  return {
    start() {
      if (timer !== null) return;
      run();
      timer = setInterval(run, intervalMs);
    },
    trigger: run,
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
