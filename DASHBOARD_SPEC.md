# DASHBOARD_SPEC.md: Crypto Algo Hub Live Trading Dashboard

Specification only. This document changes no code. It records what the repository contains today, what the dashboard should do, and what is still unknown.

**Legend** (used throughout):

| Tag | Meaning |
|---|---|
| **Verified** | Confirmed by reading the code, or by running it against a real service in this project. |
| **Proposed** | Required behaviour for the dashboard. It may or may not be implemented yet. |
| **Unverified** | An assumption, usually about a Delta Exchange response field, that has not been confirmed against a real response. |
| **Missing** | Not present in the codebase. |

---

## 1. Project Overview

Crypto-Algo-hub is a Node.js + React application that:
- reads the Binance ETH price over WebSocket,
- places Delta Exchange options orders when an external signal arrives at `POST /webhook`,
- stores (when enabled) 1-second market data in PostgreSQL.

It has no strategy engine, no stop-loss or take-profit logic and no trade ledger. See `TRADING_SYSTEM_REPORT.md` for the full analysis.

The dashboard is a read-only monitoring page at `/dashboard`. It shows account balances, margin, open options positions and system health, using data from the existing backend.

---

## 2. Existing Architecture

### 2.1 Backend (`Backend/`, Node.js ES modules, Express 5, port 3000 hardcoded in `server.js`)

| File | Role | Status |
|---|---|---|
| `server.js` | Express app, socket.io, all legacy routes, startup. Mounts the dashboard router with `app.use("/api/dashboard", dashboardRouter)`. | **Verified** |
| `routes/dashboard.js` | Express `Router` with the three dashboard endpoints: `GET /status`, `GET /instruments` and `GET /settlement` (with the pure helper `resolveSettlement()`). GET only. | **Verified** (added for the dashboard) |
| `routes/dashboard.test.js` | `node --test` tests for `resolveSettlement()` and for the GET-only settlement route. | **Verified** (4 tests) |
| `crypto/deltaWallet.js` → `getWalletBalance()` | Signed `GET {DELTA_BASE}/v2/wallet/balances`. Returns `res.data` unchanged. | **Verified** |
| `crypto/deltaPosition.js` → `getPositions()` | Signed `GET {DELTA_BASE}/v2/positions/margined`. Returns `res.data` unchanged. | **Verified** |
| `crypto/deltaOrder.js` | `placeMarketOrder`, `cancelOrder`, `closePosition`. **Not used by the dashboard.** | **Verified** |
| `utils/deltaAuth.js` → `getAuthHeaders(method, path, body)` | HMAC-SHA256 over `method + timestamp + path + body`; sends `api-key`, `timestamp`, `signature`. | **Verified** |
| `utils/db.js` | `pg` Pool built from `DB_*` env vars (named export `db`). | **Verified** |
| `crypto/ethereum.js` → `startEthereumStream()` | Binance `ethusdt@trade` WebSocket. Calls `setLatestETHPrice()` on every trade and reports `open` / `close` / `error` to `setBinanceState()`. **No reconnect.** | **Verified** |
| `services/priceService.js` | In-memory latest ETH price (`setLatestETHPrice`, `getLatestETHPrice`) plus connection telemetry (`setBinanceState`, `getBinanceStatus` returning `{state, lastTickAt, price}`). | **Verified** |
| `services/productCache.js` → `getProducts()`, `refreshProducts()` | In-memory Delta options catalogue (`/v2/products?contract_types=call_options,put_options`), loaded at boot and refreshed every 5 minutes. Contains all underlyings, not only ETH. | **Verified** |
| `services/tradingEngine.js` → `executeTrade()` | **Not imported anywhere** (dead code). Orders are placed by `POST /webhook` in `server.js`. | **Verified** |

### 2.2 Frontend (`Frontend/Crypto Dashboard/`, React 19 + Vite + MUI 7)

| File | Role | Status |
|---|---|---|
| `src/App.jsx` | `react-router-dom` routes: `/` (`MarketDataFilter`), `/liveETH` (`LiveETHDashboard`), `/dashboard` (`TradingDashboard`). | **Verified** |
| `components/TradingDashboard.jsx` | The dashboard page: a polling container (`TradingDashboard`) and a pure view (`DashboardView`), with the four sections and the USD / INR toggle. **Path note:** the component lives in `components/`, beside `src/`, not in `src/components/`. This follows the existing convention for the other two pages. | **Verified** |
| `components/dashboardFieldMap.js` | The only place Delta field mappings live. Margin, PnL and position mappings are all still `null` (shown as `N/A`); wallet matching uses `asset_id`; the INR fields are flagged `pendingVerification`. | **Verified** |
| `components/dashboardLogic.js` | Pure logic: formatting (`formatMoney`), settlement-row selection (`selectSettlementRow`), `deriveWallet`, `derivePositions`, status derivation and the polling helper `createPoller`. | **Verified** |
| `components/dashboardLogic.test.js` | `node --test` unit tests (28 at last run), controlled data only. | **Verified** |
| `components/dashboardRender.test.js` | `node --test` server-side render tests of `DashboardView` using the project's own vite and react-dom (10 at last run), controlled data only. | **Verified** |
| `src/main.jsx` | `BrowserRouter` + `CssBaseline`. | **Verified** |

The API base URL is hardcoded as `http://localhost:3000` in each component (existing convention).

### 2.3 Environment variables (names only)
`DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT`, `DELTA_KEY`, `DELTA_SECRET`, `DELTA_BASE`, `WEBHOOK_SECRET`.

---

## 3. Dashboard Objectives

1. Show actual account state (balances, margin, positions) fetched from the existing backend and Delta integration.
2. Show actual system health: Binance feed, Delta API, PostgreSQL, and webhook readiness (a prerequisite check, not a guarantee of order execution).
3. Stay strictly **read-only**: no control that can place, modify, cancel or close anything.
4. Never present an unknown value as a known one: show `N/A` for any missing field, and never show mock data as live data.
5. Reuse existing services. No new libraries, frameworks, databases or exchange integrations.

