import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import dayjs from "dayjs";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Container,
  CssBaseline,
  Grid,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ThemeProvider,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  createTheme,
} from "@mui/material";
import { FIELD_MAP } from "./dashboardFieldMap";
import {
  ACCOUNT_REFRESH_MS,
  SETTLEMENT_REFRESH_MS,
  STATUS_REFRESH_MS,
  collectProductIds,
  createPoller,
  deriveBinance,
  deriveDelta,
  deriveReadiness,
  derivePositions,
  derivePostgres,
  deriveWallet,
  extractError,
  fmt,
  formatMoney,
  isStale,
  pnlUnavailableReason,
  positionsPanelState,
  readinessNote,
  signColor,
  signed,
} from "./dashboardLogic";

// Strictly read-only: this file only issues GET requests to the endpoints below.
const API = "http://localhost:3000";

const theme = createTheme({
  palette: {
    mode: "dark",
    background: { default: "#0b0e14", paper: "#131722" },
    primary: { main: "#4c8dff" },
    success: { main: "#26a69a" },
    error: { main: "#ef5350" },
    warning: { main: "#f5b83d" },
    divider: "#232a3b",
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  shape: { borderRadius: 8 },
});

const mono = { fontFamily: '"JetBrains Mono", "Roboto Mono", Consolas, monospace' };

const emptySection = { data: null, lastSuccess: null, error: null, loading: true };

/* ======================= container: polling and state ======================= */

export default function TradingDashboard() {
  const [wallet, setWallet] = useState(emptySection);
  const [positions, setPositions] = useState(emptySection);
  const [instruments, setInstruments] = useState({ byId: {}, lastSuccess: null, error: null });
  const [status, setStatus] = useState(emptySection);
  const [settlement, setSettlement] = useState(emptySection);
  // Frontend-only display choice. Always USD on load, never persisted, and deliberately not
  // a dependency of the polling effect below, so switching causes no requests.
  const [currency, setCurrency] = useState("USD");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    const get = (path, params) => axios.get(`${API}${path}`, { params, timeout: 15000 });

    const settle = (setter) => ({
      ok: (data) =>
        alive && setter({ data, lastSuccess: Date.now(), error: null, loading: false }),
      fail: (err) =>
        alive &&
        setter((prev) => ({ ...prev, error: extractError(err), loading: false })),
    });

    const loadWallet = async () => {
      const s = settle(setWallet);
      try {
        const res = await get("/wallet");
        s.ok({ rows: res.data?.result, meta: res.data?.meta ?? null });
      } catch (err) {
        s.fail(err);
      }
    };

    const loadPositions = async () => {
      const s = settle(setPositions);
      let rows;
      try {
        const res = await get("/positions");
        rows = res.data?.result;
        s.ok(rows);
      } catch (err) {
        s.fail(err);
        return;
      }

      // Mark prices refresh on every positions cycle while positions are open.
      const ids = collectProductIds(rows, FIELD_MAP);
      if (ids.length === 0) {
        if (alive) setInstruments({ byId: {}, lastSuccess: null, error: null });
        return;
      }
      try {
        const res = await get("/api/dashboard/instruments", { ids: ids.join(",") });
        if (alive) {
          setInstruments({ byId: res.data?.result ?? {}, lastSuccess: Date.now(), error: null });
        }
      } catch (err) {
        if (alive) setInstruments((prev) => ({ ...prev, error: extractError(err) }));
      }
    };

    const loadStatus = async () => {
      const s = settle(setStatus);
      try {
        const res = await get("/api/dashboard/status");
        s.ok(res.data?.result ?? null);
      } catch (err) {
        s.fail(err);
      }
    };

    const loadSettlement = async () => {
      const s = settle(setSettlement);
      try {
        const res = await get("/api/dashboard/settlement");
        s.ok(res.data?.result ?? null);
      } catch (err) {
        s.fail(err);
      }
    };

    const isHidden = () => document.hidden;
    const pollers = [
      createPoller({ task: loadWallet, intervalMs: ACCOUNT_REFRESH_MS, isHidden }),
      createPoller({ task: loadPositions, intervalMs: ACCOUNT_REFRESH_MS, isHidden }),
      createPoller({ task: loadStatus, intervalMs: STATUS_REFRESH_MS, isHidden }),
      createPoller({ task: loadSettlement, intervalMs: SETTLEMENT_REFRESH_MS, isHidden }),
    ];
    pollers.forEach((p) => p.start());

    const onVisibility = () => {
      if (!document.hidden) {
        setNow(Date.now());
        pollers.forEach((p) => p.trigger());
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const clock = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      alive = false;
      pollers.forEach((p) => p.stop());
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(clock);
    };
  }, []);

  // If the instruments refresh fails, keep contract metadata but never show a stale mark as live.
  const instrumentMap = useMemo(() => {
    if (!instruments.error) return instruments.byId;
    return Object.fromEntries(
      Object.entries(instruments.byId).map(([id, v]) => [id, v ? { ...v, markPrice: null } : v])
    );
  }, [instruments]);

  return (
    <DashboardView
      wallet={wallet}
      positions={positions}
      instrumentsError={instruments.error}
      instrumentMap={instrumentMap}
      status={status}
      settlement={settlement}
      currency={currency}
      onCurrencyChange={setCurrency}
      now={now}
      map={FIELD_MAP}
    />
  );
}

