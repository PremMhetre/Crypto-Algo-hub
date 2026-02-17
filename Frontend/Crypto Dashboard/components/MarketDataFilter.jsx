import React, { useState, useMemo, useEffect } from "react";
import axios from "axios";
import dayjs from "dayjs";
import { motion, AnimatePresence } from "framer-motion";

import {
  Box,
  Grid,
  TextField,
  Button,
  MenuItem,
  Paper,
  Typography,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  CircularProgress,
  styled,
  alpha,
} from "@mui/material";

// Cyberpunk color scheme
const colors = {
  primary: "#00ff41",
  secondary: "#0dff00",
  accent: "#00d4ff",
  danger: "#ff0055",
  warning: "#ffea00",
  bg: "#0a0e27",
  bgLight: "#151932",
  terminal: "#0d1117",
};

// Styled components with hacker aesthetic
const HackerPaper = styled(Paper)(({ theme }) => ({
  background: `linear-gradient(135deg, ${colors.terminal} 0%, ${colors.bg} 100%)`,
  border: `2px solid ${colors.primary}`,
  boxShadow: `0 0 20px ${alpha(colors.primary, 0.3)}, inset 0 0 60px ${alpha(colors.primary, 0.05)}`,
  padding: theme.spacing(4),
  position: "relative",
  overflow: "hidden",
  "&::before": {
    content: '""',
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "2px",
    background: `linear-gradient(90deg, transparent, ${colors.primary}, transparent)`,
    animation: "scan 3s linear infinite",
  },
  "@keyframes scan": {
    "0%": { transform: "translateX(-100%)" },
    "100%": { transform: "translateX(100%)" },
  },
}));

const TerminalText = styled(Typography)(({ theme }) => ({
  fontFamily: "'Courier New', monospace",
  color: colors.primary,
  textShadow: `0 0 10px ${alpha(colors.primary, 0.8)}`,
  letterSpacing: "2px",
  fontWeight: 600,
}));

const HackerTextField = styled(TextField)(({ theme }) => ({
  "& .MuiOutlinedInput-root": {
    fontFamily: "'Courier New', monospace",
    color: colors.primary,
    backgroundColor: alpha(colors.terminal, 0.6),
    border: `1px solid ${alpha(colors.primary, 0.3)}`,
    borderRadius: "4px",
    transition: "all 0.3s ease",
    "&:hover": {
      borderColor: colors.primary,
      boxShadow: `0 0 15px ${alpha(colors.primary, 0.4)}`,
    },
    "&.Mui-focused": {
      borderColor: colors.accent,
      boxShadow: `0 0 20px ${alpha(colors.accent, 0.6)}`,
    },
    "&.Mui-disabled": {
      color: alpha(colors.primary, 0.3),
      backgroundColor: alpha(colors.terminal, 0.3),
      borderColor: alpha(colors.primary, 0.15),
    },
    "& fieldset": {
      borderColor: alpha(colors.primary, 0.3),
    },
    "&:hover fieldset": {
      borderColor: colors.primary,
    },
    "&.Mui-focused fieldset": {
      borderColor: colors.accent,
    },
    "&.Mui-disabled fieldset": {
      borderColor: alpha(colors.primary, 0.15),
    },
  },
  "& .MuiInputLabel-root": {
    fontFamily: "'Courier New', monospace",
    color: colors.secondary,
    "&.Mui-focused": {
      color: colors.accent,
    },
    "&.Mui-disabled": {
      color: alpha(colors.secondary, 0.3),
    },
  },
  "& .MuiSelect-icon": {
    color: colors.primary,
    "&.Mui-disabled": {
      color: alpha(colors.primary, 0.3),
    },
  },
  // Style the native date/time picker icons and calendar
  "& input[type='date']::-webkit-calendar-picker-indicator": {
    filter: "invert(1) sepia(1) saturate(5) hue-rotate(50deg)",
    cursor: "pointer",
  },
  "& input[type='time']::-webkit-calendar-picker-indicator": {
    filter: "invert(1) sepia(1) saturate(5) hue-rotate(50deg)",
    cursor: "pointer",
  },
  "& input[type='date']::-webkit-datetime-edit": {
    color: colors.primary,
  },
  "& input[type='time']::-webkit-datetime-edit": {
    color: colors.primary,
  },
  "& input[type='date']::-webkit-datetime-edit-fields-wrapper": {
    color: colors.primary,
  },
  "& input[type='time']::-webkit-datetime-edit-fields-wrapper": {
    color: colors.primary,
  },
}));