---

## 4. Dashboard Section Requirements

Successful `/wallet` and `/positions` responses have now been captured (2026-11-08, after the local clock was synchronized; see §5.1, §5.2, §13.1 and `DELTA_FIELD_VERIFICATION.md`). The **response structures** and the **existence** of the wallet fields are verified. The **financial meaning** of the wallet fields, and every **position row field**, remain Unverified unless a row below says otherwise: `/positions` has only been seen returning an empty array, so no position row has been observed.

### 4.1 Section A: Account Overview

**Settlement asset rule (revised: settlement-id matching):**
- The `/wallet` response holds one row per asset (**Verified**, §13.1 and `DELTA_FIELD_VERIFICATION.md`). The dashboard shows the row of **one settlement asset only**: the wallet row whose `asset_id` equals the settling asset id of the ETH option products, obtained from `GET /api/dashboard/settlement` (§5.6). The product data is **Verified**: all ETH options settle in asset id 14.
- The row must match **exactly once**. It is **never** selected by array position, by non-zero balance, by symbol preference or by "first row". There is **no fallback settlement asset**. If the settlement id is unresolved, or the match is not exactly one row, every wallet-derived metric shows `N/A` in both currencies.
- Balances from different assets must **never be added or merged** unless a verified conversion method exists. None exists, so none is allowed.
- The matched row's `asset_symbol` and `asset_id` are shown as a caption under the section title.

**Verified findings for this section (from real responses, `DELTA_FIELD_VERIFICATION.md` §2, §9):**
- `/wallet` returns `{ success, meta, result }`. `result` holds one row per asset (7 rows at capture: `USD`, `INR`, `REF_USD`, `BTC`, `ETH`, `SOL`, `XRP`), and every row has the same 29 keys. All monetary values and the three `meta` fields are **numeric strings**.
- Present on every row: `asset_id` (integer), `asset_symbol`, `balance`, `available_balance`, `balance_inr`, `available_balance_inr`, `blocked_margin`, `position_margin`, `order_margin`. **`maintenance_margin` does not exist** (so Maintenance Margin stays `N/A`).
- Documentation (partial, read through a summarizing tool) describes `balance` as "Total wallet balance", `available_balance` as "Balance available for trading" and `blocked_margin` as "Total blocked margin including commissions for all modes". These meanings are **partially verified** only; they were not tested with margin in use, and `order_margin` has conflicting documentation. The `*_inr` fields are **undocumented**.

**Margin and balance metrics rule (Proposed):** a metric may show a number only if (a) its exchange field name is verified against a real response **and** (b) its financial meaning is confirmed to match the dashboard label. Otherwise it shows `N/A`.

| Metric | Source | Candidate field | Status / display rule |
|---|---|---|---|
| Total Wallet Balance | `GET /wallet` | USD mode: `balance`. INR mode: `balance_inr` (both on the settlement row, §4.1.1) | USD field: present and **partially verified** (documented as "Total wallet balance"). INR field: **undocumented, pending verification**. |
| Available Balance | `GET /wallet` | USD mode: `available_balance`. INR mode: `available_balance_inr` (same row) | USD field: present and **partially verified** (documented as "Balance available for trading"). INR field: **undocumented, pending verification**. |
| Margin Used | `GET /wallet` | `blocked_margin` is only a **candidate** | **Unverified** field **and** meaning. `blocked_margin` must not be assumed to mean "Margin Used". `N/A` until confirmed. |
| Unrealized PnL | `GET /positions` | Sum of the **exchange-provided** per-position unrealized PnL. `0` when positions were fetched successfully and none are open. `N/A` if any open position lacks an exchange-provided value. | **Proposed.** The field is **Unverified** (§4.3). |
| Net equity (secondary line, optional) | `GET /wallet` | `meta.net_equity` | Field **present** in the real response (numeric string). **Meaning unverified**: the documentation calls it "Net equity for robo trading". Not used; `N/A` / hidden until confirmed. |

### 4.1.1 Currency toggle (USD / INR), Account Overview only

**Decision (approved):** the dashboard offers a USD / INR segmented toggle in Account Overview instead of showing both currencies at once.

| Requirement | Specification |
|---|---|
| Control | MUI `ToggleButtonGroup` (exclusive) with two buttons, `$ USD` and `₹ INR`. It is the only interactive control on the page. It is **frontend-only** and never calls the backend. |
| Default | USD on every page load. The choice is **not persisted** (no `localStorage`, no URL parameter). |
| Effect | Switching immediately changes Total Wallet Balance and Available Balance. Only one currency is displayed at a time. Labels carry the symbol (`$` or `₹`). |
| Data source | Values come **directly from the API fields** in §4.1. There is **no conversion** of any kind: no exchange rate, no multiplication, no use of the observed 85× relationship. |
| INR fields | `balance_inr` and `available_balance_inr` are **undocumented and pending verification**. In INR mode the toggle shows an "INR fields unverified" marker with a tooltip stating that the values are read directly from the API and not converted. |
| Missing INR field | If a USD field exists but its INR counterpart is missing or non-numeric, only the INR tile shows `N/A` (tooltip: "INR field missing in response"). There is no fallback to a converted USD value. USD mode is unaffected. |
| Unresolved settlement | `N/A` in both modes (§4.1). |
| Other tiles | Margin Used and Unrealized PnL stay `N/A` in both modes (unverified fields; no INR field exists for margin). Margin Overview is unaffected by the toggle. |
| Number format | USD: US grouping (`$1,234.56`). INR: Indian digit grouping (`₹1,23,456.78`). Two decimals. `N/A` is never prefixed with a symbol. |
| Network | Switching causes **zero** additional requests. The polling effect does not depend on the selected currency. |

