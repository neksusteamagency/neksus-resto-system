import { useRef } from "react";

// Big on-screen number pad for PINs (works with a physical keyboard too).
export default function PinPad({ value, onChange, disabled = false, busy = false, min = 4, max = 6, submitLabel = "Sign in" }) {
  const box = useRef(null);
  const add = (d) => { if (!disabled) onChange((value + d).slice(0, max)); };
  const back = () => { if (!disabled) onChange(value.slice(0, -1)); };

  const onKeyDown = (e) => {
    if (e.target.tagName === "INPUT") return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); add(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); back(); }
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];
  const dots = Math.max(min, value.length);

  return (
    <div className="pinpad" ref={box} onKeyDown={onKeyDown} tabIndex={-1}>
      <div className="pin-dots" role="img" aria-label={`${value.length} digits entered`}>
        {Array.from({ length: dots }, (_, i) => <i key={i} className={i < value.length ? "on" : ""} />)}
      </div>
      <div className="pin-keys">
        {keys.map((k) =>
          k === "clear" ? (
            <button type="button" key={k} className="alt" onClick={() => onChange("")} disabled={disabled || !value} aria-label="Clear">Clear</button>
          ) : k === "back" ? (
            <button type="button" key={k} className="alt" onClick={back} disabled={disabled || !value} aria-label="Delete last digit">⌫</button>
          ) : (
            <button type="button" key={k} onClick={() => add(k)} disabled={disabled}>{k}</button>
          )
        )}
      </div>
      <button className="btn primary block" disabled={disabled || busy || value.length < min}>{busy ? "Signing in…" : submitLabel}</button>
    </div>
  );
}
