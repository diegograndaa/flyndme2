// ─── Auditoría de paridad claro / oscuro ────────────────────────────────────
// Regla del proyecto (oct-2026): cambiar de tema cambia el SOPORTE (papel ↔
// pantalla) y la TINTA (carbón ↔ hueso), nada más. Este script lo comprueba:
// carga la app, alterna data-theme sobre el MISMO DOM y compara pieza a pieza
// el PAPEL de cada color (neutro / amarillo / verde / rojo), la presencia de
// fondos, bordes, sombras y contornos, la geometría y el contraste AA.
//
// No es un test de `npm test` (necesita un navegador). Uso, con la app en
// local en modo mock (ver «Smoke visual local» en CLAUDE.md):
//   PLAYWRIGHT=/ruta/a/playwright/index.mjs CHROME=/ruta/a/chrome \
//   node scripts/theme-parity-audit.mjs 390     # móvil
//   node scripts/theme-parity-audit.mjs 1366    # escritorio
// Sale con código 1 si queda alguna diferencia. Playwright NO es dependencia
// del repo: se usa uno global/externo (no añadirlo a package.json).
//
// Excepciones aceptadas por diseño (constantes SIGN y DECOR, abajo):
//   · Cartel de posición (opción/pestaña activa, pasos): NEGRO + amarillo en
//     los dos temas; de noche lo dibuja su filete, no el contraste del fondo.
//   · Fichas split-flap, tooltips y fichas del mapa: mismo objeto en ambos.
const PLAYWRIGHT = process.env.PLAYWRIGHT || 'playwright';
const CHROME = process.env.CHROME || undefined;
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const { chromium } = await import(PLAYWRIGHT);
const vw = Number(process.argv[2] || 390);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
const ctx = await browser.newContext({ viewport: { width: vw, height: 844 }, isMobile: vw < 700, hasTouch: vw < 700, reducedMotion: 'reduce', locale: 'es-ES' });
await ctx.addInitScript(() => { try { localStorage.setItem('flyndme_theme', 'light'); localStorage.setItem('flyndme_lang', 'es'); } catch {} });
const page = await ctx.newPage();
const dep = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);

