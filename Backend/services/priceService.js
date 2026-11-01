let latestETHPrice = null;

export function setLatestETHPrice(price) {
    latestETHPrice = price;
}

export function getLatestETHPrice() {
    return latestETHPrice;
}