### 4.2 Section B: Margin Overview

**Mandatory rule (Proposed):** every margin metric displays `N/A` unless **both** its exchange field **and** its financial meaning have been verified against a real Delta response or Delta's documentation. Specifically, the dashboard must not assume that:
- `available_balance` means **Free Margin**,
- `position_margin` (wallet) or per-position `margin` means **Initial Margin**,
- `blocked_margin` means **Margin Used** (also applies to §4.1).

The same settlement-asset rule as §4.1 applies: a single confirmed asset, no automatic row fallback, no cross-asset sums.

A derived value (such as a ratio) is allowed only if its formula is confirmed by Delta documentation or a real response and is stated in the tooltip.

| Metric | Candidate source (all **Unverified**) | Display rule |
|---|---|---|
| Initial Margin | per-position `margin` from `GET /positions`, or wallet `position_margin` | `N/A` until the field and its meaning as initial margin are confirmed. Which of the two sources is correct is itself undecided. |
| Maintenance Margin | wallet `maintenance_margin`, if it exists | `N/A` unless a verified field exists. It is believed not to be returned, so `N/A` is the expected result. |
| Free Margin | wallet `available_balance` is only a candidate | `N/A` until Delta's definition of free margin is confirmed. |
| Margin Utilization (%) | no exchange field known; `blocked_margin ÷ balance` is only an unconfirmed candidate formula | `N/A` until the formula is confirmed. It is not an exchange-provided value. |

### 4.3 Section C: Open Positions (read-only table)

**Open-position detection (Unverified):** the rule for deciding that a row of `GET /positions` → `result[]` is an open position has **not** been verified. The meaning and semantics of `size` are Unverified (see the Position Side and Quantity rows below), so the dashboard must **not** assume that "`size` is non-zero" means "open". That rule may be used only after it is confirmed against an actual Delta `/positions` response (for example, whether the endpoint returns closed or zero-size rows, and how `size` is encoded).

Until detection is verified:
- the dashboard must not claim that there are no open positions, and must not show the "No open positions" empty state (see the empty-state rule below);
- it must show a clearly worded unverified or `N/A` state for the positions panel instead of an empty-portfolio message, and Unrealized PnL shows `N/A`.

The current implementation (`components/TradingDashboard.jsx`, `loadAccount()`) filters rows by non-zero `size`. This is a further deviation from this spec (§13).

| Column | Source | Mapping | Status |
|---|---|---|---|
| Contract Name | `/positions` | `product_symbol`; fallback `symbol` from `/api/dashboard/instruments` | **Unverified** (`/positions`), **Verified** (`instruments.symbol`) |
| Underlying Asset | `/api/dashboard/instruments` | `underlying` (from the product cache `underlying_asset.symbol`) | **Verified** |
| Option Type | `/api/dashboard/instruments` | `optionType` (`Call` / `Put`, from `contract_type`) | **Verified** |
| Position Side | `/positions` | Candidate: derive from `size`. No mapping is assumed. | **Unverified.** The Long/Short encoding (for example whether short positions use a negative `size`, or a separate side field exists) must be confirmed against an actual Delta response. Until then show `N/A`. No side semantics may be invented. |
| Quantity | `/positions` | Candidate: `size` | **Unverified.** Unit (contracts or underlying), sign handling and whether to show the absolute value must be confirmed against an actual Delta response. Until then show `N/A`. |
| Average Entry Price | `/positions` | `entry_price` | **Unverified** |
| Mark Price | `/positions` `mark_price` if present, else `/api/dashboard/instruments` `markPrice` | | `instruments.markPrice` is **Verified** (public Delta ticker `/v2/tickers/{symbol}` field `mark_price`) |
| Unrealized PnL | `/positions` `unrealized_pnl` | **Rule (Proposed):** exchange-provided value only; `N/A` if absent. The frontend never calculates PnL. | **Unverified** that the field exists |
| Expiry Date | `/api/dashboard/instruments` | `expiry` (`settlement_time`), rendered as `DD MMM YYYY HH:mm` | **Verified** |
| Margin Used | `/positions` | Candidate: `margin` | **Unverified** field and meaning. `N/A` until confirmed (see the §4.2 rule). |

**Known deviations, current implementation** (`components/TradingDashboard.jsx`; documented here, not changed by this spec revision):
- `buildPosition()` falls back to `(mark − entry) × size × contract_value` when the exchange does not supply PnL, and marks it with `*`. This is a generic formula, **Unverified** for options (contract-value units, short sign handling, fees), and conflicts with the exchange-provided-PnL-only rule above. **Proposed:** remove the fallback and show `N/A`.
- `buildPosition()` also derives side from the sign of `size` and shows `abs(size)` as quantity. Both are unverified interpretations (see the Position Side and Quantity rows) and should show `N/A` until confirmed.
- `pickWalletRow()` falls back to the first wallet row when no `USD` / `USDT` / `USDC` row exists, and the balance and margin tiles show numbers from candidate fields. These conflict with the settlement-asset rule (§4.1) and the margin rule (§4.2).

All of these are open items (§13).

**Empty state (Proposed, partly implemented):** when a `/positions` response was fetched successfully **and open-position detection has been verified** and shows none are open, show a centred "No open positions" message in place of the table (not an error, not a spinner). The summary line shows `0 open`. If detection is not verified, or the response structure is not as expected, do not show this empty state; use the unverified / `N/A` state described above.

**Instruments lookup:** `GET /api/dashboard/instruments?ids=` is called only with the `product_id`s of current open positions, only while at least one position exists. Contract metadata (`symbol`, `underlying`, `optionType`, `strike`, `expiry`, `contractValue`) may be reused by the frontend while the set of product ids is unchanged. **Mark prices must keep refreshing every cycle while any position is open.** See §7.

### 4.4 Section D: System Status

Four cards. Each card shows a state, a short explanation, and a detail line (latency, age or error). No state is hardcoded; each is computed from live checks.

