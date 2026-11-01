import { getLatestETHPrice } from "./priceService.js";
import { getATMStrike } from "./strikeService.js";
import { getProductId } from "./productCache.js";
import { placeMarketOrder } from "../crypto/deltaOrder.js";

export async function executeTrade(action, symbol) {
    try {

        console.log("====================================");
        //console.log("🚀 Trading Engine Started");
        console.log("Signal :", action);
        console.log("Symbol :", symbol);

        // 1. Get latest ETH price
        const currentPrice = getLatestETHPrice();

        if (!currentPrice) {
            throw new Error("Latest ETH price not available.");
        }

        console.log("Current Price :", currentPrice);

        // 2. Calculate ATM Strike
        const strike = getATMStrike(currentPrice);

        console.log("ATM Strike :", strike);

        // 3. Determine Option Type
        const optionType = action === "buy" ? "C" : "P";

        console.log("Option Type :", optionType);

        // 4. Find Product ID
        const productId = getProductId(
            symbol,
            strike,
            optionType
        );

        if (!productId) {
            throw new Error("No matching option contract found.");
        }

        console.log("Product ID :", productId);

        // 5. Place Market Order
        // We ALWAYS BUY options
        const order = await placeMarketOrder(
            productId,
            "buy",
            1
        );

        console.log("✅ Order Placed Successfully");
        console.log("====================================");

        return {
            success: true,
            signal: action,
            symbol,
            currentPrice,
            strike,
            optionType,
            productId,
            order
        };

    } catch (err) {

        console.error("❌ Trading Engine Error");
        console.error(err);

        return {
            success: false,
            error: err.message
        };

    }
}