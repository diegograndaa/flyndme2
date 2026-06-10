// ─── Landing ─────────────────────────────────────────────────────────────────
// Extraída de App.jsx (Mejora 26): página de inicio con hero, demo animada,
// stats, FAQ y CTAs de inicio de búsqueda. Autocontenida.
import React, { useEffect, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { countryFlag } from "../utils/helpers";
import { AnimatedStat } from "./UiBits";

const FaqItem = React.memo(function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`lp-faq-item${open ? " lp-faq-item--open" : ""}`}>
      <button type="button" className="lp-faq-q" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{q}</span>
        <span className="lp-faq-chevron">{open ? "−" : "+"}</span>
      </button>
      <div className="lp-faq-a-wrap">
        <div className="lp-faq-a">{a}</div>
      </div>
    </div>
  );
});

function LandingMiniDemo({ t }) {
  const [step, setStep] = useState(0);
  const steps = [
    { origins: ["MAD"], dest: "", price: "" },
    { origins: ["MAD", "LON"], dest: "", price: "" },
    { origins: ["MAD", "LON", "BER"], dest: "", price: "" },
    { origins: ["MAD", "LON", "BER"], dest: "LIS", price: "€89" },
  ];
  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 1200);
    const t2 = setTimeout(() => setStep(2), 2400);
    const t3 = setTimeout(() => setStep(3), 3800);
    const t4 = setTimeout(() => setStep(0), 7000);
    const interval = setInterval(() => {
      setStep(0);
      setTimeout(() => setStep(1), 1200);
      setTimeout(() => setStep(2), 2400);
      setTimeout(() => setStep(3), 3800);
    }, 7000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearInterval(interval); };
  }, []);

  const cur = steps[step];
  return (
    <div className="lp-mini-demo">
      <div className="lp-mini-demo-window">
        <div className="lp-mini-demo-bar">
          <span className="lp-mini-demo-dot lp-mini-demo-dot--red" />
          <span className="lp-mini-demo-dot lp-mini-demo-dot--yellow" />
          <span className="lp-mini-demo-dot lp-mini-demo-dot--green" />
          <span className="lp-mini-demo-bar-title">FlyndMe</span>
        </div>
        <div className="lp-mini-demo-body">
          <div className="lp-mini-demo-origins">
            {cur.origins.map((o, i) => (
              <span key={o} className="lp-mini-demo-chip" style={{ animationDelay: `${i * 0.15}s` }}>
                {countryFlag(o)} {o}
              </span>
            ))}
          </div>
          {cur.dest && (
            <div className="lp-mini-demo-result">
              <span className="lp-mini-demo-arrow">→</span>
              <span className="lp-mini-demo-dest">{countryFlag(cur.dest)} {cur.dest}</span>
              <span className="lp-mini-demo-price">{cur.price}/pp</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const Landing = React.memo(function Landing({ onStart, onStartWithRoute }) {
  const { t } = useI18n();

  const chips = t("landing.chips");
  const steps = t("landing.steps");
  const faqs  = t("landing.faqs");

  // Social proof: pseudo-random daily counter (deterministic per day)
  const [socialCount] = useState(() => {
    const today = new Date();
    const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    return 120 + (seed % 180); // 120-299 range, varies daily
  });

  return (
    <>
      {/* Hero */}
      <section className="lp-hero">
        <div className="container" style={{ maxWidth: 1080 }}>
          <div className="row g-5 align-items-center">
            <div className="col-lg-6">
              <span className="lp-eyebrow">{t("landing.eyebrow")}</span>
              <h1 className="lp-h1">{t("landing.title")}</h1>
              <p className="lp-lead">{t("landing.lead")}</p>
              <button className="btn-fm-primary btn-lg-fm" onClick={onStart} type="button">
                {t("landing.cta")}
              </button>
              <div className="lp-social-proof mt-3">
                <span className="lp-social-dot" />
                <span className="lp-social-text">{t("social.counter", { n: socialCount })}</span>
              </div>
              <div className="lp-live-stats mt-2">
                <span className="lp-live-stat">
                  <AnimatedStat value={42} /> {t("landing.statDestinations")}
                </span>
                <span className="lp-live-stat-sep">·</span>
                <span className="lp-live-stat">
                  <AnimatedStat value={6} /> {t("landing.statOrigins")}
                </span>
                <span className="lp-live-stat-sep">·</span>
                <span className="lp-live-stat">
                  <AnimatedStat value={252} /> {t("landing.statRoutes")}
                </span>
              </div>
              <div className="lp-chips mt-3">
                {Array.isArray(chips) && chips.map((c) => (
                  <span key={c} className="lp-chip">{c}</span>
                ))}
              </div>
            </div>

            <div className="col-lg-6">
              <div className="lp-card">
                <div className="lp-card-title">{t("landing.howTitle")}</div>
                <ul className="lp-steps">
                  {Array.isArray(steps) && steps.map((s, i) => (
                    <li key={i}><span className="lp-step-num">{i + 1}</span>{s}</li>
                  ))}
                </ul>
                <div className="lp-card-meta">
                  <span>{t("landing.metaSource")}</span>
                  <span>{t("landing.metaTime")}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust badges */}
      <section className="lp-trust">
        <div className="container" style={{ maxWidth: 1080 }}>
          <div className="lp-trust-grid">
            {(t("landing.trustBadges") || []).map((b, i) => (
              <div key={i} className="lp-trust-badge">
                <span className="lp-trust-icon">{b.icon}</span>
                <span className="lp-trust-text">{b.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Animated mini demo */}
      <section className="lp-demo-section">
        <div className="container" style={{ maxWidth: 1080 }}>
          <LandingMiniDemo t={t} />
        </div>
      </section>

      {/* Example preview */}
      <section className="lp-example">
        <div className="container" style={{ maxWidth: 1080 }}>
          <h2 className="lp-example-title">{t("landing.exampleTitle")}</h2>
          <p className="lp-example-sub">{t("landing.exampleSub")}</p>
          <div className="lp-example-card">
            <div className="lp-example-origins">
              <span className="lp-example-origin">MAD <span>Madrid</span></span>
              <span className="lp-example-origin">LON <span>London</span></span>
              <span className="lp-example-origin">BER <span>Berlin</span></span>
            </div>
            <div className="lp-example-arrow">→</div>
            <div className="lp-example-result">
              <div className="lp-example-winner">{t("landing.exampleWinner")}</div>
              <div className="lp-example-dest">LIS · Lisbon</div>
              <div className="lp-example-price">€85 {t("landing.exampleTotal")}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Use cases (SEO) */}
      <section className="lp-usecases">
        <div className="container" style={{ maxWidth: 1080 }}>
          <h2 className="lp-usecases-title">{t("landing.useCasesTitle")}</h2>
          <div className="lp-usecases-grid">
            {Array.isArray(t("landing.useCases")) && t("landing.useCases").map((uc, i) => (
              <div key={i} className="lp-usecase-card">
                <span className="lp-usecase-icon">{uc.icon}</span>
                <h3 className="lp-usecase-name">{uc.title}</h3>
                <p className="lp-usecase-desc">{uc.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Popular routes */}
      <section className="lp-routes">
        <div className="container" style={{ maxWidth: 1080 }}>
          <h2 className="lp-routes-title">{t("landing.routesTitle")}</h2>
          <p className="lp-routes-sub">{t("landing.routesSub")}</p>
          <div className="lp-routes-grid">
            {(t("landing.routes") || []).map((route, i) => (
              <button key={i} type="button" className="lp-route-card" onClick={() => {
                // Parse "MAD · LON · BER → BCN, LIS, ROM" into origins + destinations
                const parts = (route.cities || "").split("→").map(s => s.trim());
                const origins = (parts[0] || "").split("·").map(s => s.trim()).filter(Boolean);
                const dests = (parts[1] || "").split(",").map(s => s.trim()).filter(Boolean);
                if (origins.length && onStartWithRoute) {
                  onStartWithRoute(origins, dests);
                } else {
                  onStart();
                }
              }}>
                <span className="lp-route-emoji">{route.emoji}</span>
                <span className="lp-route-name">{route.name}</span>
                <span className="lp-route-cities">{route.cities}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="lp-testimonials">
        <div className="container" style={{ maxWidth: 1080 }}>
          <h2 className="lp-testimonials-title">{t("landing.testimonialsTitle")}</h2>
          <div className="lp-testimonials-grid">
            {(t("landing.testimonials") || []).map((item, i) => (
              <div key={i} className="lp-testimonial-card">
                <div className="lp-testimonial-stars">{"★".repeat(item.stars || 5)}</div>
                <p className="lp-testimonial-text">{item.text}</p>
                <div className="lp-testimonial-author">
                  <span className="lp-testimonial-avatar">{item.avatar}</span>
                  <div>
                    <span className="lp-testimonial-name">{item.name}</span>
                    <span className="lp-testimonial-origin">{item.origin}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ accordion */}
      <section className="lp-faq">
        <div className="container" style={{ maxWidth: 1080 }}>
          <h2 className="lp-faq-title">{t("landing.faqTitle")}</h2>
          <div className="lp-faq-list">
            {Array.isArray(faqs) && faqs.map((item, i) => (
              <FaqItem key={i} q={item.q} a={item.a} />
            ))}
          </div>
          <div className="text-center mt-5">
            <button className="btn-fm-primary btn-lg-fm" onClick={onStart} type="button">
              {t("landing.getStarted")}
            </button>
          </div>
        </div>
      </section>
    </>
  );
});

export default Landing;
