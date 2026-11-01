export function getATMStrike(price) {
    return Math.round(price / 20) * 20;
}