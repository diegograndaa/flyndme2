// ─── Odometer ────────────────────────────────────────────────────────────────
// Cifras de cabina (sep-2026): cada dígito es una cinta vertical 0-9 que se
// desliza como la cinta de altitud del PFD cuando el valor cambia (otra fecha,
// otro destino, otro criterio). Solo `transform` (GPU), ≤300 ms, sin mover el
// layout: el ancho de cada celda es el de un dígito tabular.
//
// Honesto: recibe el texto YA formateado (p. ej. "€104") y siempre se asienta
// en él. El SSR y el movimiento reducido pintan el valor final directamente;
// en cliente, al montarse, las cintas suben desde 0 (como el antiguo count-up).
// Lectores de pantalla: texto final en .odo-sr y cintas aria-hidden.
import React, { useEffect, useState } from "react";

const TAPE = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

function prefersReducedMotion() {
  try {
    return typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch { return false; }
}

export const Odometer = React.memo(function Odometer({ value, className = "", roll = true }) {
  const text = String(value ?? "");
  const [ready, setReady] = useState(false);
  // Primer frame en cliente: dígitos a 0 para que suban hasta el valor.
  const [start] = useState(() => (
    typeof window === "undefined" || !roll || prefersReducedMotion() ? text : text.replace(/\d/g, "0")
  ));

  useEffect(() => {
    // Doble rAF: garantiza que el navegador ha pintado el estado inicial antes
    // de fijar el valor real (si no, no hay transición que ver).
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setReady(true)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, []);

  const chars = [...(ready ? text : start)];
  const n = chars.length;
  return (
    <span className={`odo ${className}`.trim()}>
      <span className="odo-sr">{text}</span>
      {chars.map((ch, i) => {
        const pos = n - i; // clave alineada por la derecha: unidades con unidades
        if (!/\d/.test(ch)) {
          return <span key={`c${pos}-${ch}`} className="odo-c" aria-hidden="true">{ch}</span>;
        }
        const d = Number(ch);
        const delay = Math.min(pos - 1, 3) * 18; // las unidades arrancan primero
        return (
          <span key={`d${pos}`} className="odo-d" aria-hidden="true">
            <span className="odo-tape" style={{ transform: `translateY(${-d * 10}%)`, transitionDelay: `${delay}ms` }}>
              {TAPE.map((g) => <span key={g}>{g}</span>)}
            </span>
          </span>
        );
      })}
    </span>
  );
});

export default Odometer;
