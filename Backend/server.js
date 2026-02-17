import "dotenv/config";
import { startBitcoinStream } from "./crypto/bitcoin.js";
import { startEthereumStream } from "./crypto/ethereum.js";
import express from "express";
import cors from "cors";
import { db } from "./utils/db.js";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());


console.log("🚀 Starting crypto streams...\n");

startBitcoinStream();
startEthereumStream();

app.get("/", (req, res) => {
  res.send("Server running on port 3000 🚀");
});

app.get("/api/market-data", async (req, res) => {
  const { market, startDate, endDate, startTime, endTime, sortBy, order } = req.query;

  console.log("API HIT");

  const table = market === "eth" ? "eth_1s_data" : "btc_1s_data";

  let conditions = [];
  let values = [];

  if (startDate && startTime) {
    values.push(`${startDate} ${startTime}:00`);
    conditions.push(`ts >= $${values.length}`);
  }

  if (endDate && endTime) {
    values.push(`${endDate} ${endTime}:59`);
    conditions.push(`ts <= $${values.length}`);
  }

  // Add "ts" to valid sort fields for time-based ordering
  const validSort = ["volume","buy_volume","sell_volume","move","move_percent","trade_count","ts"];
  const sortColumn = validSort.includes(sortBy) ? sortBy : "volume";
  const sortOrder = order === "asc" ? "ASC" : "DESC";

  let where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT *
    FROM ${table}
    ${where}
    ORDER BY ${sortColumn} ${sortOrder}
    LIMIT 1000
  `;

  const result = await db.query(query, values);
  res.json(result.rows);
});



app.listen(PORT, () => {
  console.log(`Server started at http://localhost:${PORT}`);
});
