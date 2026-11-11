import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import Showcase from "./pages/Showcase";
import Landing from "./pages/Landing";
import Customer from "./pages/Customer";
import Kitchen from "./pages/Kitchen";
import Waiter from "./pages/Waiter";
import Admin from "./pages/Admin";
import { DEMO } from "./lib/config";
import { Gate } from "./components/ui";

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
        <Route path="/staff" element={<Landing />} />
        <Route path="/t/:tableId" element={<Customer />} />
        <Route path="/waiter" element={<Gate screen="waiter">{(user, out) => <Waiter user={user} onSignOut={out} />}</Gate>} />
        <Route path="/kitchen" element={<Gate screen="kitchen">{(user, out) => <Kitchen user={user} onSignOut={out} />}</Gate>} />
        <Route path="/admin/*" element={<Gate screen="admin">{(user, out) => <Admin user={user} onSignOut={out} />}</Gate>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