| Card | Source | State vocabulary | Meaning |
|---|---|---|---|
| **Binance ETH WebSocket** | `GET /api/dashboard/status` → `binance` (`getBinanceStatus()`) | **Connected**: socket open and a trade tick arrived within the last 10 s (`STALE_TICK_MS` in `routes/dashboard.js`). **Connected, no recent ticks** (state `stale`): socket open but no tick for over 10 s. **Connecting**: not yet opened. **Disconnected**: socket closed or errored (there is no reconnect, so this persists until the server restarts). | **Verified** |
| **Delta Exchange API** | `/api/dashboard/status` → `delta` (public `GET {DELTA_BASE}/v2/assets`, 4 s timeout) **plus** the outcome of the frontend's `GET /wallet` call | **Unreachable**: public check failed. **Reachable**: public check passed. **Authentication Failed**: reachable but the account request fails with an auth-type error (`expired_signature`, `ip_not_whitelisted_for_api_key`, `invalid_api_key`, HTTP 401/403). **Connected**: reachable and the account request succeeded. | Public part **Verified**. The authenticated part is **Proposed**: today any wallet failure (including network errors) is labelled "account auth failing", which is too coarse. |
| **PostgreSQL** | `/api/dashboard/status` → `postgres` (`db.query("SELECT 1")` with latency) | **Connected** / **Disconnected** (query threw; error text in detail) | **Verified** |
| **Webhook Readiness** | `/api/dashboard/status` → `engine` (the response key keeps its existing name `engine`; only the dashboard label changes) | **Ready**: the prerequisites listed below are all met. **Not Ready**: list each unmet prerequisite. | **Verified** as a prerequisite check only. The card label **Proposed**: `Webhook Readiness`, replacing the current label "Trading Engine". |

**Webhook Readiness definition:** the card is read-only and only reports whether the prerequisites for `POST /webhook` are in place. There is no engine process and no strategy. The current checks (`buildStatus()` in `routes/dashboard.js`) are:
- `WEBHOOK_SECRET` is set,
- `DELTA_KEY` and `DELTA_SECRET` are set,
- the Binance ETH feed state is `connected` (not `stale`, `connecting` or `disconnected`),
- the product cache is non-empty (`getProducts().length > 0`).

What "Ready" does **not** mean:
- A non-empty product cache does **not** guarantee that a suitable ETH contract (matching underlying, ATM strike, option type and nearest expiry) exists for a future signal. The cache holds every underlying, so it can be non-empty while no ETH contract matches. The card makes no ETH-contract check.
- It is **not** a guarantee that an order will execute or be accepted. The Delta key may be rejected (authentication, IP whitelist, permissions), and no order-level validation is performed.
- It does **not** mean a strategy or signal source is running or that a signal has ever been received.

The card text should read "Prerequisites met" / "Prerequisites missing: …" and must not use wording such as "Running", "Active" or "Trading".

**Missing:** no check that a suitable ETH option contract exists; no check that the Delta key is accepted for trading; no webhook activity or last-signal time.

---

## 5. Existing API Mapping

### 5.1 `GET /wallet`
- **Purpose:** Delta wallet balances for the account.
- **Implementation:** `Backend/server.js` route handler → `getWalletBalance()` in `Backend/crypto/deltaWallet.js`.
- **Response on success:** `res.json(<Delta response body>)` passed through unchanged. **Verified structure** (real response): `{ success: boolean, meta: { net_equity, robo_trading_equity, tracker_equity } (numeric strings), result: array of per-asset wallet rows }`, with 29 keys per row (listed in `DELTA_FIELD_VERIFICATION.md` §2.1). Field **meanings** remain Unverified or only partially verified (§4.1). No values are reproduced in this document on purpose.
- **Response on failure:** HTTP 500 with `{ "error": <Delta error body or message> }`. **Verified** from live failures; the Delta body observed was `{error:{code, context}, success:false}`, so the error code is at `error.error.code`.
- **Consumers:** Account Overview, Margin Overview, Delta status card.
- **Limitations:** No authentication on the route itself (existing issue). Every request to Delta is signed with a fresh timestamp, so a local clock skew of more than a few seconds makes calls fail with `expired_signature`. Before the clock was synchronized, calls failed intermittently (`expired_signature`, `ip_not_whitelisted_for_api_key`); after synchronization a successful response was captured (§13.1).

### 5.2 `GET /positions`
- **Purpose:** Open margined positions.
- **Implementation:** `Backend/server.js` → `getPositions()` in `Backend/crypto/deltaPosition.js`.
- **Response on success:** Delta body passed through. **Verified** (real response): `{ "success": true, "result": [] }`, so `result` is an **array** (empty at capture, not an object; PowerShell prints an empty array as `{}`). The account had no open positions, so **no position row has been observed**: every position row field (`size`, `entry_price`, `margin`, `unrealized_pnl`, `mark_price`, `product_id`, `product_symbol`) remains **Unverified**, and so does open-position detection (§4.3).
- **Response on failure:** HTTP 500 with the **plain text** `Position error` (the reason is only logged server-side). **Verified.**
- **Consumers:** Open Positions, Unrealized PnL, Initial Margin.
- **Limitations:** Documentation describes the endpoint (`/v2/positions/margined`) as a list of open positions and warns that changes may take up to 10 s to reflect; this is documentation only (not yet demonstrated with a non-empty response). The dashboard cannot show why this request failed. **Proposed:** the dashboard may use the `/wallet` error code as the likely reason, since both calls share the same credentials and IP.

