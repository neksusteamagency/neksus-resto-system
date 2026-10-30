import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import Showcase from "./pages/Showcase";
import Landing from "./pages/Landing";
import Customer from "./pages/Customer";
import Kitchen from "./pages/Kitchen";
import Admin from "./pages/Admin";
import { Gate } from "./components/ui";

const DEMO = import.meta.env.VITE_DEMO_MODE === "true";

const NotFound = () => (
  <div className="customer">
    <div className="notice-page">
      <span className="rest-mark">?</span>
      <h1>Page not found</h1>
      <p>This address doesn’t exist.</p>
      <Link className="btn primary" to="/">Go to the start</Link>
    </div>
  </div>
);

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={DEMO ? <Showcase /> : <Landing />} />
        <Route path="/t/:tableId" element={<Customer />} />
        <Route path="/kitchen" element={<Gate role="kitchen">{(out) => <Kitchen onSignOut={out} />}</Gate>} />
        <Route path="/admin/*" element={<Gate role="admin">{(out) => <Admin onSignOut={out} />}</Gate>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
