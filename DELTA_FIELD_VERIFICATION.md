# DELTA_FIELD_VERIFICATION.md: Delta `/wallet` and `/positions` response verification

Investigation only. No source file, `dashboardFieldMap.js` or `DASHBOARD_SPEC.md` was changed. No account values, identifiers or credentials appear in this report. It records types, key names and relationships only.

## 1. How the data was captured

| Item | Detail |
|---|---|
| Date | 2026-11-08, after the Windows clock was synchronized |
| Source | The project's own backend: `GET http://localhost:3000/wallet` and `GET http://localhost:3000/positions`. These pass Delta's response body through unchanged (`Backend/server.js`, `getWalletBalance()` / `getPositions()`). |
| Target | Delta Exchange India (`DELTA_BASE` host `api.india.delta.exchange`) |
| Result | Both requests returned HTTP 200 with `success: true` on the first try. |
| Serialization | Raw JSON saved byte-for-byte with `curl -o`, then parsed with `node`. PowerShell table formatting was not used. |
| Raw captures | The two raw JSON responses were saved as temporary local files outside the repository for analysis. They contained account identifiers and balances, so they were deleted after the analysis and were never committed. Only key names, types and relationships are recorded in this report. |

## 2. Actual response shapes

### 2.1 `GET /wallet`
```
{ success: boolean,
  meta:   { net_equity: string, robo_trading_equity: string, tracker_equity: string },
  result: array[7] of wallet rows }
```
- `result` holds **7 rows**, one per asset. The `asset_symbol` values are `USD`, `INR`, `REF_USD`, `BTC`, `ETH`, `SOL`, `XRP`, and each appears exactly once.
- Each row has the same 29 keys: `id` (number or null), `balance`, `user_id`, `asset_id`, `asset_symbol`, `interest_credit`, `commission`, `referral_bonus`, `available_balance`, `unvested_amount`, `lien_amount`, `position_margin`, `order_margin`, `portfolio_margin`, `strategy_blocked_amount`, `cross_position_margin`, `cross_order_margin`, `cross_commission`, `cross_locked_collateral`, `cross_asset_liability`, `binary_credits_available`, `binary_credits_balance`, `binary_credits_invested`, `pending_referral_bonus`, `pending_trading_fee_credit`, `trading_fee_credit`, `blocked_margin`, `balance_inr`, `available_balance_inr`.
- All monetary fields, and all three `meta` fields, are **numeric strings**, not JSON numbers.
- `id` is `null` on 5 of the 7 rows (`REF_USD`, `BTC`, `ETH`, `SOL`, `XRP`).
- **Only the USD row has non-zero values.** The other six rows are all zeros, including `balance`.
- No `maintenance_margin` key exists in any row or in `meta`.

### 2.2 `GET /positions`
```
{ "success": true, "result": [] }
```
- `result` is an **empty array** (`[]`), not an empty object. PowerShell prints an empty array as `{}`, which explains the earlier observation.
- The account had **no open positions** at capture time, so no position row has ever been observed.

## 3. Comparison with DASHBOARD_SPEC.md

| Spec statement | Actual response | Verdict |
|---|---|---|
| §5.1: `/wallet` returns `result` as an array of per-asset rows, optionally with `meta` | Matches | Structure confirmed |
| §4.1: the wallet response holds one row per asset, so one settlement asset must be confirmed and no first-row fallback used | Confirmed: 7 asset rows, 5 of them with `id` null | The spec's rule stands. The settlement asset is **still unconfirmed**. |
| §4.1 / §6: `meta.net_equity` | Present at `meta.net_equity`, a numeric string | Location confirmed. Meaning and denomination unverified (see §5). |
| §4.2: `maintenance_margin` "believed not returned" | Confirmed absent from every row and from `meta` | The spec's expectation of `N/A` is correct. |
| §5.2: `/positions` returns `result[]` | `result` is an array | Confirmed |
| §4.3: position fields (`size`, `entry_price`, `margin`, `product_id`, `product_symbol`, `unrealized_pnl`, `mark_price`) | No row observed | Still unverified against a real response |
| §4.3 / §13: open-position detection must not assume non-zero `size` | Empty array observed; nothing to test against | Rule stands. Documentation says the endpoint lists only open positions (see §5), but a real open position has not been seen. |
| §4.2 candidate for per-wallet margin: `position_margin`, `blocked_margin`, `available_balance` | All three keys exist on every row | Existence confirmed. Meaning unverified. |

