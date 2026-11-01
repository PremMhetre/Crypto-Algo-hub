import "dotenv/config";
let products = [];
const productMap = new Map();

export function setProducts(data) {
    products = data;
}

export function getProducts() {
    return products;
}

export async function refreshProducts() {
    try {

        console.log("🔄 Refreshing Delta products...");

        const response = await fetch(
            `${process.env.DELTA_BASE}/v2/products?contract_types=call_options,put_options`
        );

        const data = await response.json();

        products = data.result;
        console.log(`✅ Loaded ${products.length} option contracts`);

    } catch (err) {

        console.error("Product refresh failed:", err);

    }
}

export function getNearestExpiry(symbol) {

    const now = new Date();

    const expiries = products
        .filter(p =>
            p.underlying_asset?.symbol === symbol &&
            new Date(p.settlement_time) > now
        )
        .map(p => p.settlement_time);

    const unique = [...new Set(expiries)];

    unique.sort(
        (a, b) => new Date(a) - new Date(b)
    );

    return unique[0];

}

export function formatExpiry(dateString) {

    const d = new Date(dateString);

    const day = String(d.getUTCDate()).padStart(2, "0");

    const month = String(d.getUTCMonth() + 1).padStart(2, "0");

    const year = String(d.getUTCFullYear()).slice(-2);

    return `${day}${month}${year}`;

}

export function getProductId(symbol, strike, optionType) {

    const filtered = products
        .filter(
            p =>
                p.underlying_asset?.symbol === symbol
        )
        .filter(
            p =>
                p.contract_type ===
                (
                    optionType === "C"
                        ? "call_options"
                        : "put_options"
                )
        )
        .filter(
            p =>
                Number(p.strike_price) === strike
        )
        .sort(
            (a,b)=>
                new Date(a.settlement_time)
                -
                new Date(b.settlement_time)
        );

    if(filtered.length===0){

        return null;

    }

    return filtered[0].id;

}