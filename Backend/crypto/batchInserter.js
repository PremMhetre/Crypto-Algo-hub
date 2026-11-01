import { tradeBuffer } from "./tradeBuffer.js";
import { db } from "../utils/db.js";

export function startBatchInserter() {

  setInterval(async () => {

    if (tradeBuffer.length === 0) return;

    const trades = tradeBuffer.splice(0, tradeBuffer.length);

    const values = [];
    const placeholders = trades.map((t, i) => {
      const idx = i * 6;
      values.push(
        t.symbol,
        t.trade_id,
        t.ts,
        t.price,
        t.qty,
        t.side
      );

      return `($${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6})`;
    }).join(",");

    await db.query(
      `INSERT INTO trades
      (symbol, trade_id, ts, price, qty, side)
      VALUES ${placeholders}`,
      values
    );

  }, 1000);
}

