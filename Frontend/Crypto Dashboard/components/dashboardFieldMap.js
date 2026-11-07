// Delta field mappings for TradingDashboard (see DASHBOARD_SPEC.md §4 and §13,
// and DELTA_FIELD_VERIFICATION.md).
//
// A null mapping makes the dashboard display N/A. Do not fill an entry until BOTH the
// field name and its financial meaning are confirmed from a real response or Delta
// documentation. Margin, PnL and position mappings below are all still null.
//
// Fields marked "(row) => ..." take one raw exchange row and return the value.
export const FIELD_MAP = Object.freeze({
  // The wallet row is matched by asset id against the settling asset id of the ETH option
  // products (GET /api/dashboard/settlement). There is no settlement asset constant, no
  // fallback asset, and no selection by position, symbol or balance.
  wallet: Object.freeze({
    assetIdField: "asset_id",       // verified present, integer, in a real /wallet response
    assetSymbolField: "asset_symbol", // display caption only
    marginUsed: null,          // Margin Used (not assumed to be blocked_margin)
    initialMargin: null,       // Initial Margin (not assumed to be position_margin)
    maintenanceMargin: null,   // Maintenance Margin
    freeMargin: null,          // Free Margin (not assumed to be available_balance)
    marginUtilization: null,   // (row) => percent, only with a confirmed formula
    netEquityMetaField: null,  // field on the response `meta` object
  }),

  // Currency toggle (approved). Values are read directly from these API fields; there is
  // no conversion. USD fields: documented, partially verified. INR fields: UNDOCUMENTED and
  // pending verification. (The observed 85x ratio between them is only an observation and
  // must never be used to calculate a value.)
  currencies: Object.freeze({
    USD: Object.freeze({ balance: "balance", available: "available_balance", pendingVerification: false }),
    INR: Object.freeze({ balance: "balance_inr", available: "available_balance_inr", pendingVerification: true }),
  }),

  positions: Object.freeze({
    isOpen: null,              // (row) => boolean, once open-position detection is verified
    productId: null,           // field with the Delta product id
    symbol: null,              // field with the contract symbol
    side: null,                // (row) => "Long" | "Short" | null
    quantity: null,            // (row) => number | null
    entryPrice: null,
    markPrice: null,           // exchange field on the position row (public ticker mark is separate)
    unrealizedPnl: null,       // exchange-provided PnL only; never calculated here
    margin: null,
  }),
});
