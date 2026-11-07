let latestETHPrice = null;
let lastTickAt = null;
let binanceState = "connecting";

export function setLatestETHPrice(price) {
    latestETHPrice = price;
    lastTickAt = Date.now();
}

export function getLatestETHPrice() {
    return latestETHPrice;
}

// Read-only connection telemetry, used by the dashboard status endpoint.
export function setBinanceState(state) {
    binanceState = state;
}

export function getBinanceStatus() {
    return { state: binanceState, lastTickAt, price: latestETHPrice };
}
