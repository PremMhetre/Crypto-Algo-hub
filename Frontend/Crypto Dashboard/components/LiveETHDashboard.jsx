import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";
import {
  Paper,
  Typography,
  Grid,
  Box,
  Button
} from "@mui/material";

const socket = io("http://localhost:3000");

export default function LiveETHDashboard() {
  const [data, setData] = useState(null);
  const [totalBuy, setTotalBuy] = useState(0);
  const [totalSell, setTotalSell] = useState(0);

  useEffect(() => {
    socket.on("eth_live", (liveData) => {
      setData(liveData);

      setTotalBuy(prev => prev + Number(liveData.buy_volume || 0));
      setTotalSell(prev => prev + Number(liveData.sell_volume || 0));
    });

    return () => {
      socket.off("eth_live");
    };
  }, []);

  if (!data) {
    return <Typography>Waiting for live data...</Typography>;
  }

  /* -------- CURRENT 1s DATA -------- */

  const buy1s = Number(data.buy_volume || 0);
  const sell1s = Number(data.sell_volume || 0);
  const volume1s = Number(data.volume || 0);
  const trades1s = Number(data.trade_count || 0);

  const diff = totalBuy - totalSell;
  const isPositive = diff >= 0;

  /* -------- TRADE COUNT % -------- */
  const tradePercent =
    volume1s > 0 ? ((trades1s / volume1s) * 100) : 0;

  const handleReset = () => {
    setTotalBuy(0);
    setTotalSell(0);
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" mb={2}>
        🟣 ETH LIVE DASHBOARD
      </Typography>

      <Grid container spacing={2}>

        {/* -------- LIVE MARKET DATA -------- */}

        <Stat label="Live Price" value={format(data.close)} highlight />

        <Stat label="Volume (1s)" value={format(volume1s)} />

        <Stat label="Trade Count (1s)" value={trades1s} />

        <Stat
          label="Trade Count %"
          value={format(tradePercent) + "%"}
        />

        {/* -------- ORDER FLOW (1s) -------- */}

        <Stat label="Buy Volume (1s)" value={format(buy1s)} />

        <Stat label="Sell Volume (1s)" value={format(sell1s)} />

        {/* -------- RUNNING TOTALS -------- */}

        <Stat label="Total Buy Volume" value={format(totalBuy)} />

        <Stat label="Total Sell Volume" value={format(totalSell)} />

        <Stat
          label="Buy - Sell Difference"
          value={(isPositive ? "+" : "") + format(diff)}
          color={isPositive ? "green" : "red"}
        />

        <Grid item xs={12}>
          <Button
            variant="contained"
            color="error"
            onClick={handleReset}
          >
            Reset Totals
          </Button>
        </Grid>

      </Grid>
    </Paper>
  );
}

/* ---------- SAFE FORMAT ---------- */

function format(value, decimals = 4) {
  const num = Number(value);
  return isNaN(num) ? "0.0000" : num.toFixed(decimals);
}

/* ---------- STAT UI ---------- */

function Stat({ label, value, color, highlight }) {
  return (
    <Grid item xs={12} md={4}>
      <Box
        sx={{
          p: 2,
          borderRadius: 2,
          backgroundColor: highlight ? "#f5f5f5" : "#fafafa",
          textAlign: "center",
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>

        <Typography
          variant="h6"
          sx={{
            color: color || "black",
            fontWeight: 600
          }}
        >
          {value}
        </Typography>
      </Box>
    </Grid>
  );
}
