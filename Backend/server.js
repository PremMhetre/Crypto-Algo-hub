import "dotenv/config";
import { startBitcoinStream } from "./crypto/bitcoin.js";
import { startEthereumStream } from "./crypto/ethereum.js";
import express from "express";
import cors from "cors";
import { db } from "./utils/db.js";
import http from "http";
import { Server } from "socket.io";
import { getWalletBalance } from "./crypto/deltaWallet.js";
import { getPositions } from "./crypto/deltaPosition.js";
import { closePosition, placeMarketOrder } from "./crypto/deltaOrder.js";
import { cancelOrder } from "./crypto/deltaOrder.js";

import dashboardRouter from "./routes/dashboard.js";
import { startCollector } from "./crypto/collector.js";
import { startBatchInserter } from "./crypto/batchInserter.js";
import { getLatestETHPrice } from "./services/priceService.js";
import { getATMStrike } from "./services/strikeService.js";
import { getProducts,refreshProducts,formatExpiry,getNearestExpiry,getProductId } from "./services/productCache.js";


const app = express();
const PORT = 3000;
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

global.io = io; 

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api/dashboard", dashboardRouter);

await refreshProducts();
console.log("🚀 Starting crypto streams...\n");

// startBitcoinStream();
startEthereumStream();
setInterval(refreshProducts, 5 * 60 * 1000);
// startCollector();
// startBatchInserter();



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

app.get("/wallet", async (req, res) => {
  
  try {
    const data = await getWalletBalance();
    res.json(data);
  } 
  catch (err) {
      console.log("ERROR RESPONSE:", err.response?.data);
      console.log("ERROR STATUS:", err.response?.status);
      console.log("ERROR MESSAGE:", err.message);

      res.status(500).json({
        error: err.response?.data || err.message
      });
    }
});

app.get("/positions", async (req, res) => {
  try {
    const data = await getPositions();
    res.json(data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Position error");
  }
});

app.post("/webhook", async (req, res) => {

    try {

        const { secret, action, symbol } = req.body;

        if(secret !== process.env.WEBHOOK_SECRET){

            return res.status(401).json({
                message:"Invalid Secret"
            });

        }

        const currentPrice = getLatestETHPrice();

        if(!currentPrice){

            return res.status(400).json({
                message:"ETH price unavailable"
            });

        }

        const strike = getATMStrike(currentPrice);

        const optionType =
            action === "buy"
                ? "C"
                : "P";

        const productId = getProductId(
            symbol,
            strike,
            optionType
        );

        if(!productId){

            return res.status(404).json({
                message:"Product not found"
            });

        }

        const order = await placeMarketOrder(
            productId,
            "buy",
            10
        );

        res.json({
            success:true,
            currentPrice,
            strike,
            optionType,
            productId,
            order
        });

    } catch(err){

        console.error(err);

        res.status(500).json({
            error:err.message
        });

    }

});

app.get("/ip", async (req, res) => {
  const response = await fetch("https://api.ipify.org?format=json");
  const data = await response.json();
  res.json(data);
});

app.get("/contracts", async (req, res) => {
  const response = await fetch(
    process.env.DELTA_BASE +
      "/v2/products?contract_types=call_options,put_options"
  );

  const data = await response.json();
  
  console.log("OPTIONS RESPONSE:", data);

  res.json(data);
});

app.get("/products-count", (req, res) => {

    res.json({
        count: getProducts().length
    });

});

app.get("/test", (req,res)=>{

    const id = getProductId(
        "ETH",
        1800,
        "C"
    );

    res.json({
        productId:id
    });

});

app.get("/expiry", (req, res) => {

    res.json({
        expiry: formatExpiry(
            getNearestExpiry("ETH")
        )
    });

});

app.get("/contract/:symbol/:strike/:type/:expiry", async (req, res) => {
  try {
    const { symbol, strike, type, expiry } = req.params;

    const response = await fetch(
      `${process.env.DELTA_BASE}/v2/products?contract_types=call_options,put_options`
    );

    const data = await response.json();

    const contract = data.result.find(
      p =>
        p.underlying_asset?.symbol === symbol.toUpperCase() &&
        Number(p.strike_price) === Number(strike) &&
        p.contract_type ===
          (type.toUpperCase() === "C"
            ? "call_options"
            : "put_options") &&
        p.symbol.endsWith(expiry)
    );

    if (!contract) {
      return res.status(404).json({
        message: "Contract not found"
      });
    }

    res.json({
      product_id: contract.id
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Server error"
    });
  }
});

app.post("/order", async (req, res) => {
  try {
    const { product_id, side, size = 1 } = req.body;

    if (!product_id || !side) {
      return res.status(400).json({
        success: false,
        message: "product_id and side are required"
      });
    }

    const data = await placeMarketOrder(
      Number(product_id),
      side.toLowerCase(),
      Number(size)
    );

    res.json({
      success: true,
      data
    });
  } catch (err) {
    console.error(err.response?.data || err.message);

    res.status(500).json({
      success: false,
      error: err.response?.data || err.message
    });
  }
});

app.get("/cancel/:id", async (req, res) => {
  try {
    const orderId = req.params.id;

    const data = await cancelOrder(orderId);

    res.json(data);

  } catch (err) {
    console.error(JSON.stringify(err.response?.data, null, 2));
    res.status(500).send("Cancel error");
  }
});

app.get("/close/:productId", async (req, res) => {
  try {
    const productId = Number(req.params.productId);

    const data = await closePosition(productId);

    res.json(data);

  } catch (err) {
    console.error(err.message);
    res.status(500).send("Close error");
  }
});



server.listen(PORT, () => {
  console.log(`Server started at http://localhost:${PORT}`);
});

