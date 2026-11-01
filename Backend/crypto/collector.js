import WebSocket from "ws";
import { tradeBuffer } from "./tradeBuffer.js";

export function startCollector() {

  const ws = new WebSocket(
    "wss://stream.binance.com:9443/stream?streams=btcusdt@trade/ethusdt@trade"
  );

  ws.on("open", () => {
    console.log("Connected to Binance");
  });

  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());
    const trade = message.data;

    tradeBuffer.push({
      symbol: trade.s,
      trade_id: trade.t,
      ts: new Date(trade.T),
      price: parseFloat(trade.p),
      qty: parseFloat(trade.q),
      side: trade.m ? "SELL" : "BUY"
    });
  });

  ws.on("close", () => {
    console.log("Stream closed, reconnecting...");
    setTimeout(startCollector, 2000);
  });
}