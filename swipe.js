// Horizontal swipe + tap detection for the flashcard. Vertical drags are left to the browser (touch-action: pan-y).
import { swipeDecision } from "./logic.js";

export function attachSwipe(el, { onSwipe, onTap, canSwipe = () => true }) {
  let sx = 0, sy = 0, st = 0, id = null, axis = null;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const setX = (x, anim) => {
    el.style.transition = anim ? "transform .18s ease-out" : "none";
    el.style.transform = x ? `translateX(${x}px) rotate(${x * 0.03}deg)` : "";
  };

  el.addEventListener("pointerdown", e => {
    id = null;
    if (e.button !== 0 || e.target.closest("button")) return;
    id = e.pointerId; sx = e.clientX; sy = e.clientY; st = performance.now(); axis = null;
  });
  el.addEventListener("pointermove", e => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!axis && Math.hypot(dx, dy) > 8) {
      axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis === "x") el.setPointerCapture(id);
    }
    if (axis === "x") setX(dx, false);
  });
  const end = e => {
    if (e.pointerId !== id) return;
    id = null;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!axis) { if (e.type === "pointerup") onTap(); return; }
    if (axis !== "x") return;
    const dir = e.type === "pointerup" ? swipeDecision({ dx, dy, dt: performance.now() - st, width: el.offsetWidth }) : "cancel";
    if (dir === "cancel" || !canSwipe(dir)) { setX(0, !reduce); return; }
    if (reduce) { setX(0, false); onSwipe(dir); return; }
    setX((dir === "next" ? -1 : 1) * el.offsetWidth * 1.2, true);
    setTimeout(() => { setX(0, false); onSwipe(dir); }, 180);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}