### 5.3 `GET /api/dashboard/status`
- **Purpose:** Connectivity and readiness snapshot.
- **Implementation:** `Backend/routes/dashboard.js` → `buildStatus()`; results cached for 5 s (`STATUS_TTL_MS`).
- **Response (Verified, observed live):**
  ```
  { success: true, result: {
      binance:  { state: "connected" | "stale" | "connecting" | "disconnected", lastTickAt, ageMs },
      delta:    { ok, latencyMs, error },
      postgres: { ok, latencyMs, error },
      engine:   { ready, blockers: string[] },
      checkedAt } }
  ```
  On an unexpected failure: HTTP 500 `{ success:false, error }`.
- **Consumers:** System Status.
- **Limitations:** The `delta` field reports only public reachability, not authentication. `binance.state` is `connecting` on boot and is never retried after a drop. The `engine` field is a prerequisite check only (see §4.4, Webhook Readiness) and does not test whether a suitable ETH contract exists.

### 5.4 `GET /api/dashboard/instruments?ids=1,2,3`
- **Purpose:** Contract details and the public mark price for position product ids.
- **Implementation:** `Backend/routes/dashboard.js`. Uses `getProducts()` (`services/productCache.js`) and the public `GET {DELTA_BASE}/v2/tickers/{symbol}`. Mark prices are cached 3 s (`MARK_TTL_MS`). At most 25 ids (`MAX_IDS`). Non-integer ids are ignored.
- **Response (Verified, observed live):**
  ```
  { success: true, result: { "<id>": { symbol, underlying, optionType: "Call"|"Put"|null,
      strike, expiry, contractValue, markPrice: number|null } | null } }
  ```
  `null` for ids absent from the product cache. `markPrice` is `null` if the ticker request fails.
- **Consumers:** Open Positions.
- **Limitations:** Depends on the 5-minute product cache, so a just-listed contract may be missing. The ticker call is public (no auth).

### 5.5 Endpoints the dashboard must **not** call
`POST /order`, `GET /cancel/:id`, `GET /close/:productId`, `POST /webhook`. Note that `GET /cancel/:id` and `GET /close/:productId` mutate state via GET; the dashboard must never link to or prefetch them.

---

### 5.6 `GET /api/dashboard/settlement` (added for the currency toggle)
- **Purpose:** report the settling asset of the ETH option products, so the dashboard can match it to a wallet row by `asset_id`.
- **Implementation:** `Backend/routes/dashboard.js`, using the in-memory product cache (`getProducts()` in `services/productCache.js`). **GET only; read-only; no Delta call; no write.**
- **Response (Verified: exercised against the live product list, which returned a resolved asset id and 275 ETH option products):**
  ```
  { success: true, result: { underlying: "ETH", assetId: number|null, symbol: string|null,
      productCount: number, consistent: boolean, reason: string|null } }
  ```
  `assetId` is `null` (with `reason`) when there are no ETH option products or when they do not all share one settling asset id. There is no default asset.
- **Consumers:** Account Overview (settlement-row matching).
- **Refresh:** once on page load, then every 5 minutes (the product-cache cadence), paused while the tab is hidden. The last known value is kept if a refresh fails.
- **Limitations:** it reflects the product cache (refreshed every 5 minutes); it does not look at the wallet.

## 6. Data Field Mapping Summary

| Dashboard value | Backend source | Raw field | Verified |
|---|---|---|---|
| Settlement asset id | `/api/dashboard/settlement` | `result.assetId` (from product `settling_asset.id`) | **Yes** (all ETH options: id 14) |
| Settlement asset row | `/wallet` | the `result[]` row whose `asset_id` equals the settlement asset id (exactly one) | Yes: id join confirmed (`DELTA_FIELD_VERIFICATION.md` §9.2) |
| Wallet balance (USD mode) | `/wallet` | `result[].balance` | Partially (documented meaning; not tested with margin in use) |
| Available balance (USD mode) | `/wallet` | `result[].available_balance` (the "Free Margin" label is not assumed) | Partially |
| Wallet balance (INR mode) | `/wallet` | `result[].balance_inr` | **No: undocumented, pending verification** |
| Available balance (INR mode) | `/wallet` | `result[].available_balance_inr` | **No: undocumented, pending verification** |
| Margin used | `/wallet` | `result[].blocked_margin` (candidate; meaning not confirmed) | No |
| Position margin (wallet) | `/wallet` | `result[].position_margin` (candidate; meaning "Initial Margin" not confirmed) | No |
| Maintenance margin | `/wallet` | `result[].maintenance_margin` | No (probably absent) |
| Net equity | `/wallet` | `meta.net_equity` | No |
| Position size / side | `/positions` | `result[].size` (candidate; Long/Short and quantity semantics not confirmed) | No |
| Entry price | `/positions` | `result[].entry_price` (candidate) | No |
| Position margin | `/positions` | `result[].margin` (candidate; meaning not confirmed) | No |
| Product id / symbol | `/positions` | `result[].product_id`, `product_symbol` (candidate) | No |
| Exchange unrealized PnL | `/positions` | `result[].unrealized_pnl` (candidate) | No (may not exist) |
| Mark price | `/api/dashboard/instruments` | `result[id].markPrice` | **Yes** |
| Contract metadata | `/api/dashboard/instruments` | `symbol`, `underlying`, `optionType`, `strike`, `expiry`, `contractValue` | **Yes** |
| Binance state | `/api/dashboard/status` | `result.binance` | **Yes** |
| Delta public reachability | `/api/dashboard/status` | `result.delta` | **Yes** |
| PostgreSQL state | `/api/dashboard/status` | `result.postgres` | **Yes** |
| Engine readiness | `/api/dashboard/status` | `result.engine` | **Yes** |

**Formatting (Proposed):** currency and prices with 2 decimals and thousands separators; quantities as integers; percentages with 2 decimals and `%`; signed PnL with `+` for positive; monospace font for numbers; `N/A` for missing values; green for positive, red for negative, neutral for zero or `N/A`.

---

## 7. Live Data Refresh Requirements