/* ======================= view: pure rendering of the props ======================= */

export function DashboardView({
  wallet,
  positions,
  instrumentsError,
  instrumentMap,
  status,
  settlement = emptySection,
  currency = "USD",
  onCurrencyChange = () => {},
  now,
  map,
}) {
  // Settlement asset id from the product data; null (never a default) when unresolved.
  const settlementId = Number.isInteger(settlement.data?.assetId) ? settlement.data.assetId : null;
  const walletView = deriveWallet(wallet.data, map, currency, settlementId);
  const positionsView = derivePositions(positions.data, instrumentMap, map);
  const walletOutcome = {
    ok: wallet.error ? false : wallet.lastSuccess !== null,
    error: wallet.error,
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default", py: 3 }}>
        <Container maxWidth="xl">
          <Box sx={{ mb: 2 }}>
            <Typography variant="h5" fontWeight={700}>
              Crypto Algo Hub
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Live account monitor · read-only
            </Typography>
          </Box>

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, lg: 6 }}>
              <AccountOverview
                wallet={wallet}
                view={walletView}
                totalPnl={positionsView.totalPnl}
                pnlReason={pnlUnavailableReason(positions, positionsView)}
                pnlAsOf={positions.lastSuccess}
                currency={currency}
                onCurrencyChange={onCurrencyChange}
                settlement={settlement}
                pendingVerification={map.currencies?.[currency]?.pendingVerification === true}
                now={now}
              />
            </Grid>
            <Grid size={{ xs: 12, lg: 6 }}>
              <MarginOverview wallet={wallet} view={walletView} now={now} />
            </Grid>
            <Grid size={12}>
              <OpenPositions
                positions={positions}
                view={positionsView}
                instrumentsError={instrumentsError}
                now={now}
              />
            </Grid>
            <Grid size={12}>
              <SystemStatus status={status} walletOutcome={walletOutcome} now={now} />
            </Grid>
          </Grid>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

/* ---------------- shared building blocks ---------------- */

function UpdatedCaption({ lastSuccess, intervalMs, now }) {
  const stale = isStale(lastSuccess, intervalMs, now);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      {stale && <Chip size="small" color="warning" variant="outlined" label="Stale" />}
      <Typography variant="caption" color={stale ? "warning.main" : "text.secondary"} sx={mono}>
        {lastSuccess ? `Updated ${dayjs(lastSuccess).format("HH:mm:ss")}` : "No successful update yet"}
      </Typography>
    </Box>
  );
}

function Section({ title, subtitle, lastSuccess, intervalMs, now, children }) {
  const stale = isStale(lastSuccess, intervalMs, now);
  return (
    <Paper variant="outlined" sx={{ p: 2.5, height: "100%", borderColor: "divider" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1, flexWrap: "wrap" }}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary" display="block">
              {subtitle}
            </Typography>
          )}
        </Box>
        <UpdatedCaption lastSuccess={lastSuccess} intervalMs={intervalMs} now={now} />
      </Box>
      <Box mt={1.5} sx={{ opacity: stale ? 0.6 : 1 }}>
        {children}
      </Box>
    </Paper>
  );
}

