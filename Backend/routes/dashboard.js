import { Router } from "express";
import { db } from "../utils/db.js";
import { getProducts } from "../services/productCache.js";
import { getBinanceStatus } from "../services/priceService.js";

// Read-only endpoints backing the monitoring dashboard.
const router = Router();

const STALE_TICK_MS = 10_000;
const STATUS_TTL_MS = 5_000;
const MARK_TTL_MS = 3_000;
const MAX_IDS = 25;

let statusCache = { at: 0, value: null };
const markCache = new Map(); // symbol -> { at, mark }

async function timed(fn) {
  const t0 = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - t0, error: null };
  } catch (err) {
    return { ok: false, latencyMs: null, error: err.message };
  }
}

// Slow probes (PostgreSQL, Delta public API) are cached for STATUS_TTL_MS.
async function probeServices() {
  const [pg, delta] = await Promise.all([
    timed(() => db.query("SELECT 1")),
    timed(async () => {
      const res = await fetch(`${process.env.DELTA_BASE}/v2/assets`, {
        signal: AbortSignal.timeout(4000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    })
  ]);
  return { pg, delta, at: Date.now() };
}

// Binance state and readiness are in-memory, so they are recomputed on every request.
function buildStatus(probes) {
  const binance = getBinanceStatus();
  const ageMs = binance.lastTickAt ? Date.now() - binance.lastTickAt : null;
  let binanceState = binance.state;
  if (binanceState === "connected" && (ageMs === null || ageMs > STALE_TICK_MS)) {
    binanceState = "stale";
  }

  // No standalone trading engine process exists: orders are placed by POST /webhook.
  // Report whether that path can currently trade, with the reasons it cannot.
  const blockers = [];
  if (!process.env.WEBHOOK_SECRET) blockers.push("WEBHOOK_SECRET not set");
  if (!process.env.DELTA_KEY || !process.env.DELTA_SECRET) blockers.push("Delta API keys not set");
  if (binanceState !== "connected") blockers.push(`ETH price feed ${binanceState}`);
  if (getProducts().length === 0) blockers.push("option products not loaded");

  return {
    binance: { state: binanceState, lastTickAt: binance.lastTickAt, ageMs },
    delta: probes.delta,
    postgres: probes.pg,
    engine: { ready: blockers.length === 0, blockers },
    checkedAt: Date.now()
  };
}

router.get("/status", async (req, res) => {
  try {
    if (!statusCache.value || Date.now() - statusCache.at > STATUS_TTL_MS) {
      statusCache = { value: await probeServices(), at: Date.now() };
    }
    res.json({ success: true, result: buildStatus(statusCache.value) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

async function getMarkPrice(symbol) {
  const hit = markCache.get(symbol);
  if (hit && Date.now() - hit.at < MARK_TTL_MS) return hit.mark;

  let mark = null;
  try {
    const res = await fetch(
      `${process.env.DELTA_BASE}/v2/tickers/${encodeURIComponent(symbol)}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) {
      const body = await res.json();
      const n = Number(body?.result?.mark_price);
      mark = Number.isFinite(n) ? n : null;
    }
  } catch {
    mark = null;
  }
  markCache.set(symbol, { at: Date.now(), mark });
  return mark;
}

// GET /api/dashboard/instruments?ids=123,456
// Product metadata (from the cached Delta catalogue) plus public mark price.
router.get("/instruments", async (req, res) => {
  try {
    const ids = String(req.query.ids || "")
      .split(",")
      .map(t => t.trim())
      .filter(t => /^\d+$/.test(t))
      .map(Number)
      .slice(0, MAX_IDS);

    const byId = new Map(getProducts().map(p => [p.id, p]));
    const result = {};

    await Promise.all(ids.map(async id => {
      const p = byId.get(id);
      if (!p) {
        result[id] = null;
        return;
      }
      result[id] = {
        symbol: p.symbol,
        underlying: p.underlying_asset?.symbol ?? null,
        optionType:
          p.contract_type === "call_options" ? "Call"
          : p.contract_type === "put_options" ? "Put"
          : null,
        strike: p.strike_price ?? null,
        expiry: p.settlement_time ?? null,
        contractValue: p.contract_value ?? null,
        markPrice: await getMarkPrice(p.symbol)
      };
    }));

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const SETTLEMENT_UNDERLYING = "ETH";

// Settling asset shared by all ETH option products. assetId is null (never a default)
// when there are no such products or they do not agree on a single settling asset.
export function resolveSettlement(products) {
  const eth = products.filter(p => p.underlying_asset?.symbol === SETTLEMENT_UNDERLYING);
  const assets = new Map(); // settling asset id -> symbol
  let invalid = 0;
  for (const p of eth) {
    const id = p.settling_asset?.id;
    if (Number.isInteger(id)) assets.set(id, p.settling_asset.symbol ?? null);
    else invalid += 1;
  }

  const base = { underlying: SETTLEMENT_UNDERLYING, productCount: eth.length };
  if (eth.length === 0) {
    return { ...base, assetId: null, symbol: null, consistent: false, reason: "No ETH option products loaded" };
  }
  if (invalid > 0 || assets.size !== 1) {
    return {
      ...base, assetId: null, symbol: null, consistent: false,
      reason: invalid > 0 ? "Some ETH options have no settling asset id" : "ETH options have different settling assets"
    };
  }
  const [[assetId, symbol]] = assets;
  return { ...base, assetId, symbol, consistent: true, reason: null };
}

// GET /api/dashboard/settlement
// Settling asset of the ETH options, from the cached product catalogue (no Delta call).
router.get("/settlement", (req, res) => {
  try {
    res.json({ success: true, result: resolveSettlement(getProducts()) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