| Data | Interval | Source calls | Status |
|---|---|---|---|
| Account / wallet | 10 s | `GET /wallet` | Implemented (`ACCOUNT_REFRESH_MS`) |
| Positions | 10 s | `GET /positions` (same cycle as wallet) | Implemented |
| System status | 5 s | `GET /api/dashboard/status` | Implemented (`STATUS_REFRESH_MS`) |
| Settlement asset id | On load, then 5 min | `GET /api/dashboard/settlement` (paused while the tab is hidden; last value kept on failure) | Implemented with the currency toggle. |
| Instruments | Only when needed | `GET /api/dashboard/instruments` after each positions fetch, only while ≥1 position is open | Implemented. |

Instrument refresh rules (**Proposed**):
- **Contract metadata** (`symbol`, `underlying`, `optionType`, `strike`, `expiry`, `contractValue`) may be reused by the frontend while the set of open product ids is unchanged.
- **Mark prices must continue refreshing on every positions cycle (10 s) for as long as any position is open.** They must not be frozen by metadata reuse.
- A change in the set of product ids (position opened or closed) invalidates the reused metadata.
- The existing backend caching behaviour is preserved and not part of this change: the product catalogue refreshes every 5 minutes (`refreshProducts` in `services/productCache.js`), and mark prices are cached for 3 s (`MARK_TTL_MS`) in `routes/dashboard.js`.
- No instruments request is made when no positions are open.

Behavioural requirements:

| Requirement | Status |
|---|---|
| Stop polling while `document.hidden`; refresh immediately on `visibilitychange` to visible | Implemented |
| No overlapping requests per group (`inFlight` guard in `loadAccount`, `loadStatus`) | Implemented |
| Show the last successful update time | **Partly:** one global "Updated HH:mm:ss" that updates after every attempt, **including failed ones** (`setUpdatedAt` in `loadAccount`). **Proposed:** track last-success time separately for wallet, positions and status. |
| Keep last known values during temporary failures | Implemented for wallet and positions (previous data retained, error shown above it). Status is cleared on failure. |
| Identify stale data | **Missing.** **Proposed:** a section is *stale* when its last success is older than 2 × its interval (20 s for wallet and positions, 10 s for status). Show a "Stale · last update HH:mm:ss" chip and dim the values. |
| Loading, error and empty states | See §9 |

---

## 8. UI Layout and Component Hierarchy

**Theme:** MUI `createTheme({ palette: { mode: "dark" } })` applied through a `ThemeProvider` scoped to the dashboard page, so the other pages keep their own look. Background `#0b0e14`, paper `#131722`, success (green) `#26a69a`, error (red) `#ef5350`, warning `#f5b83d`. No new UI library.

**Component hierarchy (`components/TradingDashboard.jsx`):**
```
TradingDashboard            (state, polling, data shaping)
├─ Header                   (title, "read-only", last update)
├─ Grid container
│  ├─ AccountOverview       (currency toggle + 4 Metric tiles) [lg: 6/12]
│  ├─ MarginOverview        (4 Metric tiles)         [lg: 6/12]
│  ├─ OpenPositions         (Table / empty state)    [12/12]
│  └─ SystemStatus          (4 StatusItem cards)     [12/12]
└─ shared: Section, Metric, StatusItem, ErrorNote
```
**Responsive:** one column below `lg`; Account and Margin side by side at `lg` and above; status cards 4 across at `lg`, 2 across at `sm`, 1 across below. The positions table scrolls horizontally on narrow screens (`TableContainer`).

**Hierarchy:** page title → section overline labels → large monospace metric values → small secondary captions and tooltips.

**Read-only guarantee:** no forms, inputs, links to mutating routes, or click handlers that call the backend. The only interactive control is the frontend-only USD / INR toggle (§4.1.1); it issues no requests and has no trading effect.

---

## 9. Error and Loading States

| Situation | Behaviour |
|---|---|
| First load | Skeleton placeholders on metrics; spinner in the positions panel; "Checking…" on status cards |
| `/wallet` fails, no earlier data | Error alert in Account and Margin sections with the Delta error code; metrics show `N/A` |
| First load: wallet data has arrived but the settlement id request is still pending | Account Overview financial tiles (Total Wallet Balance, Available Balance, Margin Used) stay in their skeleton/loading state; `N/A` and the "settlement unresolved" warning are **not** shown merely because settlement is pending. When it settles, the value (valid) or `N/A` with the reason (failed or inconsistent) is shown. Later settlement refresh failures keep the last known value. No extra requests. |
| Wallet loads but the settlement asset, a field, or its meaning is unconfirmed | The affected metrics show `N/A` (§4.1, §4.2). Never fall back to another asset's row or to a guessed field. |
| `/wallet` fails, earlier data exists | Keep last values, show the error alert "(showing last data)", mark section stale after 20 s |
| `/positions` fails | Error alert in the positions panel. The server returns only "Position error", so no code is shown. Last table kept if available. |
| Positions loaded, none open | "No open positions" empty state (shown only after a successful `/positions` response confirms there are none **and** open-position detection is verified, see §4.3 and §12 criterion 7); Unrealized PnL `0`; Initial Margin stays `N/A` until both the exchange field and its financial meaning are verified (§4.2). It is not taken from wallet `position_margin`. |
| Instruments call fails | Table still renders; Underlying, Type, Expiry and Mark show `N/A` |
| Status endpoint unreachable | All four cards show "Backend unreachable" in the error colour, with the error text |
| Field missing in a response | `N/A` for that value only; never `0`, `NaN` or blank |
| Delta authentication error | Delta card shows **Authentication Failed** with the error code (e.g. `expired_signature`, `ip_not_whitelisted_for_api_key`) |

Intermittent errors have occurred: before the local clock was synchronized, the same backend alternated between `expired_signature` and `ip_not_whitelisted_for_api_key` (§13.1), so a refresh could succeed or fail from one cycle to the next. The preserve-last-values rule therefore remains required behaviour, not an extra.

---

## 10. Scope Exclusions

