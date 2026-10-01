// ─── useFlip ─────────────────────────────────────────────────────────────────
// Reordenación animada de una lista (técnica FLIP): cuando cambia el orden
// (`orderKey`), cada elemento `[data-flip="<id>"]` parte de su posición
// anterior y se desliza a la nueva con `transform` (Web Animations API, sin
// tocar el layout). Las posiciones se miden relativas a la lista, así que el
// scroll de la página no cuenta como movimiento. Con prefers-reduced-motion o
// sin `element.animate` (SSR/tests), los elementos simplemente aparecen en su
// sitio.
import { useLayoutEffect, useRef } from "react";

export function useFlip(listRef, orderKey, { duration = 420 } = {}) {
  const prev = useRef(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) { prev.current = null; return; }
    const base = list.getBoundingClientRect().top;
    const items = [...list.querySelectorAll("[data-flip]")];
    const next = new Map(items.map((el) => [el.dataset.flip, el.getBoundingClientRect().top - base]));
    const old = prev.current;
    prev.current = next;
    if (!old) return;
    let reduced = false;
    try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { /* */ }
    if (reduced) return;
    items.forEach((el) => {
      const from = old.get(el.dataset.flip);
      const to = next.get(el.dataset.flip);
      if (from == null || Math.abs(from - to) < 1 || typeof el.animate !== "function") return;
      el.animate(
        [{ transform: `translateY(${from - to}px)` }, { transform: "translateY(0)" }],
        { duration, easing: "cubic-bezier(.2,.9,.25,1)" },
      );
    });
  }, [orderKey]); // eslint-disable-line react-hooks/exhaustive-deps
}
