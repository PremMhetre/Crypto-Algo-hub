
import { Routes, Route } from "react-router-dom";
import MarketDataFilter from "../components/MarketDataFilter";
import LiveETHDashboard from "../components/LiveETHDashboard";
import TradingDashboard from "../components/TradingDashboard";

function App() {

  return (
    <Routes>
      <Route path="/" element={<MarketDataFilter/>} />
      <Route path="/liveETH" element={<LiveETHDashboard/>} />
      <Route path="/dashboard" element={<TradingDashboard/>} />
      {/* <Route path="*" element={<NotFound />} /> */}
    </Routes>
  )
}

export default App