Not part of this phase, and must not appear in the dashboard or its implementation: Trading Performance; Recent Orders; Order History; Manual Order Placement; Close Position buttons; Cancel Order buttons; trading controls of any kind; Strategy Configuration; new trading strategies; Stop-Loss or Take-Profit configuration; automated-trading modifications; a new authentication architecture; backend architecture reorganisation; a new technology stack.

---

## 11. Implementation Constraints

- Keep Express, React, Vite, MUI, axios, dayjs, `pg`, `ws` and the existing folder layout. Add no framework, library, dependency or database.
- Dashboard-specific changes are limited to: `Backend/routes/dashboard.js`, the small status telemetry in `Backend/services/priceService.js` and `Backend/crypto/ethereum.js`, the mount line in `Backend/server.js`, `Frontend/Crypto Dashboard/components/TradingDashboard.jsx`, and the `/dashboard` route in `src/App.jsx`.
- Do not change `deltaAuth.js`, `deltaOrder.js`, the `/webhook` handler, `tradingEngine.js`, `positionService.js`, or any trading behaviour.
- New backend endpoints must be GET-only, perform no writes, and call no signed Delta endpoint other than the existing wallet and position functions.
- Reuse `getWalletBalance()`, `getPositions()`, `getProducts()`, `getBinanceStatus()` and `db`.
- The Delta mark-price call is public and unauthenticated. Rate-limit risk is bounded by the 3 s cache and 25-id cap.

---

## 12. Acceptance Criteria

| # | Criterion | How to test |
|---|---|---|
| 1 | Dashboard loads at `/dashboard` | Start backend and frontend; open `/dashboard`; the page renders with no console errors; `/` and `/liveETH` still render. |
| 2 | Wallet metrics use actual backend data | With a working Delta key, compare Total Wallet Balance, Available Balance and Margin Used against the Delta web UI. Confirm no hardcoded numbers in the component. |
| 3 | Open positions display actual exchange data | With ≥1 open option, compare every column to the Delta UI and to the raw `/positions` response. |
| 4 | Margin information uses verified exchange fields | First capture a real `/wallet` and `/positions` response and confirm each margin field's name **and** meaning. Any metric whose field or meaning is not confirmed must display `N/A`. Specifically, Free Margin, Initial Margin, Margin Used and Margin Utilization show `N/A` until confirmed. |
| 4a | Settlement asset is confirmed, not guessed | The dashboard shows exactly one confirmed asset's balances, with its symbol in the title. With a wallet containing several assets, no other asset's values appear and nothing is summed across assets. With no confirmed asset, wallet metrics show `N/A`. |
| 4b | Position side and quantity are not invented | Side and Quantity show `N/A` until their semantics are confirmed against a real response; afterwards they match the Delta UI for both a long and a short position. |
| 5 | System status reflects actual connectivity | Stop PostgreSQL → card shows Disconnected within 10 s. Block `wss://stream.binance.com` or kill the stream → card shows Disconnected or stale. Use a bad `DELTA_KEY` → card shows **Authentication Failed**. Unset `WEBHOOK_SECRET` → **Webhook Readiness** shows Not Ready with that reason. |
| 5a | Webhook Readiness is only a prerequisite check | The card is labelled `Webhook Readiness`, contains no controls, and its text never claims that trading, a strategy or order execution is active or guaranteed. |
| 6 | Refresh follows the intervals | In browser devtools → Network, `/wallet` and `/positions` repeat every ~10 s and `/api/dashboard/status` every ~5 s. |
| 7 | Empty positions handled | "No open positions" is displayed **only after a successful `/positions` response confirms there are no open positions, using an open-position detection rule that has been verified (§4.3)**. If detection is unverified, the panel shows the unverified / `N/A` state instead. When the empty state applies, the table is replaced by the message, Unrealized PnL shows `0`, and no instruments request is sent. |
| 7a | API failure is never shown as an empty portfolio | When `/positions` fails (HTTP error, timeout, Delta authentication or IP error, backend unreachable) and no earlier successful data exists, the panel shows an error state and Unrealized PnL shows `N/A`, never "No open positions" or `0`. When earlier data exists, the last known table is kept with the error and stale marker (§7, §9). Test by making `/positions` fail on first load and after a successful load. |
| 8 | API failures are displayed | Make `/wallet` return an error (e.g. wrong key): the alert shows the Delta error code. Stop the backend: all status cards show "Backend unreachable". |
| 9 | Stale data is identified | Break `/wallet` after a good load; within 20 s the section shows the "Stale" marker with the last successful time and keeps the last values. |
| 10 | No trading actions available | Review the component: no buttons, forms or calls to `/order`, `/cancel`, `/close`, `/webhook`. |
| 11 | Existing functionality unaffected | `/api/market-data`, `/webhook`, `/order`, `/wallet`, `/positions` respond as before; `git diff` shows no change to trading files (§11). |
| 12 | No new frameworks, libraries or databases | `git diff` of both `package.json` files and lockfiles is empty. |
| 12a | Mark prices keep refreshing while positions are open | With ≥1 open position, `/api/dashboard/instruments` is requested every ~10 s and Mark Price updates; contract metadata may be reused while product ids are unchanged. |
| 13 | Polling pauses when the tab is hidden | Switch tabs for 30 s; no requests appear in the Network log; on return one immediate refresh occurs. |
| 14 | No overlapping requests | Throttle the network to slow; no second `/wallet` call starts before the first finishes. |
| 15 | PnL is exchange-provided or `N/A` | No position shows a PnL calculated by the frontend (applies once the fallback in §4.3 is removed). |
| 16 | Currency toggle defaults to USD and shows one currency at a time | Load `/dashboard`: the toggle shows USD selected; `$` appears and `₹` does not. Switch: `₹` appears and `$` does not. Reload: back to USD. |
| 17 | Settlement row is matched by asset id, never by position or balance | With wallet rows reordered, with the matching row at zero balance, or with another row non-zero, the same row (matching `asset_id`) is used. Zero or two matches, or an unresolved settlement id, show `N/A`. |
| 18 | INR values come directly from the API fields, with no conversion | A fixture whose `*_inr` fields are not 85× the USD fields displays the `*_inr` values unchanged. A missing `*_inr` field shows `N/A` in INR mode only. The code contains no exchange-rate constant or multiplication. |
| 19 | Switching currency makes no network request | In the browser Network log, the request count to `localhost:3000` is unchanged immediately after clicking the toggle. Polling continues unchanged in either mode. |
| 20 | INR fields are marked unverified | In INR mode the "INR fields unverified" marker is visible; in USD mode it is not. |
| 21 | Settlement endpoint is GET-only and read-only | `POST/PUT/DELETE /api/dashboard/settlement` return 404; returns `assetId: null` for an empty or mixed product list. |