function Metric({ label, value, reason, color, loading, display, caption }) {
  const text = display ?? fmt(value);
  const body = (
    <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: "rgba(255,255,255,0.03)", height: "100%" }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      {loading ? (
        <Skeleton width="60%" height={32} />
      ) : (
        <Typography variant="h6" fontWeight={600} sx={{ ...mono, color: text === "N/A" ? "text.disabled" : color || "text.primary" }}>
          {text}
        </Typography>
      )}
      {caption && (
        <Typography variant="caption" color={caption.warn ? "warning.main" : "text.secondary"} display="block" sx={mono}>
          {caption.text}
        </Typography>
      )}
    </Box>
  );
  return text === "N/A" && reason ? <Tooltip title={reason} placement="top">{body}</Tooltip> : body;
}

function ErrorNote({ title, error, keptLast }) {
  const detail = error?.httpStatus ? `${error.message} (HTTP ${error.httpStatus})` : error?.message;
  return (
    <Alert severity="error" variant="outlined" sx={{ mb: 1.5 }}>
      {title}: {detail}
      {keptLast ? " — showing last known data" : ""}
    </Alert>
  );
}

/* ---------------- Account Overview ---------------- */

function CurrencyToggle({ currency, onChange, pendingVerification }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", mb: 1.5 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        color="primary"
        value={currency}
        onChange={(e, v) => v && onChange(v)}
        aria-label="Display currency"
      >
        <ToggleButton value="USD" aria-label="USD">$ USD</ToggleButton>
        <ToggleButton value="INR" aria-label="INR">₹ INR</ToggleButton>
      </ToggleButtonGroup>
      {pendingVerification && (
        <Tooltip title="Delta does not document the *_inr wallet fields. Values are read directly from the API and are not converted. Pending verification.">
          <Chip size="small" color="warning" variant="outlined" label="INR fields unverified" />
        </Tooltip>
      )}
    </Box>
  );
}

function AccountOverview({
  wallet,
  view,
  totalPnl,
  pnlReason: pnlNa,
  pnlAsOf,
  currency,
  onCurrencyChange,
  settlement,
  pendingVerification,
  now,
}) {
  // Financial tiles stay in the loading state until the wallet AND the settlement id have both
  // resolved (first load only), so "N/A" is never shown merely because settlement is still pending.
  // Once the settlement request has settled (success or failure) the real value or N/A is shown.
  const settlementPending = settlement.loading && settlement.data === null;
  const loading = (wallet.loading && wallet.data === null) || (wallet.data !== null && settlementPending);
  const m = view.metrics;
  // Unrealized PnL comes from the positions feed, which has its own timestamp.
  const pnlCaption =
    totalPnl !== null && pnlAsOf
      ? {
          text: `Positions as of ${dayjs(pnlAsOf).format("HH:mm:ss")}${isStale(pnlAsOf, ACCOUNT_REFRESH_MS, now) ? " · Stale" : ""}`,
          warn: isStale(pnlAsOf, ACCOUNT_REFRESH_MS, now),
        }
      : null;
  const settlementUnresolved = !Number.isInteger(settlement.data?.assetId);
  const settlementProblem =
    settlement.data?.reason ?? (settlement.error ? settlement.error.message : "Settlement asset not loaded yet");
  const subtitle =
    view.assetLabel !== null
      ? `Settlement asset ${view.assetLabel} (id ${view.assetId})`
      : view.netEquity.value !== null
        ? `Net equity ${fmt(view.netEquity.value)}`
        : undefined;
  return (
    <Section
      title="Account Overview"
      subtitle={subtitle}
      lastSuccess={wallet.lastSuccess}
      intervalMs={ACCOUNT_REFRESH_MS}
      now={now}
    >
      <CurrencyToggle currency={currency} onChange={onCurrencyChange} pendingVerification={pendingVerification} />
      {wallet.error && <ErrorNote title="Wallet" error={wallet.error} keptLast={wallet.data !== null} />}
      {settlementUnresolved && !settlement.loading && (
        <Alert severity="warning" variant="outlined" sx={{ mb: 1.5 }}>
          Settlement asset unresolved ({settlementProblem}). Wallet values are N/A.
        </Alert>
      )}
      <Grid container spacing={1.5}>
        <Grid size={6}>
          <Metric
            label={`Total Wallet Balance (${currency})`}
            value={m.balance.value}
            display={formatMoney(m.balance.value, currency)}
            reason={m.balance.reason}
            loading={loading}
          />
        </Grid>
        <Grid size={6}>
          <Metric
            label={`Available Balance (${currency})`}
            value={m.available.value}
            display={formatMoney(m.available.value, currency)}
            reason={m.available.reason}
            loading={loading}
          />
        </Grid>
        <Grid size={6}>
          <Metric label="Margin Used" value={m.marginUsed.value} reason={m.marginUsed.reason} loading={loading} />
        </Grid>
        <Grid size={6}>
          <Metric
            label="Unrealized PnL"
            value={totalPnl}
            display={totalPnl === null ? "N/A" : signed(totalPnl)}
            reason={pnlNa}
            color={signColor(totalPnl)}
            caption={pnlCaption}
          />
        </Grid>
      </Grid>
    </Section>
  );
}

