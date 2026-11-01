import axios from "axios";
import { getAuthHeaders } from "../utils/deltaAuth.js";

export async function getWalletBalance() {
  const path = "/v2/wallet/balances";
//   console.log(getAuthHeaders("GET", path));
  const res = await axios.get(
    process.env.DELTA_BASE + path,
    { headers: getAuthHeaders("GET", path) }
  );

  return res.data;
}