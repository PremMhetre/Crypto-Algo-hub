import WebSocket from "ws";

const ws = new WebSocket(
  "wss://stream.binance.com:9443/ws/ethusdt@trade"
);

let currentMinute = null;
let prices = [];

ws.on("open", () => {
  console.log("✅ Connected to Binance ETH stream");
});

ws.on("message", (data) => {
  const trade = JSON.parse(data.toString());
  const price = parseFloat(trade.p);

  const tradeMinute = Math.floor(trade.T / 60000); // minute bucket

  // New minute → calculate previous minute movement
  if (currentMinute !== null && tradeMinute !== currentMinute) {
    calculateMovement(prices);
    prices = []; // reset for new minute
  }

  currentMinute = tradeMinute;
  prices.push(price);
});

function calculateMovement(prices) {
  if (prices.length < 2) return;

  const open = prices[0];
  const close = prices[prices.length - 1];
  const high = Math.max(...prices);
  const low = Math.min(...prices);

  const absoluteMove = close - open;
  const percentMove = ((absoluteMove / open) * 100).toFixed(4);

  console.clear();
  console.log("🟣 ETH 1-MIN MOVE");
  console.log("Open :", open);
  console.log("Close:", close);
  console.log("High :", high);
  console.log("Low  :", low);
  console.log("Move :", absoluteMove.toFixed(2));
  console.log("Move %:", percentMove + "%");
}
