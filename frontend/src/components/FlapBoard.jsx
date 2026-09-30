// ─── FlapBoard ───────────────────────────────────────────────────────────────
// Tipografía de panel de salidas de aeropuerto (split-flap). Cada carácter va
// en su propia celda; al montarse (o al cambiar el texto) las celdas "giran"
// por caracteres aleatorios y se asientan de izquierda a derecha en el valor
// real. Puramente cosmético: el SSR y el primer render pintan ya el texto
// FINAL (nunca se muestra un valor inventado como si fuera real), y con
// prefers-reduced-motion no hay giro. Lectores de pantalla: aria-label con el
// texto final y celdas aria-hidden.
import React, { useEffect, useRef, useState } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function prefersReducedMotion() {
  try {
    return typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch { return false; }
}

function randomGlyph() {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}

/**
 * Hook: devuelve el texto a pintar mientras "gira" hacia `text`.
 * `settleMs` = duración total; cada celda se asienta escalonada.
 */
function useFlap(text, { settleMs = 700, delay = 0 } = {}) {
  const target = String(text ?? "");
  // En cliente el primer frame ya sale "barajado" (si no, se vería el texto
  // final un instante y luego giraría). En SSR/tests o con movimiento
  // reducido, texto final directamente.
  const [shown, setShown] = useState(() => (
    typeof window === "undefined" || prefersReducedMotion()
      ? target
      : [...target].map((ch) => (/[A-Za-z0-9]/.test(ch) ? randomGlyph() : ch)).join("")
  ));
  const rafRef = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion() || !target) { setShown(target); return undefined; }
    let start = null;
    const chars = [...target];
    const n = chars.length;
    const tick = (now) => {
      if (start === null) start = now + delay;
      const t = now - start;
      if (t < 0) { rafRef.current = requestAnimationFrame(tick); return; }
      let done = true;
      const out = chars.map((ch, i) => {
        // la celda i se asienta en settleMs * (i+1)/n
        const settleAt = settleMs * ((i + 1) / n);
        if (t >= settleAt || !/[A-Za-z0-9]/.test(ch)) return ch;
        done = false;
        return randomGlyph();
      });
      setShown(out.join(""));
      if (!done) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, settleMs, delay]);

  return shown;
}

/**
 * Texto en celdas de panel de salidas.
 * @param {string} text     texto final (se pinta en mayúsculas)
 * @param {"sm"|"md"|"lg"} size
 * @param {number} delay    retardo antes de empezar a girar (ms)
 */
export const FlapText = React.memo(function FlapText({ text, size = "md", delay = 0, settleMs, className = "" }) {
  const target = String(text ?? "").toUpperCase();
  const shown = useFlap(target, { delay, settleMs: settleMs ?? Math.min(1100, 260 + target.length * 90) });
  return (
    <span className={`flap flap--${size} ${className}`.trim()}>
      <span className="flap-sr">{target.trim()}</span>
      {[...shown].map((ch, i) => (
        ch === " "
          ? <span key={i} className="flap-gap" aria-hidden="true" />
          // key con el carácter: cada cambio remonta la celda y dispara el
          // mini-giro CSS (.flap-cell → flap-tick)
          : <span key={`${i}-${ch}`} className="flap-cell" aria-hidden="true">{ch}</span>
      ))}
    </span>
  );
});

/**
 * Rota por una lista de palabras cada `interval` ms, girando entre ellas.
 * Para ejemplos ILUSTRATIVOS (sin precios): p.ej. destinos de ejemplo del hero.
 */
export const FlapCycle = React.memo(function FlapCycle({ words = [], interval = 2800, size = "md", className = "" }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!words.length || prefersReducedMotion()) return undefined;
    const id = setInterval(() => setIdx((i) => (i + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [words.length, interval]);
  // Ancho estable: rellena a la palabra más larga para que no "baile" el layout
  const maxLen = words.reduce((m, w) => Math.max(m, String(w).length), 0);
  const word = String(words[idx] ?? "").toUpperCase().padEnd(maxLen, " ");
  return <FlapText text={word} size={size} className={className} settleMs={520} />;
});

export default FlapText;