**Status of the live-data criteria (updated 2026-11-08).** Live `/wallet` and `/positions` responses have now been observed (§13.1): their **structures** are verified (the wallet has one row per asset with the fields listed in §4.1; positions returned an empty array). The criteria themselves are unchanged. What can and cannot be checked today:
- **Criterion 2** (wallet metrics use actual backend data): can be checked for the Total Wallet Balance and Available Balance tiles (settlement-row match, USD and INR fields; see criteria 16–20). Margin Used stays `N/A`, so it cannot pass as written until its field **and** meaning are verified.
- **Criterion 3** (open positions display actual exchange data): **cannot yet be passed.** No open position has been observed, so position row fields and open-position detection remain unverified (§4.3, §5.2).
- **Criterion 4** (margin information uses verified exchange fields): **cannot yet be passed.** The field **meanings** are unverified or only partially verified, and a capture with margin in use is still outstanding (§13.1).
- **Criteria 4a and 4b**: 4a is now satisfied in structure by settlement-id matching (criterion 17), but the settlement-asset and margin meanings stay partially verified. 4b (position side and quantity) **cannot yet be passed**: no position row has been observed.

Criteria 9 (stale-data handling) and 15 (no frontend-calculated PnL) do not depend on a live response and can be tested independently with controlled test data.

---

## 13. Unverified Assumptions and Dependencies

### 13.1 Live account data: status (updated 2026-11-08)
**History.** Earlier calls to `GET /wallet` on the running backend failed intermittently, in no fixed order, with:
- `expired_signature`: the local PC clock was about 6 seconds ahead of Delta's (`request_time` versus `server_time` in the error context). Delta rejects signatures from a skewed clock.
- `ip_not_whitelisted_for_api_key`: the API key rejected the machine's public IP at that time (the address is intentionally not recorded here).

`GET /positions` failed with its generic "Position error" during the same period.

**Current state.** After the Windows clock was synchronized, `GET /wallet` and `GET /positions` returned successful responses. Their structures are now **verified** (§5.1, §5.2; details in `DELTA_FIELD_VERIFICATION.md`). No example response is included in this document on purpose, because live responses contain account identifiers and balances.

**Still outstanding (these keep the corresponding fields Unverified):**
1. A `GET /positions` response with an **open position** (long and short): position fields, size semantics and open-position detection are unobserved.
2. A `GET /wallet` response with **margin in use** (an open position or resting order): the meanings of `available_balance`, `blocked_margin`, `position_margin`, `order_margin` and `net_equity` cannot be told apart from a zero-margin account.
3. Confirmation of the `*_inr` fields, which are undocumented.
4. Ongoing requirements: keep the Windows clock synchronized (a skew over about 5 s breaks signatures) and keep the machine's public IP whitelisted on the Delta API key.

### 13.2 Unverified assumptions
- All Delta wallet fields in §4.1/§4.2/§6, including which asset row is the settlement asset, the `meta.net_equity` location and whether `maintenance_margin` exists.
- All margined-position fields in §4.3/§6, including how Long/Short is encoded, the unit and sign of `size`, and the existence of `unrealized_pnl` and `mark_price` on position rows. **No position-side semantics are assumed.**
- **Not assumed:** that `blocked_margin`, `position_margin` or `available_balance` mean "Margin Used", "Initial Margin" or "Free Margin". Each is only a candidate and its metric shows `N/A` until confirmed.
- That any margin utilization formula (such as `blocked_margin ÷ balance`) is meaningful. None is adopted.
- That there is a verified method to convert between wallet assets. None exists, so cross-asset totals are not allowed.
- Option PnL definition and contract-value units (relevant only while the calculated fallback in the current code exists; the spec requires exchange-provided PnL only).
- That the public `/v2/tickers/{symbol}` `mark_price` is the mark price Delta uses for PnL.
- That `GET /v2/assets` is an appropriate public health probe (it responded in testing).

### 13.3 Missing functionality
- Per-section last-success and stale tracking.
- A distinct Authentication Failed status.
- Binance WebSocket reconnect (a dropped feed stays disconnected until restart).
- Authentication on the dashboard's backend routes (and on `/wallet`, `/positions`): anyone who can reach port 3000 can read them.
- A configurable API base URL (hardcoded `http://localhost:3000`).
- Any check of whether the Delta key has trade permission.
- Any check that a suitable ETH option contract exists for a future signal (Webhook Readiness only tests that the product cache is non-empty).
- ~~A confirmed settlement asset in the dashboard~~ Resolved by settlement-id matching (§4.1, §5.6). The **display unit** question is resolved by the USD / INR toggle (§4.1.1).
- Verification of the `*_inr` fields (`balance_inr`, `available_balance_inr`): they are undocumented. They are used only because the toggle was approved, they are clearly marked pending verification, and nothing is converted.

### 13.4 Known data caveat
`productCache` holds contracts for every underlying (the live check returned XAUT options), so the dashboard must not assume positions are ETH-only. The "Underlying" column exists for this reason.