const HackerButton = styled(Button)(({ theme }) => ({
  fontFamily: "'Courier New', monospace",
  fontWeight: 700,
  letterSpacing: "3px",
  padding: "12px 40px",
  background: `linear-gradient(45deg, ${colors.primary} 0%, ${colors.accent} 100%)`,
  border: `2px solid ${colors.primary}`,
  color: colors.bg,
  position: "relative",
  overflow: "hidden",
  boxShadow: `0 0 30px ${alpha(colors.primary, 0.5)}`,
  transition: "all 0.3s ease",
  "&::before": {
    content: '""',
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "0",
    height: "0",
    borderRadius: "50%",
    background: alpha(colors.accent, 0.5),
    transform: "translate(-50%, -50%)",
    transition: "width 0.6s, height 0.6s",
  },
  "&:hover": {
    transform: "scale(1.05)",
    boxShadow: `0 0 50px ${alpha(colors.primary, 0.8)}`,
    "&::before": {
      width: "300px",
      height: "300px",
    },
  },
  "&:active": {
    transform: "scale(0.95)",
  },
}));

const GlitchTable = styled(Table)(({ theme }) => ({
  "& .MuiTableCell-root": {
    fontFamily: "'Courier New', monospace",
    borderBottom: `1px solid ${alpha(colors.primary, 0.2)}`,
    color: colors.primary,
    padding: "16px",
    backgroundColor: alpha(colors.terminal, 0.4),
  },
  "& .MuiTableCell-head": {
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "2px",
    backgroundColor: alpha(colors.bgLight, 0.8),
    color: colors.accent,
    textShadow: `0 0 10px ${alpha(colors.accent, 0.6)}`,
    borderBottom: `2px solid ${colors.primary}`,
  },
  "& .MuiTableRow-root": {
    transition: "all 0.3s ease",
    "&:hover": {
      backgroundColor: alpha(colors.primary, 0.1),
      boxShadow: `inset 0 0 20px ${alpha(colors.primary, 0.3)}`,
      transform: "scale(1.01)",
    },
  },
}));

const LoadingContainer = styled(Box)({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
  padding: 4,
});

const MatrixBackground = styled(Box)({
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  opacity: 0.05,
  pointerEvents: "none",
  overflow: "hidden",
  "&::before": {
    content: '""',
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundImage: `repeating-linear-gradient(0deg, ${alpha(colors.primary, 0.1)} 0px, transparent 1px, transparent 2px, ${alpha(colors.primary, 0.1)} 3px)`,
  },
});

/**
 * Fields allowed for sorting
 */
const sortFields = [
  "volume",
  "buy_volume",
  "sell_volume",
  "move",
  "move_percent",
  "trade_count",
];

/**
 * All columns we want to display ALWAYS
 */
const columns = [
  { key: "ts", label: "Time" },
  { key: "open", label: "Open" },
  { key: "high", label: "High" },
  { key: "low", label: "Low" },
  { key: "close", label: "Close" },
  { key: "volume", label: "Volume" },
  { key: "buy_volume", label: "Buy Volume" },
  { key: "sell_volume", label: "Sell Volume" },
  { key: "trade_count", label: "Trades" },
  { key: "move", label: "Move" },
  { key: "move_percent", label: "Move %" },
];