No discrepancy found that requires changing the spec. One spec-adjacent fact: the real wallet response has **no** `available_balance_for_robo` key, although the Delta documentation example includes it.

## 4. Field verification table

Status key: **Present** = exists in the real response with the stated type. **Meaning** = what it financially represents, and its currency or unit. Nothing is marked "Verified" for meaning unless the real response and documentation together establish it.

### 4.1 Envelope and `meta`

| Field | Actual location | Example type | Status | Evidence | Remaining questions |
|---|---|---|---|---|---|
| `success` | top level, both endpoints | boolean | Present: Verified | Real responses | None |
| `result` (wallet) | top level | array of 7 objects | Present: Verified | Real response | None |
| `result` (positions) | top level | array, length 0 | Present: Verified (empty array) | Real response; docs describe an array | Contents of non-empty rows unobserved |
| `meta` | `/wallet` top level | object | Present: Verified | Real response | None |
| `meta.net_equity` | `/wallet` → `meta` | numeric string | Present: Verified. Meaning: **Unverified** | Real response. Docs (WalletMetaData, as fetched): "Net equity for robo trading". In this capture it is numerically equal to the USD row's `balance`, while no margin is in use. | Is it account-wide net equity or robo-trading equity only? Which currency? It is not documented. |
| `meta.robo_trading_equity` | `/wallet` → `meta` | numeric string | Present: Verified. Meaning: Unverified | Real response; docs: "trading equity for robo trading" | Not needed by the dashboard; unit unknown |
| `meta.tracker_equity` | `/wallet` → `meta` | numeric string | Present: Verified. Meaning: **Unverified** | Real response only; not found in the fetched documentation | Undocumented |

### 4.2 Wallet row fields (`/wallet` → `result[]`)

| Field | Example type | Status | Evidence | Remaining questions |
|---|---|---|---|---|
| `asset_symbol` | string | Present: Verified | Real response (unique per row) | Which wallet row relates to ETH options? The product API links them by `asset_id` (see §9.2). Which unit to display is still a **user decision**; not chosen here. |
| `asset_id` | number | Present: Verified | Real response | None |
| `id` | number or null | Present: Verified | Real response (null on 5 rows) | Meaning of null not documented; not used by the dashboard |
| `balance` | numeric string | Present: Verified. Meaning: partly documented | Docs (Wallet schema, as fetched): "Total wallet balance". No currency stated. | Is it denominated in the row's own asset? Does it include unrealized PnL? |
| `available_balance` | numeric string | Present: Verified. Meaning: partly documented | Docs: "Balance available for trading". In this capture it equals `balance` while all margin fields are zero. | Whether it is the correct "Free Margin" is **not established**. Needs a capture with margin in use. |
| `blocked_margin` | numeric string | Present: Verified. Meaning: partly documented | Docs: "Total blocked margin including commissions for all modes". Zero in this capture. | Whether it equals "Margin Used" as the dashboard defines it is **not established**. Needs a capture with margin in use. |
| `position_margin` | numeric string | Present: Verified. Meaning: partly documented | Docs: "Margin blocked in open positions in isolated mode". Zero in this capture. | Isolated mode only, so it may exclude cross-margin positions. Whether it is the dashboard's "Initial Margin" is **not established**. |
| `order_margin` | numeric string | Present: Verified. Meaning: **Unverified** | Docs text for this field is the same wording as `position_margin` ("... for open positions in isolated mode"), which may be a documentation copy error. | Real meaning is unclear |
| `portfolio_margin` | numeric string | Present: Verified. Meaning: partly documented | Docs: "Total margin blocked including commissions in portfolio margin mode" | Applicability to this account unknown |
| `cross_position_margin` | numeric string | Present: Verified | Docs: "margin blocked for open positions in Cross margin mode" | Same |
| `cross_order_margin` | numeric string | Present: Verified | Docs: "margin blocked for open orders in Cross margin mode" | Same |
| `cross_locked_collateral` | numeric string | Present: Verified | Docs: "collateral blocked in Cross margin mode" | Same |
| `balance_inr`, `available_balance_inr` | numeric string | Present: Verified. Meaning: **Unverified** | Real response only (non-zero on the USD row). Not found in the fetched documentation. | Presumably an INR conversion, but the rate source and timing are undocumented. Not part of the dashboard spec. |
| `maintenance_margin` | n/a | **Absent**: Verified | Not present in any row or in `meta` (29 keys listed in §2.1) | Dashboard must keep showing `N/A` unless another verified field is chosen |
| `lien_amount`, `strategy_blocked_amount`, `interest_credit`, `commission`, `referral_bonus`, `unvested_amount`, `cross_commission`, `cross_asset_liability`, `binary_credits_*`, `pending_referral_bonus`, `pending_trading_fee_credit`, `trading_fee_credit`, `user_id` | numeric string (`user_id`: number) | Present: Verified. Meaning: not examined | Real response. Not used by the dashboard. | None for this phase |

