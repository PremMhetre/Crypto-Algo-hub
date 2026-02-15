import WebSocket from "ws";
import { db } from "../utils/db.js";

export function startEthereumStream() {
  const ws = new WebSocket(
    "wss://stream.binance.com:9443/ws/ethusdt@trade"
  );

  let currentSecond = null;
  let bucket = [];

  ws.on("open", () => {
    console.log("🟣 Ethereum stream connected");
  });

  ws.on("message", async (data) => {
    const trade = JSON.parse(data.toString());
    const price = parseFloat(trade.p);
    const qty = parseFloat(trade.q);

    const sec = Math.floor(trade.T / 1000);

    if (currentSecond !== null && sec !== currentSecond) {
      await saveETH(bucket, currentSecond);
      bucket = [];
    }

    currentSecond = sec;
    bucket.push({
      price,
      qty,
      side: trade.m ? "SELL" : "BUY"
    });
  });
}

async function saveETH(trades, second) {
  if (trades.length < 2) return;

  const open = trades[0].price;
  const close = trades[trades.length - 1].price;
  const high = Math.max(...trades.map(t => t.price));
  const low = Math.min(...trades.map(t => t.price));

  let volume = 0, buyVol = 0, sellVol = 0;
  trades.forEach(t => {
    volume += t.qty;
    t.side === "BUY" ? buyVol += t.qty : sellVol += t.qty;
  });

  const move = close - open;
  const movePct = (move / open) * 100;
  await db.query(
    `INSERT INTO eth_1s_data
     (ts, open, high, low, close, volume, buy_volume, sell_volume, trade_count, move, move_percent)
     VALUES (to_timestamp($1), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      second,
      open, high, low, close,
      volume, buyVol, sellVol,
      trades.length,
      move, movePct
    ]
  );
}
