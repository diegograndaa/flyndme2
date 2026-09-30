// Vercel Edge function: dynamic Open Graph image for shared FlyndMe results.
// Renders a 1200x630 BOARDING PASS from query params so a shared link previews
// the actual result in WhatsApp/Telegram/Twitter: destination in split-flap
// tiles, price per person, group total and — when the share carries it — the
// real per-origin fare ("who pays what"). Identity of the app (sep-2026):
// paper + ink + signage yellow, IBM Plex Sans/Mono.
//
// The card tree is built WITHOUT JSX (plain element objects) so the exact same
// builder can be rendered to a PNG locally for visual QA, no transpile needed.
// Honesty (rule #1): every number comes from the query (the real result); if a
// value is missing the element is simply not drawn — nothing is invented.
import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

const C = {
  paper: "#F5F3EF",
  card: "#FBF9F5",
  stub: "#F7F4EE",
  ink: "#1A1A1A",
  muted: "#6B6860",
  line: "#E5E0D8",
  dash: "#D6D0C4",
  track: "#ECE7DD",
  tileTop: "#2A2B30",
  tileBot: "#18191C",
  amber: "#FFC20E",   // amarillo de señalética aeroportuaria (acento único)
  amberInk: "#1A1A1A", // texto sobre el amarillo (cartel de dirección)
  good: "#15803D",
  warn: "#B45309",
  bad: "#DC2626",
};
// Logo «Convergencia» (mismo SVG que public/logo-flyndme.svg), embebido para
// no depender de un fetch en el Edge.
const LOGO_URI = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cmVjdCB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHJ4PSI4IiBmaWxsPSIjRkZDMjBFIi8+CiAgPHBhdGggZD0iTTYgOC41QzEzIDguOCAxOS41IDExLjUgMjMuNSAxNiIgc3Ryb2tlPSIjMUExQTFBIiBzdHJva2Utd2lkdGg9IjIuNCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+CiAgPHBhdGggZD0iTTUgMTZIMjMuNSIgc3Ryb2tlPSIjMUExQTFBIiBzdHJva2Utd2lkdGg9IjIuNCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+CiAgPHBhdGggZD0iTTYgMjMuNUMxMyAyMy4yIDE5LjUgMjAuNSAyMy41IDE2IiBzdHJva2U9IiMxQTFBMUEiIHN0cm9rZS13aWR0aD0iMi40IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8Y2lyY2xlIGN4PSIyNCIgY3k9IjE2IiByPSIzLjgiIGZpbGw9IiMxQTFBMUEiLz4KPC9zdmc+Cg==";
const SANS = "Plex";
const MONO = "PlexMono";

// tiny hyperscript -> React/Satori element object
function el(type, style, children) {
  return { type, props: { style: { display: "flex", ...style }, children } };
}

function label(text, extra = {}) {
  return el("div", { fontFamily: MONO, fontSize: 17, letterSpacing: 3, color: C.muted, textTransform: "uppercase", ...extra }, text);
}

// Destination in split-flap tiles; tile size shrinks to fit long names.
function flapTiles(text, maxWidth = 690) {
  const chars = [...String(text || "").toUpperCase()].slice(0, 18);
  const n = chars.length || 1;
  const gap = 6;
  const w = Math.max(30, Math.min(66, Math.floor((maxWidth - gap * (n - 1)) / n)));
  const h = Math.round(w * 1.36);
  return el("div", { flexDirection: "row", alignItems: "center" }, chars.map((ch, i) => (
    ch === " "
      ? el("div", { width: Math.round(w * 0.45), height: h }, [])
      : el("div", {
          position: "relative",
          width: w, height: h,
          marginLeft: i === 0 ? 0 : gap,
          alignItems: "center", justifyContent: "center",
          borderRadius: Math.round(w * 0.12),
          backgroundImage: `linear-gradient(180deg, ${C.tileTop} 0%, ${C.tileTop} 50%, ${C.tileBot} 50%, ${C.tileBot} 100%)`,
          color: "#FFFFFF",
          fontFamily: MONO,
          fontSize: Math.round(w * 0.92),
        }, [
          ch,
          el("div", { position: "absolute", left: 0, right: 0, top: Math.round(h / 2) - 1, height: 2, background: "rgba(0,0,0,.45)" }, []),
        ])
  )));
}

