
import { Routes, Route } from "react-router-dom";
import MarketDataFilter from "../components/MarketDataFilter";
function App() {

  return (
    <Routes>
      <Route path="/" element={<MarketDataFilter/>} />
      {/* <Route path="*" element={<NotFound />} /> */}
    </Routes>
  )
}

export default App