const collect = () => page.evaluate(() => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return [0,0,0,0]; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return [p[0],p[1],p[2],p[3] === undefined ? 1 : p[3]]; };
  const lum = ([r,g,b]) => { const f = (v) => { v/=255; return v <= .03928 ? v/12.92 : ((v+.055)/1.055)**2.4; }; return .2126*f(r)+.7152*f(g)+.0722*f(b); };
  const blend = (fg, bg) => { const a = fg[3]; return [0,1,2].map(i => fg[i]*a + bg[i]*(1-a)).concat(1); };
  const effBg = (el) => { const stack = []; let n = el; while (n && n.nodeType === 1) { const c = parse(getComputedStyle(n).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] >= 1) break; n = n.parentElement; } let base = parse(getComputedStyle(document.documentElement).backgroundColor); if (base[3] === 0) base = [255,255,255,1]; let out = base; for (let i = stack.length - 1; i >= 0; i--) out = blend(stack[i], out); return out; };
  const hue = ([r,g,b]) => { r/=255; g/=255; b/=255; const mx = Math.max(r,g,b), mn = Math.min(r,g,b), d = mx-mn; const l = (mx+mn)/2; const s = d === 0 ? 0 : d/(1-Math.abs(2*l-1)); let h = 0; if (d) { if (mx===r) h = ((g-b)/d)%6; else if (mx===g) h = (b-r)/d+2; else h = (r-g)/d+4; h*=60; if (h<0) h+=360; } return [h,s,l]; };
  const role = (c) => { const [h,s,l] = hue(c); const chroma = Math.max(c[0],c[1],c[2]) - Math.min(c[0],c[1],c[2]); if (chroma < 30) return 'neutro'; if (h >= 30 && h <= 62) return (l > .82 || l < .2) ? 'amarillo-tenue' : 'amarillo'; if (h > 62 && h < 190) return 'verde'; if (h < 30 || h > 330) return 'rojo/naranja'; return 'azul/violeta'; };
  const cr = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la,lb)+.05)/(Math.min(la,lb)+.05); };
  const bucket = (x, cuts, names) => { for (let i = 0; i < cuts.length; i++) if (x < cuts[i]) return names[i]; return names[names.length-1]; };
  const out = [];
  const all = document.querySelectorAll('body *');
  let idx = 0;
  for (const el of all) {
    idx++;
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg' ) { /* se miran abajo */ }
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2 || r.height < 2) { out.push({ idx, hidden: true, sig: sigOf(el) }); continue; }
    const parentBg = el.parentElement ? effBg(el.parentElement) : [255,255,255,1];
    const ownBgRaw = parse(cs.backgroundColor);
    const ownBg = ownBgRaw[3] > 0 ? blend(ownBgRaw, parentBg) : parentBg;
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const isSvgShape = !!el.closest('svg');
    const rec = { idx, sig: sigOf(el), w: Math.round(r.width), h: Math.round(r.height) };
    // fondo
    if (!isSvgShape) {
      const hasImg = cs.backgroundImage !== 'none';
      rec.fondo = hasImg ? 'imagen/degradado' : (ownBgRaw[3] === 0 || cr(ownBg, parentBg) < 1.02) ? 'ninguno' : (ownBgRaw[3] < .35 ? 'velo-' : '') + role(ownBg) + '·' + (role(ownBg) !== 'neutro' ? 'color' : cr(ownBg, parentBg) < 1.9 ? 'sutil' : cr(ownBg, parentBg) < 4.5 ? 'medio' : 'FUERTE');
      for (const side of ['Top','Right','Bottom','Left']) {
        const wdt = parseFloat(cs['border'+side+'Width']); const st = cs['border'+side+'Style']; const col = parse(cs['border'+side+'Color']);
        rec['borde'+side] = (wdt === 0 || st === 'none' || col[3] === 0) ? 'ninguno' : `${wdt}px ${st} ` + role(blend(col, ownBg)) + (cr(blend(col, ownBg), ownBg) < 1.06 ? '·invisible' : '');
      }
      rec.radio = cs.borderTopLeftRadius; rec.padding = cs.padding; rec.sombra = cs.boxShadow === 'none' ? 'no' : 'sí';
      rec.outline = cs.outlineStyle === 'none' ? 'no' : cs.outlineWidth;
      rec.opacidad = cs.opacity; rec.display = cs.display; rec.filtro = cs.filter; rec.mezcla = cs.mixBlendMode;
    }
    if (hasText) {
      const col = parse(cs.color);
      rec.texto = role(blend(col, ownBg));
      rec.fuente = `${cs.fontSize}/${cs.fontWeight}`; rec.deco = cs.textDecorationLine; rec.transf = cs.textTransform; rec.espaciado = cs.letterSpacing;
      let gi = el, grad = false; while (gi && gi !== document.body) { if (getComputedStyle(gi).backgroundImage !== 'none') { grad = true; break; } if (parse(getComputedStyle(gi).backgroundColor)[3] >= 1) break; gi = gi.parentElement; }
      if (!grad && col[3] > 0 && cs.webkitTextStrokeWidth === '0px') rec.contraste = Math.round(cr(blend(col, ownBg), ownBg) * 10) / 10;
    }
    if (isSvgShape || el.tagName.toLowerCase() === 'svg') {
      const st = parse(cs.stroke), fl = parse(cs.fill);
      if (cs.stroke !== 'none' && st[3] > 0) rec.trazo = role(blend(st, parentBg)) + (cr(blend(st, parentBg), parentBg) < 1.25 ? '·invisible' : '') + ' ' + cs.strokeWidth;
      if (isSvgShape && /^(path|circle|rect|polygon|text|ellipse|line|polyline|tspan)$/.test(el.tagName.toLowerCase()) && cs.fill !== 'none' && fl[3] > 0) rec.relleno = role(blend(fl, parentBg)) + (cr(blend(fl, parentBg), parentBg) < 1.25 ? '·invisible' : '');
      rec.opacidad = cs.opacity;
    }
    for (const pe of ['::before', '::after']) {
      const p = getComputedStyle(el, pe);
      if (p.content === 'none' || p.content === 'normal' || p.display === 'none') { rec['p' + pe] = 'no'; continue; }
      const b = parse(p.backgroundColor), c = parse(p.color);
      rec['p' + pe] = `fondo:${p.backgroundImage !== 'none' ? 'img' : b[3] === 0 ? 'ninguno' : role(blend(b, ownBg)) + (cr(blend(b, ownBg), ownBg) < 1.03 ? '·igual' : '')} op:${p.opacity} ${p.content.length > 2 && p.content !== '""' ? 'txt:' + role(blend(c, ownBg)) : ''} bt:${p.borderTopWidth}`;
    }
    out.push(rec);
  }
  return out;
  function sigOf(el) { const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).join('.'); const par = el.parentElement ? (el.parentElement.getAttribute('class') || '').trim().split(/\s+/)[0] : ''; return `${par ? par + ' > ' : ''}${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`; }
});

