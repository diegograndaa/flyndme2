import { useEffect, useState } from "react";

const MESSAGES = [
  "Connecting to airlines…",
  "Waking up the server — hang tight…",
  "Searching flights from your cities…",
  "Calculating group total cost…",
  "Evaluating fairness between travelers…",
  "Almost there…",
];

/**
 * Thin animated progress bar at the top of the page — non-blocking.
 * Replaces the old full-screen overlay so the user can keep reading
 * while the search runs.
 */
export function SearchProgress({ loading }) {
  const [step, setStep]       = useState(0);
  const [width, setWidth]     = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!loading) {
      // Finish animation then hide
      setWidth(100);
      const t = setTimeout(() => { setVisible(false); setWidth(0); setStep(0); }, 400);
      return () => clearTimeout(t);
    }

    setVisible(true);
    setWidth(8);
    setStep(0);

    // Advance message every 1.8 s
    const msgTimer = setInterval(() => {
      setStep((p) => (p + 1) % MESSAGES.length);
    }, 1800);

    // Simulate progress (asymptotic — never quite reaches 95 % while loading)
    const progTimer = setInterval(() => {
      setWidth((w) => w + (95 - w) * 0.12);
    }, 600);

    return () => { clearInterval(msgTimer); clearInterval(progTimer); };
  }, [loading]);

  if (!visible) return null;

  return (
    <>
      {/* Progress bar */}
      <div
        role="progressbar"
        aria-label="Searching flights"
        style={{
          position:   "fixed",
          top:        0,
          left:       0,
          width:      `${width}%`,
          height:     3,
          background: "linear-gradient(90deg, #0062E3 0%, #05C3A8 100%)",
          transition: loading ? "width 0.6s ease" : "width 0.35s ease",
          zIndex:     9999,
          borderRadius: "0 2px 2px 0",
        }}
      />

      {/* Status chip */}
      {loading && (
        <div
          style={{
            position:   "fixed",
            bottom:     24,
            left:       "50%",
            transform:  "translateX(-50%)",
            background: "#111827",
            color:      "#F8FAFC",
            borderRadius: 999,
            padding:    "10px 20px",
            display:    "flex",
            alignItems: "center",
            gap:        12,
            fontSize:   14,
            fontWeight: 500,
            boxShadow:  "0 8px 32px rgba(0,0,0,0.35)",
            zIndex:     9998,
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width:         14,
              height:        14,
              border:        "2px solid rgba(255,255,255,0.3)",
              borderTopColor:"#05C3A8",
              borderRadius:  "50%",
              display:       "inline-block",
              animation:     "spin 0.7s linear infinite",
              flexShrink:    0,
            }}
          />
          {MESSAGES[step]}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

/**
 * Legacy named export — kept so existing imports don't break.
 */
export function LoadingOverlay({ loading }) {
  return <SearchProgress loading={loading} />;
}