/* ---------------- Margin Overview ---------------- */

function MarginOverview({ wallet, view, now }) {
  const loading = wallet.loading && wallet.data === null;
  const m = view.metrics;
  return (
    <Section title="Margin Overview" lastSuccess={wallet.lastSuccess} intervalMs={ACCOUNT_REFRESH_MS} now={now}>
      <Grid container spacing={1.5}>
        <Grid size={6}>
          <Metric label="Initial Margin" value={m.initialMargin.value} reason={m.initialMargin.reason} loading={loading} />
        </Grid>
        <Grid size={6}>
          <Metric label="Maintenance Margin" value={m.maintenanceMargin.value} reason={m.maintenanceMargin.reason} loading={loading} />
        </Grid>
        <Grid size={6}>
          <Metric label="Free Margin" value={m.freeMargin.value} reason={m.freeMargin.reason} loading={loading} />
        </Grid>
        <Grid size={6}>
          <Metric
            label="Margin Utilization"
            value={m.marginUtilization.value}
            display={m.marginUtilization.value === null ? "N/A" : `${fmt(m.marginUtilization.value)}%`}
            reason={m.marginUtilization.reason}
            loading={loading}
          />
        </Grid>
      </Grid>
    </Section>
  );
}

/* ---------------- Open Positions ---------------- */

const headCell = { color: "text.secondary", fontSize: 12, whiteSpace: "nowrap", borderColor: "divider" };
const cell = { borderColor: "divider" };
const columns = [
  ["Contract", "left"],
  ["Underlying", "left"],
  ["Type", "left"],
  ["Side", "left"],
  ["Qty", "right"],
  ["Avg Entry", "right"],
  ["Mark", "right"],
  ["Unrealized PnL", "right"],
  ["Expiry", "left"],
  ["Margin", "right"],
];

const text = (v) => (v === null || v === undefined || v === "" ? "N/A" : v);

