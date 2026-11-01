let currentPosition = {
    isOpen: false,
    optionType: null,
    productId: null,
    strike: null,
    quantity: 0,
    entryPrice: null,
    orderId: null
};

export function getCurrentPosition() {
    return currentPosition;
}

export function setCurrentPosition(position) {
    currentPosition = position;
}

export function clearCurrentPosition() {

    currentPosition = {
        isOpen: false,
        optionType: null,
        productId: null,
        strike: null,
        quantity: 0,
        entryPrice: null,
        orderId: null
    };

}

