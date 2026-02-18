
import { Routes, Route } from "react-router-dom";
import MarketDataFilter from "../components/MarketDataFilter";
import LiveETHDashboard from "../components/LiveETHDashboard";

function App() {

  return (
    <Routes>
      <Route path="/" element={<MarketDataFilter/>} />
      <Route path="/liveETH" element={<LiveETHDashboard/>} />
      {/* <Route path="*" element={<NotFound />} /> */}
    </Routes>
  )
}

export default App