// Deterministic "barcode" from a seed string (decorative only).
function barcode(seed, height = 64) {
  let x = 0;
  for (const c of String(seed || "FLYNDME")) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  const bars = [];
  for (let i = 0; i < 52; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    const w = 1 + ((x >>> 16) % 5);
    bars.push(el("div", { width: w, height, background: i % 2 === 0 ? C.ink : "transparent" }, []));
  }
  return el("div", { flexDirection: "row", alignItems: "flex-end", opacity: 0.85 }, bars);
}

// "MAD:135,LON:300" → [{ code, price }] (only well-formed entries, max 6)
export function parseLegs(raw) {
  return String(raw || "")
    .split(",")
    .map((p) => p.trim().match(/^([A-Z]{3}):(\d{1,5})$/))
    .filter(Boolean)
    .slice(0, 6)
    .map((m) => ({ code: m[1], price: Number(m[2]) }));
}

// Same colouring rule as the app's "who pays what" strip (payColor).
function payColor(price, avg) {
  const r = avg > 0 ? price / avg : 1;
  if (r <= 1.05) return C.good;
  if (r <= 1.25) return C.warn;
  return C.bad;
}

function whoPays(legs) {
  if (legs.length < 2) return null;
  const max = Math.max(...legs.map((l) => l.price));
  const avg = legs.reduce((s, l) => s + l.price, 0) / legs.length;
  const rowH = legs.length > 4 ? 22 : 28;
  return el("div", { flexDirection: "column" }, [
    label("Who pays what", { marginBottom: 10 }),
    ...legs.map((l) => el("div", { flexDirection: "row", alignItems: "center", height: rowH }, [
      el("div", { width: 64, fontFamily: MONO, fontSize: rowH - 6, color: C.ink }, l.code),
      el("div", { width: 440, height: 12, borderRadius: 6, background: C.track }, [
        el("div", { width: Math.max(18, Math.round(440 * l.price / max)), height: 12, borderRadius: 6, background: payColor(l.price, avg) }, []),
      ]),
      el("div", { marginLeft: 16, fontFamily: MONO, fontSize: rowH - 6, color: C.ink }, `€${l.price}`),
    ])),
  ]);
}