function OpenPositions({ positions, view, instrumentsError, now }) {
  const panel = positionsPanelState(positions, view);
  const subtitle =
    panel.kind === "rows"
      ? `${view.rows.length} open${panel.failing ? " (last successful)" : ""}`
      : panel.kind === "empty"
        ? `0 open${panel.failing ? " (last successful)" : ""}`
        : undefined;

  let body;
  if (panel.kind === "failed") {
    // Request failed and nothing valid was ever received: report only the failure.
    body = <ErrorNote title="Positions" error={positions.error} />;
  } else if (panel.kind === "loading") {
    body = (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  } else {
    body = (
      <>
        {panel.failing && <ErrorNote title="Positions" error={positions.error} keptLast />}
        {instrumentsError && (
          <Alert severity="warning" variant="outlined" sx={{ mb: 1.5 }}>
            Mark prices unavailable: {instrumentsError.message}
          </Alert>
        )}
        <PositionsBody view={view} panel={panel} />
      </>
    );
  }

  return (
    <Section title="Open Positions" subtitle={subtitle} lastSuccess={positions.lastSuccess} intervalMs={ACCOUNT_REFRESH_MS} now={now}>
      {body}
    </Section>
  );
}

// When the latest request failed, every statement refers to the last successful response only.
function PositionsBody({ view, panel }) {
  const prefix = panel.failing ? `Last successful response (${dayjs(panel.asOf).format("HH:mm:ss")}): ` : "";
  if (view.state === "invalid") {
    return (
      <Alert severity="warning" variant="outlined">
        {prefix}Unexpected /positions response structure. Positions are shown as N/A.
      </Alert>
    );
  }
  if (view.state === "unverified") {
    return (
      <Alert severity="info" variant="outlined">
        Open-position detection is not verified, so positions are not shown (N/A). {prefix || "The exchange returned "}
        {prefix ? "contained " : ""}
        {view.rowCount} row(s). See DASHBOARD_SPEC.md §4.3.
      </Alert>
    );
  }
  if (view.state === "empty") {
    return (
      <Box sx={{ py: 5, textAlign: "center" }}>
        <Typography color="text.secondary">
          {panel.failing ? `No open positions as of ${dayjs(panel.asOf).format("HH:mm:ss")}` : "No open positions"}
        </Typography>
      </Box>
    );
  }
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            {columns.map(([h, align]) => (
              <TableCell key={h} align={align} sx={headCell}>
                {h}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {view.rows.map((r, i) => (
            <TableRow key={r.key ?? i} hover>
              <TableCell sx={{ ...mono, ...cell }}>{text(r.name)}</TableCell>
              <TableCell sx={cell}>{text(r.underlying)}</TableCell>
              <TableCell sx={cell}>{text(r.optionType)}</TableCell>
              <TableCell sx={cell}>
                {r.side ? (
                  <Chip size="small" label={r.side} color={r.side === "Long" ? "success" : "error"} variant="outlined" />
                ) : (
                  "N/A"
                )}
              </TableCell>
              <TableCell align="right" sx={{ ...mono, ...cell }}>{fmt(r.qty, 0)}</TableCell>
              <TableCell align="right" sx={{ ...mono, ...cell }}>{fmt(r.entry)}</TableCell>
              <TableCell align="right" sx={{ ...mono, ...cell }}>{fmt(r.mark)}</TableCell>
              <TableCell align="right" sx={{ ...mono, ...cell, color: signColor(r.pnl) }}>{signed(r.pnl)}</TableCell>
              <TableCell sx={{ ...mono, whiteSpace: "nowrap", ...cell }}>
                {r.expiry ? dayjs(r.expiry).format("DD MMM YYYY HH:mm") : "N/A"}
              </TableCell>
              <TableCell align="right" sx={{ ...mono, ...cell }}>{fmt(r.margin)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/* ---------------- System Status ---------------- */

const LEVEL_COLOR = { ok: "success.main", warn: "warning.main", bad: "error.main", unknown: "text.disabled" };

function StatusItem({ label, level, text: state, detail, note }) {
  return (
    <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: "rgba(255,255,255,0.03)", height: "100%" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: LEVEL_COLOR[level], flexShrink: 0 }} />
        <Typography variant="body2" fontWeight={600}>
          {label}
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ color: LEVEL_COLOR[level], mt: 0.5 }}>
        {state}
      </Typography>
      {detail && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ ...mono, wordBreak: "break-word" }}>
          {detail}
        </Typography>
      )}
      {note && (
        <Typography variant="caption" color="text.disabled" display="block">
          {note}
        </Typography>
      )}
    </Box>
  );
}

function SystemStatus({ status, walletOutcome, now }) {
  const s = status.data;
  let items;

  if (!s) {
    const failed = !!status.error;
    items = ["Binance ETH WebSocket", "Delta Exchange API", "PostgreSQL", "Webhook Readiness"].map((label) => ({
      label,
      level: failed ? "bad" : "unknown",
      text: failed ? "Backend unreachable" : "Checking…",
      detail: failed ? status.error.message : undefined,
    }));
  } else {
    const delta = deriveDelta(s.delta, walletOutcome);
    const readiness = deriveReadiness(s.engine);
    items = [
      { label: "Binance ETH WebSocket", ...deriveBinance(s.binance) },
      { label: "Delta Exchange API", ...delta },
      { label: "PostgreSQL", ...derivePostgres(s.postgres) },
      { label: "Webhook Readiness", ...readiness, note: readinessNote(readiness, delta) },
    ];
  }

  return (
    <Section title="System Status" lastSuccess={status.lastSuccess} intervalMs={STATUS_REFRESH_MS} now={now}>
      {status.error && s && <ErrorNote title="Status refresh failed" error={status.error} keptLast />}
      <Grid container spacing={1.5}>
        {items.map((it) => (
          <Grid key={it.label} size={{ xs: 12, sm: 6, lg: 3 }}>
            <StatusItem {...it} />
          </Grid>
        ))}
      </Grid>
    </Section>
  );
}
