// ─── Landing / Home ──────────────────────────────────────────────────────────
// Pantalla única de inicio (rediseño Stitch, jun-2026): hero + buscador
// fusionados, con "cómo funciona" y FAQ debajo. La antigua vista intermedia
// de búsqueda desaparece: el formulario (SearchPage) se recibe como prop
// `searchForm` y se renderiza directamente bajo el hero.
import React, { useState } from "react";
import { useI18n } from "../i18n/useI18n";

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

const Landing = React.memo(function Landing({ searchForm }) {
  const { t } = useI18n();

  const steps = t("landing.steps");
  const faqs  = t("landing.faqs");

  return (
    <>
      {/* Hero */}
      <section className="lp-hero lp-hero--merged">
        <div className="container" style={{ maxWidth: 1080 }}>
          <span className="lp-eyebrow">{t("landing.eyebrow")}</span>
          <h1 className="lp-h1">{(() => {
            const title = t("landing.title");
            const accent = t("landing.titleAccent");
            const i = typeof accent === "string" && accent && typeof title === "string" ? title.indexOf(accent) : -1;
            if (i < 0) return title;
            return (<>
              {title.slice(0, i)}
              <span className="lp-h1-accent">{accent}</span>
              {title.slice(i + accent.length)}
            </>);
          })()}</h1>
          <p className="lp-lead">{t("landing.lead")}</p>
        </div>
      </section>

      {/* Buscador (SearchPage) directamente bajo el hero */}
      <section className="lp-search-section">
        {searchForm}
      </section>

      {/* Cómo funciona */}
      <section className="lp-how">
        <div className="container" style={{ maxWidth: 720 }}>
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
      </section>

      {/* FAQ accordion */}
      <section className="lp-faq">
        <div className="container" style={{ maxWidth: 720 }}>
          <h2 className="lp-faq-title">{t("landing.faqTitle")}</h2>
          <div className="lp-faq-list">
            {Array.isArray(faqs) && faqs.map((item, i) => (
              <FaqItem key={i} q={item.q} a={item.a} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
});

export default Landing;