### 4.3 Position fields (`/positions` → `result[]`), none observed

| Field | Actual location | Example type | Status | Evidence | Remaining questions |
|---|---|---|---|---|---|
| `size` | `result[].size` | integer (per docs) | **Unverified** against a real response | Docs (Position schema, as fetched): "Position size, negative for short and positive for long" | Confirm on a real open long and short position. Whether quantity is in contracts is not stated. |
| `entry_price` | `result[].entry_price` | string (per docs) | **Unverified** | Docs list the field with no description | Currency/unit |
| `margin` | `result[].margin` | string (per docs) | **Unverified** | Docs list the field with no description | Whether it is initial margin; margin mode dependence |
| `unrealized_pnl` | `result[].unrealized_pnl` | string (per docs) | **Unverified** | Docs: "Unrealized pnl on the open position, marked to the current mark price" | Whether it is present for option positions; currency |
| `mark_price` | `result[].mark_price` | string (per docs) | **Unverified** | Docs: "Current mark price used to value the position" | Whether present for option positions |
| `product_id` | `result[].product_id` | integer (per docs) | **Unverified** | Docs list the field with no description | Matches the product cache `id` for lookups |
| `product_symbol` | `result[].product_symbol` | string (per docs) | **Unverified** | Docs list the field with no description | None |
| open vs closed rows | whole `result` | n/a | Documentation only: **Unverified** | Docs: `GET /v2/positions/margined` returns the "List of all open positions". A real open position has not been seen, and whether zero-size rows can appear has not been observed. | Capture a response with an open position, and one after closing it |
| freshness | n/a | n/a | Documentation only | Docs note: "Change in position may take upto 10secs to reflect. Use 'GET /position' for real-time data." | The 10 s dashboard refresh may lag a just-opened or just-closed position by up to 10 s. Not a defect. |

## 5. Documentation evidence and its limits

- **Source:** Delta's public API reference at `docs.delta.exchange` (the single-page API docs). The page is about 336,000 characters, so it was read in four chunks through a summarizing fetch tool. The quotations above are as reported by that tool. They have not been compared character by character with the page, and the tool noted that the Wallet endpoint's "Response Schema" tables in the endpoint section are empty. **Treat them as strong hints, not as a verified specification.** The authoritative wording should be read directly in the browser before any mapping is finalised.
- **Denomination:** the fetched documentation does **not** state a currency or unit for any wallet or position amount. This is an open question, not a verified fact.
- **Documentation example mismatch:** the documented example includes `available_balance_for_robo`, which the real response does not contain. The real response includes fields the fetched documentation does not describe (`balance_inr`, `available_balance_inr`, `tracker_equity`).

## 6. Observations from the real wallet capture

These are relationships only, with no values:
- `meta.net_equity` equals the USD row's `balance`.
- The USD row's `available_balance` equals its `balance`.
- Every margin-type field on the USD row is zero, and all six other rows have a zero `balance`.

Because nothing is currently blocked or in use, this capture **cannot distinguish** the meanings of `available_balance`, `blocked_margin`, `position_margin` and `net_equity`. A capture with an open position or a resting order is needed.

## 7. What this does and does not change

- The structures in `DASHBOARD_SPEC.md` §5.1 and §5.2 are now **confirmed** by real responses (wallet: object with `meta` and a 7-element `result` array; positions: an array, currently empty).
- Every field-meaning mapping in the dashboard stays **Unverified**. Nothing in this report authorises filling `dashboardFieldMap.js`, and no `N/A` safeguard should be removed yet.
- The dashboard's current behaviour for this account is consistent with the real responses: wallet and margin tiles show `N/A`, and the positions panel shows "Open-position detection is not verified … returned 0 row(s)".

