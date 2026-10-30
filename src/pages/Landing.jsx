import { Link } from "react-router-dom";
import { useStore } from "../lib/store";
import { useTitle } from "../lib/hooks";

export default function Landing() {
  const { settings } = useStore();
  useTitle(settings.name);
  return (
    <div className="customer">
      <div className="notice-page">
        <span className="rest-mark">{settings.name.slice(0, 1)}</span>
        <h1>{settings.name}</h1>
        <p>Scan the QR code on your table to see the menu and order.</p>
        <Link className="btn primary" to="/t/takeaway">Order takeaway</Link>
      </div>
    </div>
  );
}
