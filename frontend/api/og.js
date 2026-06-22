// Vercel Edge function: dynamic Open Graph image for shared FlyndMe results.
// Renders a 1200x630 card from query params so a shared link previews the actual
// result ("Meet in Paris · 169 € per person") in WhatsApp/Twitter/etc.
//
// The card tree is built WITHOUT JSX (plain element objects) so the exact same
// builder can be rendered to a PNG locally for visual QA, no transpile needed.
import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

const C = {
  ink: "#16173B",
  muted: "#5B5B7A",
  primary: "#AE2F34",
};

// tiny hyperscript -> React/Satori element object
function el(type, style, children) {
  return { type, props: { style: { display: "flex", ...style }, children } };
}

export function buildCard({ dest, pp, from, total, n }) {
  const footerBits = total
    ? `Group total ${total}${n ? `  ·  ${n} travelers` : ""}`
    : "";
  return el(
    "div",
    {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      justifyContent: "space-between",
      background: "linear-gradient(135deg, #FCF8FF 0%, #EEECFF 52%, #FBE3E4 100%)",
      padding: "70px 76px",
      fontFamily: "Jakarta",
    },
    [
      // header / wordmark
      el("div", { alignItems: "center" }, [
        el("div", { width: 38, height: 38, borderRadius: 11, background: C.primary, marginRight: 16 }, []),
        el("div", { fontSize: 36, fontWeight: 800, color: C.ink, letterSpacing: "-0.5px" }, "FlyndMe"),
      ]),
      // headline
      el("div", { flexDirection: "column" }, [
        el("div", { fontSize: 30, color: C.muted, marginBottom: 10 }, "Cheapest place to meet"),
        el("div", { fontSize: 92, fontWeight: 800, color: C.ink, lineHeight: 1.02, letterSpacing: "-1px" }, dest),
        el("div", { fontSize: 54, fontWeight: 800, color: C.primary, marginTop: 14 }, pp ? `${pp} per person` : ""),
      ]),
      // footer
      el("div", { flexDirection: "column" }, [
        el("div", { fontSize: 32, color: C.ink }, from ? `from ${from}` : ""),
        el("div", { fontSize: 26, color: C.muted, marginTop: 8 }, footerBits),
      ]),
    ]
  );
}

async function loadFont(origin) {
  // Prefer a font bundled with the deployment (same-origin, reliable); fall back
  // to a CDN copy of Plus Jakarta Sans if the asset isn't present.
  const sources = [
    origin && `${origin}/fonts/PlusJakartaSans-Bold.woff`,
    "https://cdn.jsdelivr.net/npm/@fontsource/plus-jakarta-sans@5.0.18/files/plus-jakarta-sans-latin-700-normal.woff",
  ].filter(Boolean);
  for (const url of sources) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.arrayBuffer();
    } catch { /* try next */ }
  }
  return null;
}

export default async function handler(req) {
  try {
    const { searchParams, origin } = new URL(req.url);
    // El subset "latin" de la fuente no incluye el glifo € (U+20AC) y el runtime
    // Edge no tiene fallback (en Node sí, por eso en local se veía bien) → el €
    // salía como tofu. Renderizamos "EUR": "€169"/"169 €" → "169 EUR".
    const eur = (s) => String(s || "").replace(/€\s*(\d[\d.,]*)/g, "$1 EUR").replace(/€/g, "EUR").trim();
    const data = {
      dest: (searchParams.get("dest") || "your group").slice(0, 40),
      pp: eur(searchParams.get("pp")).slice(0, 24),
      from: (searchParams.get("from") || "").slice(0, 80),
      total: eur(searchParams.get("total")).slice(0, 24),
      n: (searchParams.get("n") || "").slice(0, 4),
    };
    const font = await loadFont(origin);
    const opts = { width: 1200, height: 630, headers: { "x-og-version": "eur1" } };
    if (font) opts.fonts = [{ name: "Jakarta", data: font, weight: 700, style: "normal" }];
    return new ImageResponse(buildCard(data), opts);
  } catch (e) {
    return new Response(`og error: ${e.message}`, { status: 500 });
  }
}