## 8. Open questions before any mapping is finalised

1. **Settlement asset (your decision):** which wallet asset do the options settle in? Seven rows exist (`USD`, `INR`, `REF_USD`, `BTC`, `ETH`, `SOL`, `XRP`); the code must not pick one automatically.
2. **Margin meanings:** after a capture with margin in use, can `available_balance` be called Free Margin, `blocked_margin` Margin Used, and `position_margin` (isolated only) Initial Margin? Is the account in isolated, cross or portfolio margin mode?
3. **`net_equity`:** does it cover the whole account or robo trading only? In which currency?
4. **Denomination:** which currency applies to each monetary field?
5. **Position semantics:** capture a response with an open long and an open short option to confirm `size` sign and unit, and to see `entry_price`, `margin`, `unrealized_pnl`, `mark_price`, `product_id` and `product_symbol`.
6. **Open-position detection:** confirm that closed or zero-size positions never appear in `/v2/positions/margined`.
7. **Cross-check:** compare each value with the Delta web UI at the same moment.
8. Read the Wallet and Position schema sections directly on `docs.delta.exchange`, since the summarizing tool left the endpoint tables incomplete.

*Round 2 (§9 onwards) answers parts of questions 1 and 4 and narrows questions 2, 3, 5 and 6. Its open questions are in §9.7.*

---

# Round 2: ETH option contract, settlement currency and field meanings

Investigation only. No code, `dashboardFieldMap.js`, `DASHBOARD_SPEC.md` or trading logic was changed, and no orders were placed or any other write call made. Only these read calls were made:
- the public, unauthenticated `GET /v2/products?contract_types=call_options,put_options`, `GET /v2/products/{id}` and `GET /v2/assets`;
- the earlier `/wallet` capture (reused, not re-fetched for values);
- Delta documentation pages.

## 9. Findings

### 9.1 The ETH option contract, from the product API (real response)
Source: Delta's public `/v2/products` response (the same list the backend's product cache loads). At capture time it contained 837 option products: 514 BTC, 275 ETH, 48 XAUT. The single-product endpoint `GET /v2/products/{id}` returned the same settling asset as the list.

| Product field | Value for **all 275 ETH options** (calls and puts) | Status |
|---|---|---|
| `contract_type` | `call_options` or `put_options` | Verified |
| `underlying_asset` | `ETH` (asset id 12) | Verified |
| `contract_unit_currency` | `ETH` | Verified |
| `contract_value` | `"0.01"` (string): one contract is 0.01 ETH | Verified |
| `quoting_asset` | asset id **14**, symbol `USD`, name "US Dollar" | Verified |
| `settling_asset` | asset id **14**, symbol `USD`, name "US Dollar" | Verified |
| `notional_type` | `vanilla` | Verified |
| `is_quanto` | `false` | Verified |
| `tick_size` | `"0.01"` | Verified |
| `strike_price`, `settlement_time` | numeric string; ISO timestamp (for example `2026-11-10T12:00:00Z`) | Verified |
| symbol pattern | `C-ETH-<strike>-<DDMMYY>` / `P-ETH-<strike>-<DDMMYY>` | Verified by observation |
| `state` / `trading_status` | `live` / `operational` | Verified (at capture time) |
| Product-level margin parameters | `initial_margin`, `maintenance_margin`, `initial_margin_scaling_factor`, `maintenance_margin_scaling_factor`, `default_leverage`, `max_leverage_notional` | Present. These are **product settings, not account margin values**, and are not meant for the dashboard's account metrics. |

All 837 option products, including BTC and XAUT, use the same settling asset (id 14, `USD`).

**Documentation for these fields:**
- The API reference defines "Settling Asset" as "The asset in which the margin and Profit/ Loss of a contract is denominated."
- It describes `vanilla` as "Contract is quoted, settled, and margined in the quote currency."
- Together with the product response, these indicate that ETH options are quoted, margined and settled in the asset with id 14.

