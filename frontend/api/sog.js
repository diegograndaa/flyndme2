// Vercel Edge function: warm OG meta-HTML for shared FlyndMe results and group
// invites. Crawlers (WhatsApp/Telegram) fetch THIS page first to discover the
// og:image, so the meta host must never sleep — hence Vercel edge, not the
// Render backend that cold-starts (~30-60s) and times the crawler out, killing
// the preview. Pure function: every display value arrives in the query string
// (same convention as the /api/og image function), so there is NO database
// round-trip on the crawler path. Mirrors the copy of the old backend routes
// (share.js / groups.js `/og`) so the cards are identical. A human who taps the
// link is redirected to the SPA (?share= / ?group=) to load the full result.
export const config = { runtime: "edge" };

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default function handler(req) {
  const { searchParams, origin } = new URL(req.url);
  const get = (k, max = 80) => String(searchParams.get(k) || "").slice(0, max);

  const mode = get("mode", 8);
  const id = get("id", 24);
  const from = get("from", 120);
  const n = get("n", 4);

  // Malformed link → just send people to the home page.
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(id)) return Response.redirect(origin, 302);

  const isGroup = mode === "group";
  const spaUrl = isGroup
    ? `${origin}/?group=${encodeURIComponent(id)}`
    : `${origin}/?share=${encodeURIComponent(id)}`;

  let ogTitle, ogDesc, ogImage;
  if (isGroup) {
    const count = Number(n) || 0;
    ogTitle = "FlyndMe: where should your group meet?";
    ogDesc = count > 0
      ? `${count} ${count === 1 ? "city" : "cities"} added so far. Add yours — FlyndMe finds the cheapest, fairest place for the whole group to meet.`
      : "Add the city you'd fly from — FlyndMe finds the cheapest, fairest place for the whole group to meet.";
    ogImage = `${origin}/api/og?${new URLSearchParams({ mode: "group", n: String(count), from }).toString()}`;
  } else {
    const dest = get("dest", 40);
    const pp = get("pp", 24);
    const total = get("total", 24);
    ogTitle = `FlyndMe: ${from} → ${dest}`;
    ogDesc = total
      ? `Best destination for ${n} travelers. Group total: ${total} · ${pp}/person.`
      : "Find the cheapest place to meet your group.";
    ogImage = `${origin}/api/og?${new URLSearchParams({ dest, pp, from, total, n }).toString()}`;
  }

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/>
<meta property="og:title" content="${escapeHtml(ogTitle)}"/>
<meta property="og:description" content="${escapeHtml(ogDesc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${escapeHtml(spaUrl)}"/>
<meta property="og:site_name" content="FlyndMe"/>
<meta property="og:image" content="${escapeHtml(ogImage)}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:image:alt" content="${escapeHtml(ogTitle)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(ogTitle)}"/>
<meta name="twitter:description" content="${escapeHtml(ogDesc)}"/>
<meta name="twitter:image" content="${escapeHtml(ogImage)}"/>
<meta http-equiv="refresh" content="0;url=${escapeHtml(spaUrl)}"/>
<title>${escapeHtml(ogTitle)}</title>
</head><body><p>Redirecting to <a href="${escapeHtml(spaUrl)}">FlyndMe</a>…</p></body></html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Group cards change as members join (short TTL); result cards are immutable.
      "cache-control": isGroup ? "public, max-age=300" : "public, max-age=3600",
    },
  });
}
