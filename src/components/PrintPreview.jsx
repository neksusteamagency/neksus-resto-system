import { Sheet } from "./ui";
import { printHtml } from "../lib/print";

// Shows exactly what will come out of the printer, with a Print button.
export default function PrintPreview({ title, html, width = 80, onClose }) {
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => printHtml(html)}>Print</button></>}
    >
      <iframe className="preview-frame" title={title} srcDoc={html} style={{ width: `${width === 58 ? 260 : 340}px` }} />
    </Sheet>
  );
}