### 9.2 How the settlement currency relates to the wallet rows
- **Join key (verified):** the product's `settling_asset.id` (14) equals the `asset_id` of exactly one wallet row, the row whose `asset_symbol` is `USD`. No other wallet row has that id. The wallet rows are per asset (the API reference describes the wallet array as "Array of wallet for every asset").
- **This link comes from the product data, not from balances or guesswork.** The other six rows (including `INR`, id 204) were not selected or excluded on the basis of their amounts.
- **Important caveat on currency (Delta India documentation):**
  - Delta India's options page says: "All contracts on Delta Exchange India are notionally quoted, margined and settled in USD." It then says the USD-INR rate is "fixed", that "your balances are always maintained in INR", that "no INR/ USD conversion ever takes place", and concludes "all contracts on Delta Exchange India are effectively being margined and settled in INR."
  - In the wallet response, the USD row's `balance_inr` and `available_balance_inr` are exactly 85.0000 times its `balance` and `available_balance`. This is derived from the capture (no values shown here), and the documentation does not state the rate's value.
  - Reading these together: the API exposes amounts in USD-notional units on the USD row, with fixed-rate INR equivalents in the `*_inr` fields. The documentation describes the user's real balance as INR. The API does not say which of the two the Delta web UI shows.
- **Not decided here:** which unit the dashboard should show (USD-notional or the `*_inr` fields), and whether `balance_inr` should be used. That is the user's decision, and it affects labelling and currency symbols.

### 9.3 Meanings and units of the six requested fields
Sources: (a) Delta API reference, Wallet and WalletMetaData schemas, as read through a summarizing fetch (see §5 caveat); (b) Delta user guide "Margining Explainer". **Nothing is inferred from the zero-margin account**: all margin-type fields on the USD row were zero at capture, so the capture cannot confirm any of these meanings (see §6).

| Field | Documentation says | Units | Conflicts / gaps | Status |
|---|---|---|---|---|
| `balance` | API reference: "Total wallet balance". The user guide never defines "Wallet Balance", it only says position and order margin are "allocated from your Wallet Balance". | Per wallet asset row. For the row with `asset_id` 14, USD-notional (§9.2). No explicit unit in the docs. | Not stated whether unrealized PnL is included. | **Partially verified** |
| `available_balance` | API reference: "Balance available for trading". User guide: "the amount that remains unallocated is what is available for placing a new order. This is referred to as Available Balance." | same | Two independent sources agree. Not confirmed with margin in use. Whether it should be labelled "Free Margin" is a labelling choice Delta does not make. | **Partially verified** |
| `blocked_margin` | API reference: "Total blocked margin including commissions for all modes". The user guide has no "Blocked Margin" term. | same | Not confirmed that it equals position + order margin + commission. Not confirmed with margin in use. | **Partially verified** |
| `position_margin` | API reference: "Margin blocked in open positions in isolated mode". User guide: "Margin allocated to all existing (may include multiple long/ short positions) in given derivatives contract". | same | Covers **isolated mode only**. The guide separates this from "Initial Margin", which it defines as "the amount required to enter into a new position". Position margin can exceed initial margin (for example after auto top-up), so it is **not** the same quantity. | **Partially verified** as "position margin"; **Unverified** as "Initial Margin" |
| `order_margin` | API reference: "margin blocked for open positions in isolated mode" (identical wording to `position_margin`). User guide: "Margin allocated to all open orders in a given derivatives contract". | same | **The two sources conflict.** The reference text looks like a copy of the `position_margin` line. | **Unverified** (conflict) |
| `net_equity` (`meta.net_equity`) | API reference (WalletMetaData): "Net equity for robo trading". No account-level definition found. The user guide does not define equity or net equity. | No unit stated | Documented as specific to robo trading. Its value matching the USD row's `balance` in this zero-margin capture proves nothing about its definition. | **Unverified** for account-level use |

Also documented (not requested): `commission` is "Commissions blocked in Isolated Mode", and `unvested_amount`, `interest_credit` and the other fields have short descriptions. The `*_inr` fields and `tracker_equity` have no documentation in the pages read.

### 9.4 Are these fields appropriate for account-level dashboard metrics?

