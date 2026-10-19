// ─── Landing / Home ──────────────────────────────────────────────────────────
// Pantalla única de inicio (rediseño Stitch, jun-2026): hero + buscador
// fusionados, con "cómo funciona" y FAQ debajo. La antigua vista intermedia
// de búsqueda desaparece: el formulario (SearchPage) se recibe como prop
// `searchForm` y se renderiza directamente bajo el hero.
import React, { Suspense, useMemo } from "react";
import { useI18n } from "../i18n/useI18n";
import { CITY_COORDS } from "../utils/geo";

// El mapa trae los geodatos de Europa: se carga aparte para no pesar en el
// arranque. Mientras llega, un hueco con sus mismas proporciones (sin saltos).
const HeroMap = React.lazy(() => import("./HeroMap"));
const MapSlot = React.memo(function MapSlot({ origins, compact, idSuffix }) {
  return (
    <Suspense fallback={<div className={`hm hm--loading${compact ? " hm--compact" : ""}`} aria-hidden="true"><div className="hm-stage" /></div>}>
      <HeroMap origins={origins} compact={compact} idSuffix={idSuffix} />
    </Suspense>
  );
});

const Landing = React.memo(function Landing({ searchForm, origins = [] }) {
  const { t } = useI18n();
  // El mapa solo se vuelve a pintar cuando cambia la lista de ciudades YA
  // reconocidas (no en cada tecla): la clave es la lista de códigos válidos.
  const mapKey = origins.filter((o) => CITY_COORDS[o]).join(",");
  const mapOrigins = useMemo(() => (mapKey ? mapKey.split(",") : []), [mapKey]);

  return (
    <>
      {/* Portada en dos columnas (oct-2026): titular + formulario a la izquierda
          y el mapa vivo a la derecha, para que el botón de buscar quede en la
          primera pantalla. En móvil: titular, mapa compacto y formulario. */}
      <section className="hm-home lp-hero--merged">
        <div className="container hm-home-grid" style={{ maxWidth: 1080 }}>
          <div className="hm-home-main">
            <div className="lp-hero-text hm-home-text">
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
            </div>
            <div className="hm-home-map-m">
              <MapSlot origins={mapOrigins} compact idSuffix="-m" />
            </div>
            <div className="lp-search-section hm-home-form">
              {searchForm}
            </div>
          </div>
          <aside className="hm-home-map">
            <MapSlot origins={mapOrigins} idSuffix="-d" />
          </aside>
        </div>
      </section>
    </>
  );
});

export default Landing;
