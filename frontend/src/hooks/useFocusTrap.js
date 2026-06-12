// ─── useFocusTrap ────────────────────────────────────────────────────────────
// Trap de foco mínimo para paneles modales (favoritos, atajos, drawer móvil).
// Al abrirse: mueve el foco al primer elemento focusable del panel.
// Mientras está abierto: Tab/Shift+Tab ciclan dentro; Escape llama a onClose.
// Al cerrarse: devuelve el foco al elemento que lo abrió.
// Sin librerías: listener en document en fase de captura, así recupera el foco
// aunque se pierda hacia <body> y Escape no llega al handler global de App.jsx
// (que si no, además de cerrar el panel navegaría hacia atrás entre vistas).
import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(active, onClose) {
  const containerRef = useRef(null);
  // El handler vive en una ref para no re-montar el trap si cambia el closure.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const opener = document.activeElement;
    const focusables = () =>
      Array.from(container.querySelectorAll(FOCUSABLE))
        // offsetParent === null ⇒ oculto (display:none); descartarlo evita
        // "focusear" controles invisibles (p. ej. el botón de cerrar el drawer
        // móvil cuando los estilos de escritorio lo esconden).
        .filter((el) => el.offsetParent !== null);

    const initial = focusables()[0];
    if (initial) initial.focus();
    else { container.tabIndex = -1; container.focus(); }

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (!els.length) { e.preventDefault(); return; }
      const first = els[0];
      const last = els[els.length - 1];
      const current = document.activeElement;
      if (!container.contains(current)) {
        e.preventDefault(); first.focus();
      } else if (e.shiftKey && current === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault(); first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Devolver el foco a quien abrió el panel (si sigue en el DOM).
      if (opener && typeof opener.focus === "function" && document.contains(opener)) {
        opener.focus();
      }
    };
  }, [active]);

  return containerRef;
}