const setTheme = async (th) => { await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), th); await page.waitForTimeout(350); };
const diffState = async (name) => {
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important}' }).catch(() => {});
  await setTheme('light'); const L = await collect();
  await setTheme('dark'); const D = await collect();
  await setTheme('light');
  const seen = new Map();
  for (let i = 0; i < L.length; i++) {
    const a = L[i], b = D[i]; if (!b || a.sig !== b.sig) continue;
    if (a.hidden && b.hidden) continue;
    const diffs = [];
    if (!!a.hidden !== !!b.hidden) diffs.push(`VISIBILIDAD claro=${a.hidden ? 'oculto' : 'visible'} oscuro=${b.hidden ? 'oculto' : 'visible'}`);
    else for (const k of Object.keys(a)) { if (['idx', 'sig', 'contraste'].includes(k)) continue; if ((k === 'w' || k === 'h') && (/typing|flap|odo/.test(a.sig) || Math.abs(a[k] - b[k]) < 2)) continue; if (k === 'fondo' && /neutro/.test(a[k]) && /neutro/.test(b[k]) && !(/FUERTE/.test(a[k]) !== /FUERTE/.test(b[k]) && (/sutil/.test(a[k]) || /sutil/.test(b[k])))) continue; if (String(a[k]) !== String(b[k])) diffs.push(`${k}: ${a[k]}  →  ${b[k]}`); }
    if (a.contraste && a.contraste < 4.5) diffs.push(`CONTRASTE claro ${a.contraste}`);
    if (b.contraste && b.contraste < 4.5) diffs.push(`CONTRASTE oscuro ${b.contraste}`);
    // Aceptado por diseño: el cartel de posición es NEGRO en los dos temas (de noche lo dibuja su filete amarillo)
    const SIGN = /sf-pill--active|rv-tab--active|wc-criterion-pill--active|fm-split-pill--active|lp-step-num|cmp-rank|fm-notice-tag|fm-lang-btn--active|sf-ac-item--hl|sk-step-dot/;
    const DECOR = /dm-tooltip|dm-key--dest|dm-key--origin|dm-chip-bg|dm-chip-text|dm-dot--best|fm-sticky-inner|cv-lit|cv-dest-pin|cv-origin-lit|fm-flight-head-arrow|wc-image-wrap|flap-cell|sf-summary-chip|sf-ac-code/;
    for (let k = diffs.length - 1; k >= 0; k--) {
      if (SIGN.test(a.sig) && /^(fondo: neutro·FUERTE|outline|sombra)/.test(diffs[k])) diffs.splice(k, 1);
      else if (DECOR.test(a.sig)) diffs.splice(k, 1);
      else if (/wc-stamp/.test(a.sig) && /^mezcla/.test(diffs[k])) diffs.splice(k, 1);
    }
    if (diffs.length) { const key = a.sig + '|' + diffs.join('|'); seen.set(key, { sig: a.sig, diffs, n: (seen.get(key)?.n || 0) + 1 }); }
  }
  console.log(`\n=== ${name} (${vw}px) — ${seen.size} piezas distintas ===`);
  for (const v of seen.values()) console.log(`• ${v.sig}${v.n > 1 ? ' ×' + v.n : ''}\n    ` + v.diffs.join('\n    '));
  return seen.size;
};
let total = 0;
await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
total += await diffState('home');
await page.goto(`${BASE}/?o=MAD&o=LON&o=BER&dep=${dep}&trip=roundtrip`, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
const adv = await page.$('.sf-advanced-toggle, .sf-more-toggle'); if (adv) await adv.click().catch(() => {});
await page.waitForTimeout(300);
total += await diffState('formulario relleno');
await page.goto(`${BASE}/?o=MAD&o=LON&o=BER&dep=${dep}&trip=oneway`, { waitUntil: 'networkidle' });
await page.click('button[type=submit]'); await page.waitForSelector('.rv-tab', { timeout: 30000 }); await page.waitForTimeout(1500);
for (const d of await page.$$('details')) await d.evaluate((n) => { n.open = true; });
const fl = await page.$('.wc-flight-route, button[aria-expanded="false"].wc-fl-route'); if (fl) await fl.click().catch(() => {});
await page.waitForTimeout(400);
total += await diffState('resultados');
const tabs = await page.$$('.rv-tab');
for (let i = 0; i < tabs.length; i++) { await tabs[i].click(); await page.waitForTimeout(700); total += await diffState('resultados · pestaña ' + ['mapa','comparar','más'][i]); }
console.log('\nTOTAL', total);
await browser.close();
process.exit(total ? 1 : 0);