export default function MarketDataFilter() {
  const [market, setMarket] = useState("btc");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [sortBy, setSortBy] = useState("volume");
  const [order, setOrder] = useState("desc");
  const [displayMode, setDisplayMode] = useState("sorted"); // "sorted" or "time"

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [terminalText, setTerminalText] = useState("SYSTEM READY_");

  useEffect(() => {
    // Terminal text animation
    const messages = [
      "INITIALIZING MARKET SCANNER_",
      "CONNECTING TO DATABASE_",
      "SYSTEM READY_",
    ];
    let index = 0;
    const interval = setInterval(() => {
      setTerminalText(messages[index % messages.length]);
      index++;
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  /**
   * Fetch API data with terminal feedback
   */
  const handleSubmit = async () => {
    try {
      setLoading(true);
      setTerminalText("EXECUTING QUERY...");

      const params = {
        market,
        startDate,
        endDate,
        startTime,
        endTime,
        sortBy: displayMode === "sorted" ? sortBy : "ts",
        order: displayMode === "sorted" ? order : "asc",
      };

      const res = await axios.get("http://localhost:3000/api/market-data", {
        params,
      });

      setData(res.data);
      setTerminalText(`DATA RETRIEVED: ${res.data.length} RECORDS_`);
    } catch (err) {
      console.error("API Error:", err);
      setTerminalText("ERROR: CONNECTION FAILED_");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Memoize rows (performance optimization)
   */
  const rows = useMemo(() => data, [data]);

  // Format cell value with color coding
  const formatCellValue = (key, value, row) => {
    if (key === "ts") {
      return dayjs(value).format("HH:mm:ss");
    }
    if (key === "move" || key === "move_percent") {
      const numValue = parseFloat(value);
      const color = numValue > 0 ? colors.secondary : numValue < 0 ? colors.danger : colors.primary;
      return (
        <span style={{ color, fontWeight: 700 }}>
          {numValue > 0 ? "+" : ""}
          {value}
        </span>
      );
    }
    if (typeof value === "number") {
      return value.toLocaleString();
    }
    return value;
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: colors.bg, p: 4 }}>
      <HackerPaper
        component={motion.div}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <MatrixBackground />
        
        {/* Header with glitch effect */}
        <Box sx={{ position: "relative", mb: 4 }}>
          <TerminalText
            variant="h4"
            component={motion.div}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0.8, 1] }}
            transition={{ duration: 0.5 }}
          >
            [ MARKET DATA TERMINAL ]
          </TerminalText>
          <TerminalText variant="body2" sx={{ mt: 1, fontSize: "0.85rem" }}>
            &gt; {terminalText}
          </TerminalText>
        </Box>

        {/* Filter UI */}
        <Grid container spacing={3}>
          <Grid item xs={12} md={3}>
            <HackerTextField
              select
              fullWidth
              label="TARGET MARKET"
              value={market}
              onChange={(e) => setMarket(e.target.value)}
            >
              <MenuItem value="btc">BTC</MenuItem>
              <MenuItem value="eth">ETH</MenuItem>
            </HackerTextField>
          </Grid>

          <Grid item xs={12} md={3}>
            <HackerTextField
              type="date"
              fullWidth
              label="START DATE"
              InputLabelProps={{ shrink: true }}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Grid>

          <Grid item xs={12} md={3}>
            <HackerTextField
              type="date"
              fullWidth
              label="END DATE"
              InputLabelProps={{ shrink: true }}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Grid>

          <Grid item xs={12} md={3}>
            <HackerTextField
              type="time"
              fullWidth
              label="START TIME"
              InputLabelProps={{ shrink: true }}
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </Grid>

          <Grid item xs={12} md={3}>
            <HackerTextField
              type="time"
              fullWidth
              label="END TIME"
              InputLabelProps={{ shrink: true }}
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </Grid>

          <Grid item xs={12} md={3}>
            <HackerTextField
              select
              fullWidth
              label="DISPLAY MODE"
              value={displayMode}
              onChange={(e) => setDisplayMode(e.target.value)}
            >
              <MenuItem value="time">TIME ORDER</MenuItem>
              <MenuItem value="sorted">SORTED DATA</MenuItem>
            </HackerTextField>
          </Grid>

          <Grid item xs={12} md={3}>
            <HackerTextField
              select
              fullWidth
              label="SORT PARAMETER"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              disabled={displayMode === "time"}
            >
              {sortFields.map((field) => (
                <MenuItem key={field} value={field}>
                  {field.toUpperCase().replace("_", " ")}
                </MenuItem>
              ))}
            </HackerTextField>
          </Grid>

          <Grid item xs={12} md={3}>
            <HackerTextField
              select
              fullWidth
              label="SORT ORDER"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              disabled={displayMode === "time"}
            >
              <MenuItem value="asc">ASCENDING</MenuItem>
              <MenuItem value="desc">DESCENDING</MenuItem>
            </HackerTextField>
          </Grid>

          <Grid item xs={12}>
            <HackerButton
              fullWidth
              onClick={handleSubmit}
              component={motion.button}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              [ EXECUTE QUERY ]
            </HackerButton>
          </Grid>
        </Grid>

        {/* Result Table */}
        <Box mt={6}>
          <AnimatePresence mode="wait">
            {loading && (
              <LoadingContainer
                component={motion.div}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <CircularProgress
                  size={60}
                  thickness={2}
                  sx={{
                    color: colors.primary,
                    filter: `drop-shadow(0 0 10px ${colors.primary})`,
                  }}
                />
                <TerminalText variant="body1">SCANNING DATABASE...</TerminalText>
              </LoadingContainer>
            )}

            {!loading && rows.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <Box sx={{ overflowX: "auto" }}>
                  <GlitchTable size="small">
                    <TableHead>
                      <TableRow>
                        {columns.map((col, idx) => (
                          <TableCell
                            key={col.key}
                            component={motion.td}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.05 }}
                          >
                            {col.label.toUpperCase()}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>

                    <TableBody>
                      {rows.map((row, rowIdx) => (
                        <TableRow
                          key={row.id}
                          component={motion.tr}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: rowIdx * 0.02 }}
                        >
                          {columns.map((col) => (
                            <TableCell key={col.key}>
                              {formatCellValue(col.key, row[col.key], row)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </GlitchTable>
                </Box>
              </motion.div>
            )}

            {!loading && rows.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <TerminalText
                  mt={4}
                  textAlign="center"
                  sx={{ fontSize: "1.2rem" }}
                >
                  &gt; NO DATA FOUND IN DATABASE_
                </TerminalText>
              </motion.div>
            )}
          </AnimatePresence>
        </Box>
      </HackerPaper>
    </Box>
  );
}