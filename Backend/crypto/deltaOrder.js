import axios from "axios";
import { getAuthHeaders } from "../utils/deltaAuth.js";

export async function placeMarketOrder(productId, side, size) {
  const path = "/v2/orders";

  const bodyObj = {
    product_id: productId,
    size: size.toString(),
    side,
    order_type: "market_order",   // ✅ correct enum
    time_in_force: "ioc",
    reduce_only: false
  };

  const body = JSON.stringify(bodyObj);

  const res = await axios.post(
    process.env.DELTA_BASE + path,
    body,
    {
      headers: {
        ...getAuthHeaders("POST", path, body),
        "Content-Type": "application/json"
      }
    }
  );

  return res.data;
}

export async function cancelOrder(orderId) {
  const path = `/v2/orders/${orderId}`;

  const res = await axios.delete(
    process.env.DELTA_BASE + path,
    {
      headers: getAuthHeaders("DELETE", path)
    }
  );

  return res.data;
}

export async function closePosition(productId) {
  const base = process.env.DELTA_BASE;

  // 1️⃣ Fetch open positions
  const posPath = "/v2/positions/margined";

  const positionsRes = await axios.get(
    base + posPath,
    { headers: getAuthHeaders("GET", posPath) }
  );

  const positions = positionsRes.data.result;

  // 2️⃣ Find matching position
  const position = positions.find(
    p => p.product_id === productId && p.size !== 0
  );

  if (!position) {
    throw new Error("No open position found");
  }

  const size = position.size;
  const currentSide = size > 0 ? "buy" : "sell";

  // 3️⃣ Determine opposite side
  const exitSide = currentSide === "buy" ? "sell" : "buy";

  // 4️⃣ Place market order to close
  const orderPath = "/v2/orders";

  const bodyObj = {
    product_id: productId,
    size: Math.abs(size).toString(),
    side: exitSide,
    order_type: "market_order",
    time_in_force: "ioc",
    reduce_only: true   // ⭐ Important for closing
  };

  const body = JSON.stringify(bodyObj);

  const closeRes = await axios.post(
    base + orderPath,
    body,
    {
      headers: {
        ...getAuthHeaders("POST", orderPath, body),
        "Content-Type": "application/json"
      }
    }
  );

  return closeRes.data;
}