| Dashboard label | Candidate field | Assessment |
|---|---|---|
| Total Wallet Balance | `balance` | Appropriate **for one confirmed asset row**. Not appropriate as a cross-asset total (the API is per asset and no conversion method is documented). |
| Available Balance | `available_balance` | Appropriate for one confirmed asset row. The meaning ("available for trading / for placing a new order") is documented twice. |
| Free Margin | `available_balance` | Possible, but "Free Margin" is not a Delta term. Delta's term is Available Balance. Treat the label as a decision, not a fact. |
| Margin Used | `blocked_margin` | The best documented candidate ("total blocked margin ... for all modes"), but unconfirmed with margin in use. `position_margin` and `order_margin` are isolated-mode only and would under-report if the account used cross or portfolio margin. |
| Initial Margin | `position_margin` | Not appropriate. Different concept (§9.3) and isolated-only. |
| Maintenance Margin | none | No account-level field exists in the wallet response (confirmed absent). The `maintenance_margin` on products is a product setting, not an account value. Stay `N/A`. |
| Margin Utilization | derived | Delta publishes no formula. A ratio such as `blocked_margin ÷ balance` would be this project's own definition. Stay `N/A` unless the user approves and documents one. |
| Net equity (subtitle) | `meta.net_equity` | Not appropriate until Delta confirms it is account-level and not robo-trading equity. |

The account's margin mode (isolated, cross or portfolio) is **unknown**. Delta's guide says the platform uses isolated margin by default, and the reference lists "Change margin mode" and portfolio margin as features. Determining the mode would need another API call that was not made here.

### 9.5 Is `GET /positions` an open-position endpoint?
- **What the project calls:** `Backend/crypto/deltaPosition.js` → `getPositions()` → `GET {DELTA_BASE}/v2/positions/margined` (verified in code).
- **Documentation (API reference, as fetched):** "Get margined positions" returns a "List of all open positions", as an array (`ArrayOfPositions`: an array of Position objects). A separate `GET /v2/positions` returns a single object for one `product_id` ("Open position for the give product id"). A note says: "Change in position may take upto 10secs to reflect. Use 'GET /position' for real-time data."
- **Real response:** `{ "success": true, "result": [] }`, with no open positions on the account at capture time.
- **Conclusion:** the endpoint is documented as returning open positions, and an empty array is consistent with zero open positions. This is **documentation plus one consistent observation, not a demonstrated case**. I did not and must not place a test trade to produce a non-empty response. Therefore:
  - an empty array is **likely** to mean "no open positions";
  - it is **not yet proven**, and the empty array may lag reality by up to 10 s;
  - the dashboard's current "detection not verified" wording remains correct until a real open position (and ideally a closed one) has been observed.
- **Unresolved:** whether "margined" excludes some product types (it is not stated that options positions are included), and whether zero-size rows can ever appear.

### 9.6 Corrections and additions to Round 1
- §4.2 `asset_symbol`: the "settlement asset" question now has product-API evidence (§9.2). The unit and display choice remains open.
- `order_margin`: the conflict is now documented between two Delta sources (§9.3).
- Documentation sources are listed in §9.8.

### 9.7 Unresolved questions
1. **Display unit (your decision):** show the USD-notional values from the USD row, or the `*_inr` fields? Delta India states balances are "always maintained in INR" at a fixed rate. What does the Delta web UI show?
2. **Margin mode** of the account (isolated, cross or portfolio), since several fields are isolated-only.
3. **Margin fields with margin in use:** `blocked_margin`, `position_margin`, `order_margin` and `available_balance` still need a capture with an open position or a resting order (made by you in the normal way, not by me), compared with the Delta UI.
4. **`order_margin` meaning:** reference text versus user guide.
5. **`net_equity`:** account-level or robo-only? Currency?
6. **Whether `balance` includes unrealized PnL.**
7. **Positions endpoint:** that options positions are included, that closed/zero-size rows never appear, and the position row fields (`size`, `entry_price`, `margin`, `unrealized_pnl`, `mark_price`, `product_id`, `product_symbol`) on a real open position.
8. **Labels:** whether the dashboard should use Delta's terms (Available Balance, Position Margin, Order Margin, Blocked Margin) instead of Free/Initial/Maintenance Margin. This would be a spec decision for later.
9. Documentation was read through summarizing tools. The Wallet and Position schema text should be read directly on the Delta site before mappings are finalised.

