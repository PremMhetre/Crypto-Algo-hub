import axios from "axios";
import { getAuthHeaders } from "../utils/deltaAuth.js";

export async function getPositions() {
  const path = "/v2/positions/margined";

  const res = await axios.get(
    process.env.DELTA_BASE + path,
    { headers: getAuthHeaders("GET", path) }
  );

  return res.data;
}