// Run with: node --test routes/dashboard.test.js  (built-in runner, no dependencies)
// Controlled test data only; none of it is a real Delta response.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import router, { resolveSettlement } from "./dashboard.js";

const eth = (id, settlingId, symbol = "USD") => ({
  id, underlying_asset: { symbol: "ETH" }, settling_asset: { id: settlingId, symbol },
});

test("settlement: all ETH options share one settling asset", () => {
  const r = resolveSettlement([eth(1, 14), eth(2, 14), { id: 3, underlying_asset: { symbol: "BTC" }, settling_asset: { id: 99, symbol: "X" } }]);
  assert.deepEqual(r, { underlying: "ETH", productCount: 2, assetId: 14, symbol: "USD", consistent: true, reason: null });
});

test("settlement: no ETH options gives null assetId, never a default", () => {
  for (const list of [[], [{ id: 1, underlying_asset: { symbol: "BTC" }, settling_asset: { id: 14, symbol: "USD" } }]]) {
    const r = resolveSettlement(list);
    assert.equal(r.assetId, null);
    assert.equal(r.consistent, false);
    assert.ok(r.reason);
  }
});

test("settlement: mixed or missing settling assets give null assetId", () => {
  assert.equal(resolveSettlement([eth(1, 14), eth(2, 204, "INR")]).assetId, null);
  assert.equal(resolveSettlement([eth(1, 14), { id: 2, underlying_asset: { symbol: "ETH" } }]).assetId, null);
  assert.equal(resolveSettlement([eth(1, "14")]).assetId, null);
});

test("settlement route is GET-only and read-only", async () => {
  const app = express();
  app.use("/api/dashboard", router);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}/api/dashboard/settlement`;
    const ok = await fetch(base);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.success, true);
    assert.equal(body.result.underlying, "ETH");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal((await fetch(base, { method })).status, 404, method);
    }
  } finally {
    server.close();
  }
});