// Shared boarding-pass shell: left main area + perforation + right stub.
function passShell({ kicker, main, stub, seed }) {
  return el("div", {
    width: "100%", height: "100%",
    background: C.paper,
    padding: 40,
    fontFamily: SANS,
  }, [
    el("div", {
      position: "relative",
      width: 1120, height: 550,
      flexDirection: "row",
      background: C.card,
      border: `2px solid ${C.line}`,
      borderRadius: 12,
      overflow: "hidden",
    }, [
      // main
      el("div", { width: 780, height: "100%", flexDirection: "column", justifyContent: "space-between", padding: "40px 46px" }, [
        el("div", { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, [
          el("div", { flexDirection: "row", alignItems: "center" }, [
            { type: "img", props: { src: LOGO_URI, width: 38, height: 38, style: { marginRight: 14 } } },
            el("div", { fontSize: 32, color: C.ink, letterSpacing: -0.5 }, "FlyndMe"),
          ]),
          label(kicker),
        ]),
        ...main,
      ]),
      // perforation
      el("div", { width: 0, height: "100%", borderLeft: `3px dashed ${C.dash}` }, []),
      // stub
      el("div", { flexGrow: 1, height: "100%", flexDirection: "column", justifyContent: "space-between", padding: "40px 36px", background: C.stub }, [
        el("div", { flexDirection: "column" }, stub),
        barcode(seed),
      ]),
      // notches (half circles of the paper colour on the perforation)
      el("div", { position: "absolute", left: 780 - 22, top: -24, width: 46, height: 46, borderRadius: 23, background: C.paper, border: `2px solid ${C.line}` }, []),
      el("div", { position: "absolute", left: 780 - 22, bottom: -24, width: 46, height: 46, borderRadius: 23, background: C.paper, border: `2px solid ${C.line}` }, []),
      // signage-yellow accent strip on top of the stub
      el("div", { position: "absolute", left: 783, right: 0, top: 0, height: 8, background: C.amber }, []),
    ]),
  ]);
}

export function buildCard({ mode, dest, pp, from, total, n, legs }) {
  // Group-invite variant: a group has no computed price yet (only origins), so
  // the card invites participation instead of announcing a winner.
  if (mode === "group") return buildGroupCard({ from, n });
  const legList = parseLegs(legs);
  const pays = whoPays(legList);
  const main = [
    el("div", { flexDirection: "column" }, [
      label("Meeting point", { marginBottom: 14 }),
      flapTiles(dest),
    ]),
    pays || el("div", { fontFamily: MONO, fontSize: 26, color: C.ink }, from ? `FROM ${from.toUpperCase()}` : ""),
  ];
  const stub = [
    label("Per person"),
    el("div", { fontFamily: MONO, fontSize: 76, color: C.ink, marginTop: 4, letterSpacing: -2 }, pp || "—"),
    total ? label("Group total", { marginTop: 22 }) : null,
    total ? el("div", { fontFamily: MONO, fontSize: 40, color: C.ink, marginTop: 2 }, total) : null,
    n ? label(`${n} travelers`, { marginTop: 18, color: C.amberInk, background: C.amber, padding: "5px 12px", borderRadius: 4, alignSelf: "flex-start" }) : null,
    // Regla de datos: todo importe es una estimación, no una oferta reservable
    label("Estimate · recent searches", { marginTop: 18, fontSize: 13, letterSpacing: 2 }),
  ].filter(Boolean);
  return passShell({ kicker: "Group boarding pass", main, stub, seed: `${dest}${pp}` });
}

// Group-invite card: same boarding-pass shell, framed as a call to join —
// there's no destination or price for a group yet, so the tiles read "???".
export function buildGroupCard({ from, n }) {
  const count = Number(n) || 0;
  const sub = count > 0
    ? `${count} ${count === 1 ? "city" : "cities"} in · add yours`
    : "Add the city you'd fly from";
  const main = [
    el("div", { flexDirection: "column" }, [
      label("Meeting point", { marginBottom: 14 }),
      el("div", { flexDirection: "row", alignItems: "center" }, [
        flapTiles("???", 240),
        el("div", { marginLeft: 26, fontSize: 44, color: C.ink, lineHeight: 1.1, maxWidth: 420 }, "Where should we all meet?"),
      ]),
    ]),
    el("div", { flexDirection: "column" }, [
      el("div", { fontSize: 34, color: C.ink }, sub),
      el("div", { fontFamily: MONO, fontSize: 22, color: C.muted, marginTop: 10 }, from ? `FROM ${from.toUpperCase()}` : ""),
    ]),
  ];
  const stub = [
    label("Status"),
    el("div", { fontFamily: MONO, fontSize: 44, color: C.ink, marginTop: 4 }, "BOARDING"),
    label("Travelers", { marginTop: 22 }),
    el("div", { fontFamily: MONO, fontSize: 44, color: C.ink, marginTop: 2 }, String(count || "—")),
    label("Everyone pays fair", { marginTop: 18, color: C.amberInk, background: C.amber, padding: "5px 12px", borderRadius: 4, alignSelf: "flex-start" }),
  ];
  return passShell({ kicker: "Group trip · open", main, stub, seed: `group${from}` });
}

async function loadFirst(sources) {
  for (const url of sources.filter(Boolean)) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.arrayBuffer();
    } catch { /* try next */ }
  }
  return null;
}

async function loadFonts(origin) {
  // Prefer the fonts bundled with the deployment (same-origin, reliable): IBM
  // Plex subsets with Latin + Latin-Extended + currency (€, accented Spanish/
  // French/German and Polish/Czech city names), because the Edge runtime has
  // no system-font fallback. CDN copies as a fallback.
  const [sans, mono] = await Promise.all([
    loadFirst([
      origin && `${origin}/fonts/IBMPlexSans-Bold-latin.woff`,
      "https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans@5.0.8/files/ibm-plex-sans-latin-ext-700-normal.woff",
    ]),
    loadFirst([
      origin && `${origin}/fonts/IBMPlexMono-SemiBold-latin.woff`,
      "https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5.0.8/files/ibm-plex-mono-latin-ext-600-normal.woff",
    ]),
  ]);
  const fonts = [];
  if (sans) fonts.push({ name: SANS, data: sans, weight: 700, style: "normal" });
  if (mono) fonts.push({ name: MONO, data: mono, weight: 600, style: "normal" });
  return fonts;
}

export default async function handler(req) {
  try {
    const { searchParams, origin } = new URL(req.url);
    const str = (k, max) => String(searchParams.get(k) || "").slice(0, max);
    const data = {
      mode: str("mode", 8),
      dest: (searchParams.get("dest") || "your group").slice(0, 40),
      pp: str("pp", 24),
      from: str("from", 80),
      total: str("total", 24),
      n: str("n", 4),
      legs: str("legs", 120),
    };
    const fonts = await loadFonts(origin);
    const opts = { width: 1200, height: 630 };
    if (fonts.length) opts.fonts = fonts;
    return new ImageResponse(buildCard(data), opts);
  } catch (e) {
    return new Response(`og error: ${e.message}`, { status: 500 });
  }
}