### 9.8 Sources
- Delta public API (real responses): `GET /v2/products?contract_types=call_options,put_options`, `GET /v2/products/{id}`, `GET /v2/assets`.
- [Delta Exchange API reference](https://docs.delta.exchange/) (Definitions, Products enums, Wallet / WalletMetaData / Position schemas, Get margined positions).
- [Delta Exchange India user guide: Options contracts](https://www.delta.exchange/user-guide/docs/tutorials/options-contracts/) (USD notional quote, fixed USD-INR rate, INR balances).
- [Delta Margining Explainer](https://delta-exchange.github.io/user-guide/docs/trading-guide/margin-explainer) (Available Balance, Position Margin, Order Margin, Initial Margin, isolated margin).
- Web search results also surfaced an INR-versus-USD settlement discrepancy between Delta pages (§9.2). The India options page quoted above reconciles it as "notionally USD, effectively INR".

## 10. Final classification

### VERIFIED (confirmed by real API responses, with Delta documentation consistent)
- `/wallet` envelope (`success`, `meta`, `result`) and 7 per-asset rows; all monetary fields and `meta` fields are numeric strings; the 29 row keys; `meta.net_equity`, `robo_trading_equity` and `tracker_equity` exist.
- `maintenance_margin` does **not** exist in the wallet response.
- `/positions` envelope with `result` an array (empty at capture).
- ETH option product facts (§9.1): underlying ETH, `contract_unit_currency` ETH, `contract_value` 0.01, `notional_type` vanilla, not quanto, quoting asset and settling asset id 14 (`USD`). All 837 option products share this settling asset.
- Join key: product `settling_asset.id` equals wallet row `asset_id` (14, the `USD` row).
- The `*_inr` wallet fields equal the USD-row amounts times a fixed 85 (derived from the response).
- The dashboard's `/positions` call goes to `/v2/positions/margined` (code).

### PARTIALLY VERIFIED (structure confirmed; meaning or unit rests on documentation only)
- `balance`: "Total wallet balance"; unit per asset row (USD-notional here); inclusion of unrealized PnL unknown.
- `available_balance`: "Balance available for trading" (two sources agree); the "Free Margin" label is a project choice.
- `blocked_margin`: "Total blocked margin including commissions for all modes"; not tested with margin in use.
- `position_margin`: "Margin blocked in open positions in isolated mode"; isolated-only, and not the same concept as Initial Margin.
- Settlement currency: product API says USD; Delta India documentation says notionally USD and effectively INR at a fixed rate.
- Suitability of `balance`, `available_balance` and `blocked_margin` for **single-asset** account-level metrics.
- `GET /positions` (margined) is documented as an open-positions list, and `[]` is consistent with none open (1 observation; up to 10 s lag).

### UNVERIFIED
- `order_margin` (the two Delta sources conflict).
- `net_equity` as an account-level figure (documented as robo-trading equity), and `tracker_equity`.
- Any mapping to the dashboard labels Initial Margin, Margin Used, Free Margin, Margin Utilization and account-level Maintenance Margin.
- All position row fields (`size` sign and unit, `entry_price`, `margin`, `unrealized_pnl`, `mark_price`, `product_id`, `product_symbol`) on a real open position.
- That options positions are included in `/v2/positions/margined`, and whether zero-size rows can appear.
- The account's margin mode.
- The display unit (USD-notional versus INR).
- The meaning of the `*_inr` fields beyond the observed fixed multiple.

No field mapping in `dashboardFieldMap.js` should be filled until the relevant items above move to Verified.


---

## 11. Decision record: USD / INR currency toggle (approved)

- **Settlement row:** identified dynamically. The new read-only `GET /api/dashboard/settlement` returns the settling asset id shared by all ETH option products (id 14 at capture time), and the dashboard matches it to the wallet row with the same `asset_id`. It never uses array position, balance size or symbol preference, and there is no fallback asset. If the id is unresolved or the match is not exactly one row, wallet values show `N/A`.
- **USD mode:** `balance` and `available_balance` of the matched row (**partially verified**: documented meanings, §9.3).
- **INR mode:** `balance_inr` and `available_balance_inr` of the same row, read directly. These fields are **undocumented and remain pending verification**. The observed fixed multiple of 85 (§9.2) is an observation only: **nothing is converted or calculated from it**, and the toggle shows an "INR fields unverified" marker.
- **Unchanged:** Margin Used, Unrealized PnL and all Margin Overview tiles stay `N/A`; position detection is unchanged.
- **Status changes:** the "display unit" decision (§9.7 Q1) is made. The `*_inr` fields are in use but **remain UNVERIFIED**. `balance` and `available_balance` remain **PARTIALLY VERIFIED**. Nothing in §10 moved to VERIFIED because of this decision.
- **Still open:** what exactly the `*_inr` fields are (rate source, refresh timing); margin meanings with margin in use; `order_margin`; `net_equity`; position row fields; account margin mode.
