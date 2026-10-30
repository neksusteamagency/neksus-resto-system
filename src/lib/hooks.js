import { useEffect, useRef, useState, useCallback } from "react";

export function useNow(ms = 15000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useTitle(title) {
  useEffect(() => { document.title = title; }, [title]);
}

// One toast at a time. show(text, { action: { label, run } })
export function useToast(duration = 5000) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);
  const show = useCallback((text, opts = {}) => {
    clearTimeout(timer.current);
    setToast({ text, action: opts.action, id: Math.random() });
    timer.current = setTimeout(() => setToast(null), opts.duration || duration);
  }, [duration]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { toast, show, dismiss };
}

let audio;
export function beep() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const t = audio.currentTime;
    [880, 1175].forEach((freq, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      o.connect(g);
      g.connect(audio.destination);
      g.gain.setValueAtTime(0.0001, t + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.2);
      o.start(t + i * 0.18);
      o.stop(t + i * 0.18 + 0.22);
    });
  } catch { /* audio not available */ }
}
