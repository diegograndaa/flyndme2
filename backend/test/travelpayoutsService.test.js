// Unit tests de travelpayoutsService (Aviasales Data API).
// Sin red: el transporte HTTP se sustituye por un stub vía __test.setTransport.
//
//   cd backend && node --test          (o npm test)

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.TRAVELPAYOUTS_TOKEN = process.env.TRAVELPAYOUTS_TOKEN || "test-token";
// MARKER_AFF se captura al hacer require del módulo → fijarlo AQUÍ, antes del
// require. Valor fijo (no "||") para que las aserciones sean deterministas.
process.env.TRAVELPAYOUTS_MARKER = "738121.app";

const tp = require("../services/travelpayoutsService");
const { buildParams, buildAffiliateLink, matchesDates, isoDuration, mapTicketToOffer, makeCacheKey, pickCheapest, setTransport } = tp.__test;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ticket(overrides = {}) {
  return {
    origin: "MAD",
    destination: "LIS",
    origin_airport: "MAD",
    destination_airport: "LIS",
    price: 87,
    currency: "eur",
    airline: "TP",
    flight_number: "1027",
    departure_at: "2026-08-10T08:30:00+02:00",
    return_at: undefined,
    transfers: 0,
    return_transfers: 0,
    duration: 80,
    duration_to: 80,
    duration_back: undefined,
    link: "/search/MAD1008LIS1?t=abc",
    ...overrides,
  };
}

function okResponse(tickets) {
  return { data: { success: true, data: tickets, error: null } };
}

// ─── buildParams ─────────────────────────────────────────────────────────────

test("buildParams: ida simple con defaults", () => {
  const p = buildParams("MAD", "LIS", "2026-08-10", {});
  assert.equal(p.origin, "MAD");
  assert.equal(p.destination, "LIS");
  assert.equal(p.departure_at, "2026-08-10");
  assert.equal(p.one_way, "true");
  assert.equal(p.currency, "eur");
  assert.equal(p.sorting, "price");
  assert.equal(p.return_at, undefined);
  assert.equal(p.direct, undefined);
});

test("buildParams: ida y vuelta + nonStop + divisa", () => {
  const p = buildParams("MAD", "LIS", "2026-08-10", {
    returnDate: "2026-08-17", nonStop: true, currencyCode: "USD",
  });
  assert.equal(p.one_way, "false");
  assert.equal(p.return_at, "2026-08-17");
  assert.equal(p.direct, "true");
  assert.equal(p.currency, "usd");
});

// ─── isoDuration / matchesDates ──────────────────────────────────────────────

test("isoDuration: minutos → ISO 8601", () => {
  assert.equal(isoDuration(80), "PT1H20M");
  assert.equal(isoDuration(60), "PT1H");
  assert.equal(isoDuration(45), "PT45M");
  assert.equal(isoDuration(0), null);
  assert.equal(isoDuration(null), null);
  assert.equal(isoDuration("nope"), null);
});

test("matchesDates: filtra billetes de fechas vecinas", () => {
  const t = ticket();
  assert.equal(matchesDates(t, "2026-08-10"), true);
  assert.equal(matchesDates(t, "2026-08-11"), false);

  const rt = ticket({ return_at: "2026-08-17T19:00:00+01:00" });
  assert.equal(matchesDates(rt, "2026-08-10", "2026-08-17"), true);
  assert.equal(matchesDates(rt, "2026-08-10", "2026-08-18"), false);
});

// ─── mapTicketToOffer ────────────────────────────────────────────────────────

test("mapTicketToOffer: vuelo directo de ida", () => {
  const offer = mapTicketToOffer(ticket(), { departureDate: "2026-08-10" });
  assert.equal(offer.source, "AVIASALES_CACHE");
  assert.equal(offer.oneWay, true);
  assert.equal(offer.price.grandTotal, "87.00");
  assert.equal(offer.price.currency, "EUR");
  assert.deepEqual(offer.validatingAirlineCodes, ["TP"]);
  assert.equal(offer.itineraries.length, 1);
  assert.equal(offer.itineraries[0].duration, "PT1H20M");
  // Directo → 1 segmento con aeropuertos reales
  assert.equal(offer.itineraries[0].segments.length, 1);
  assert.equal(offer.itineraries[0].segments[0].departure.iataCode, "MAD");
  assert.equal(offer.itineraries[0].segments[0].arrival.iataCode, "LIS");
  // Deep link absoluto (afiliable)
  assert.ok(offer.link.startsWith("https://www.aviasales.com/search/"));
  // Datos para re-consulta
  assert.equal(offer.tp.origin, "MAD");
  assert.equal(offer.tp.departureDate, "2026-08-10");
  assert.equal(offer.tp.returnDate, null);
});

test("mapTicketToOffer: con escalas no inventa segmentos", () => {
  const offer = mapTicketToOffer(ticket({ transfers: 1 }), { departureDate: "2026-08-10" });
  // No conocemos los aeropuertos intermedios → sin segmentos (el frontend degrada)
  assert.equal(offer.itineraries[0].segments.length, 0);
  assert.equal(offer.transfers, 1);
});

test("mapTicketToOffer: ida y vuelta → 2 itinerarios", () => {
  const offer = mapTicketToOffer(
    ticket({ return_at: "2026-08-17T19:00:00+01:00", duration_back: 85, price: 154 }),
    { departureDate: "2026-08-10", returnDate: "2026-08-17" }
  );
  assert.equal(offer.oneWay, false);
  assert.equal(offer.itineraries.length, 2);
  assert.equal(offer.itineraries[1].duration, "PT1H25M");
  assert.equal(offer.price.grandTotal, "154.00");
});

test("mapTicketToOffer: precio no numérico → null", () => {
  assert.equal(mapTicketToOffer(ticket({ price: "n/a" }), { departureDate: "2026-08-10" }), null);
});

test("mapTicketToOffer: tp incluye los aeropuertos reales del billete", () => {
  // Destino ciudad multi-aeropuerto: tp conserva el código de ciudad (para
  // re-consultas a la Data API) Y el aeropuerto real (para la capa 2 SerpAPI,
  // que no acepta ROM/LON como arrival_id).
  const offer = mapTicketToOffer(
    ticket({ destination: "ROM", destination_airport: "FCO" }),
    { departureDate: "2026-08-10" }
  );
  assert.equal(offer.tp.origin, "MAD");
  assert.equal(offer.tp.destination, "ROM");
  assert.equal(offer.tp.originAirport, "MAD");
  assert.equal(offer.tp.destinationAirport, "FCO");
});

test("mapTicketToOffer: sin *_airport en el ticket → fallback a origin/destination", () => {
  const offer = mapTicketToOffer(
    ticket({ origin_airport: undefined, destination_airport: undefined }),
    { departureDate: "2026-08-10" }
  );
  assert.equal(offer.tp.originAirport, "MAD");
  assert.equal(offer.tp.destinationAirport, "LIS");
});

// ─── pickCheapest ────────────────────────────────────────────────────────────

test("pickCheapest: el más barato con fecha exacta", () => {
  const tickets = [
    ticket({ price: 120 }),
    ticket({ price: 95 }),
    ticket({ price: 60, departure_at: "2026-08-11T08:30:00+02:00" }), // fecha vecina → descartado
  ];
  const best = pickCheapest(tickets, "2026-08-10");
  assert.equal(best.price, 95);
});

test("pickCheapest: sin coincidencias → null", () => {
  assert.equal(pickCheapest([], "2026-08-10"), null);
  assert.equal(pickCheapest([ticket({ departure_at: "2026-09-01T08:00:00Z" })], "2026-08-10"), null);
});

// ─── Contrato del servicio (sin red) ─────────────────────────────────────────

test("getCheapestOffer: mismo origen y destino → null sin llamar a la API", async () => {
  setTransport(() => { throw new Error("no debería llamar a la red"); });
  assert.equal(await tp.getCheapestOffer("MAD", "MAD", "2026-08-10"), null);
});

test("getCheapestOffer: travelClass no economy → null sin llamar a la API", async () => {
  setTransport(() => { throw new Error("no debería llamar a la red"); });
  assert.equal(await tp.getCheapestOffer("MAD", "LIS", "2026-08-10", { travelClass: "BUSINESS" }), null);
});

test("getCheapestOffer: respuesta válida → precio y oferta; 2ª llamada va a caché", async () => {
  let calls = 0;
  setTransport(async () => { calls++; return okResponse([ticket({ price: 95 }), ticket({ price: 120 })]); });

  const r1 = await tp.getCheapestOffer("MAD", "LIS", "2026-08-10", {});
  assert.equal(r1.price, 95);
  assert.equal(r1.offer.price.grandTotal, "95.00");
  assert.equal(calls, 1);

  const r2 = await tp.getCheapestOffer("MAD", "LIS", "2026-08-10", {});
  assert.equal(r2.price, 95);
  assert.equal(calls, 1, "la segunda búsqueda idéntica debe servirse de la caché local");
});

test("getCheapestOffer: caché vacía del proveedor → null (destino descartado)", async () => {
  setTransport(async () => okResponse([]));
  assert.equal(await tp.getCheapestOffer("MAD", "XXX", "2026-08-10", {}), null);
});

test("getCheapestOffer: error de red → null, nunca lanza", async () => {
  setTransport(async () => { const e = new Error("boom"); e.response = { status: 400 }; throw e; });
  assert.equal(await tp.getCheapestOffer("MAD", "YYY", "2026-08-10", {}), null);
});

test("priceFlightOffer: re-consulta saltando la caché local", async () => {
  let calls = 0;
  setTransport(async () => { calls++; return okResponse([ticket({ price: 95 })]); });

  const r = await tp.getCheapestOffer("MAD", "OPO", "2026-08-10", {});
  assert.equal(calls, 1);

  setTransport(async () => { calls++; return okResponse([ticket({ price: 99 })]); });
  const v = await tp.priceFlightOffer(r.offer);
  assert.equal(calls, 2, "priceFlightOffer no debe usar la caché local");
  assert.equal(v.price, 99);
  assert.ok(v.offer.refreshedAt);
});

test("priceFlightOffer: oferta ajena (sin tp) → null", async () => {
  assert.equal(await tp.priceFlightOffer({ id: "foreign-1" }), null);
  assert.equal(await tp.priceFlightOffer(null), null);
});

test("budgetStatus: ilimitado (API gratuita)", () => {
  const b = tp.budgetStatus();
  assert.equal(b.unlimited, true);
  assert.equal(b.remaining, Infinity);
});

test("capabilities: sin verificación real, solo economy, datos de caché", () => {
  assert.equal(tp.capabilities.verification, false);
  assert.deepEqual(tp.capabilities.travelClasses, ["ECONOMY"]);
  assert.equal(tp.capabilities.dataSource, "cache");
});

test("makeCacheKey: distingue fechas, divisa y direct", () => {
  const a = makeCacheKey("MAD", "LIS", "2026-08-10", {});
  const b = makeCacheKey("MAD", "LIS", "2026-08-10", { nonStop: true });
  const c = makeCacheKey("MAD", "LIS", "2026-08-10", { currencyCode: "USD" });
  const d = makeCacheKey("MAD", "LIS", "2026-08-11", {});
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

// ─── Fallback de fechas vecinas ──────────────────────────────────────────────

test("getCheapestOffer: sin precio en fecha exacta → fallback a fecha vecina etiquetada", async () => {
  setTransport(async (url, config) => {
    if (config.params.departure_at === "2026-08-10") return okResponse([]); // exacta: vacía
    // consulta de mes: billetes en fechas vecinas
    return okResponse([
      ticket({ price: 70, departure_at: "2026-08-08T08:30:00+02:00" }), // a 2 días
      ticket({ price: 90, departure_at: "2026-08-11T08:30:00+02:00" }), // a 1 día → gana
    ]);
  });

  const r = await tp.getCheapestOffer("MAD", "FAO", "2026-08-10", {});
  assert.equal(r.price, 90, "elige la fecha más cercana, no la más barata");
  assert.equal(r.offer.dateFallback.departureDate, "2026-08-11");
  assert.equal(r.offer.dateFallback.requestedDepartureDate, "2026-08-10");
  assert.equal(r.offer.dateFallback.offsetDays, 1);
  assert.equal(r.offer.tp.departureDate, "2026-08-11", "tp lleva la fecha real para re-consultas");
});

test("getCheapestOffer: fallback respeta la ventana de ±N días", async () => {
  setTransport(async (url, config) => {
    if (config.params.departure_at === "2026-08-10") return okResponse([]);
    return okResponse([ticket({ price: 50, departure_at: "2026-08-20T08:30:00+02:00" })]); // a 10 días
  });
  assert.equal(await tp.getCheapestOffer("MAD", "FNC", "2026-08-10", {}), null);
});

test("getCheapestOffer: con precio en fecha exacta no consulta el mes", async () => {
  setTransport(async (url, config) => {
    if (config.params.departure_at === "2026-08-10") return okResponse([ticket({ price: 95 })]);
    throw new Error("no debería consultar el mes");
  });
  const r = await tp.getCheapestOffer("MAD", "PXO", "2026-08-10", {});
  assert.equal(r.price, 95);
  assert.equal(r.offer.dateFallback, undefined);
});

test("getCheapestOffer: fallback ida y vuelta con fechas reales en ambos tramos", async () => {
  setTransport(async (url, config) => {
    if (config.params.departure_at === "2026-08-10") return okResponse([]);
    return okResponse([
      ticket({
        price: 180,
        departure_at: "2026-08-11T08:30:00+02:00",
        return_at:    "2026-08-18T19:00:00+01:00",
        duration_back: 85,
      }),
    ]);
  });

  const r = await tp.getCheapestOffer("MAD", "SVQ", "2026-08-10", { returnDate: "2026-08-17" });
  assert.equal(r.price, 180);
  assert.equal(r.offer.dateFallback.departureDate, "2026-08-11");
  assert.equal(r.offer.dateFallback.returnDate, "2026-08-18");
  assert.equal(r.offer.itineraries.length, 2);
});

test("pickNeighbor: empate de distancia → el más barato", () => {
  const { pickNeighbor } = tp.__test;
  const best = pickNeighbor([
    ticket({ price: 120, departure_at: "2026-08-09T08:00:00+02:00" }),
    ticket({ price: 80,  departure_at: "2026-08-11T08:00:00+02:00" }),
  ], "2026-08-10", undefined, 2);
  assert.equal(best.price, 80);
});

test("pickNeighbor: descarta fechas ya pasadas (caché obsoleta)", () => {
  const { pickNeighbor } = tp.__test;
  assert.equal(pickNeighbor([
    ticket({ price: 10, departure_at: "2020-01-01T08:00:00Z" }),
  ], "2020-01-02", undefined, 2), null);
});

test("monthsInWindow: cruza el límite de mes solo cuando toca", () => {
  const { monthsInWindow } = tp.__test;
  assert.deepEqual(monthsInWindow("2026-08-01", 2).sort(), ["2026-07", "2026-08"]);
  assert.deepEqual(monthsInWindow("2026-08-30", 2).sort(), ["2026-08", "2026-09"]);
  assert.deepEqual(monthsInWindow("2026-08-15", 2), ["2026-08"]);
});

// ─── buildAffiliateLink (monetización por afiliados) ─────────────────────────
// TRAVELPAYOUTS_MARKER="738121.app" fijado arriba, antes del require.

test("buildAffiliateLink: link falsy → null", () => {
  assert.equal(buildAffiliateLink(null), null);
  assert.equal(buildAffiliateLink(undefined), null);
  assert.equal(buildAffiliateLink(""), null);
});

test("buildAffiliateLink: link sin query → añade ?marker=", () => {
  assert.equal(
    buildAffiliateLink("/search/MAD1008LIS1"),
    "https://www.aviasales.com/search/MAD1008LIS1?marker=738121.app"
  );
});

test("buildAffiliateLink: link con query existente → añade &marker=", () => {
  assert.equal(
    buildAffiliateLink("/search/MAD1008LIS1?t=abc"),
    "https://www.aviasales.com/search/MAD1008LIS1?t=abc&marker=738121.app"
  );
});

test("buildAffiliateLink: marker ya presente en la query → no se duplica", () => {
  const first = buildAffiliateLink("/search/MAD1008LIS1?marker=otro");
  assert.equal(first, "https://www.aviasales.com/search/MAD1008LIS1?marker=otro");

  const mid = buildAffiliateLink("/search/MAD1008LIS1?t=abc&marker=otro");
  assert.equal(mid, "https://www.aviasales.com/search/MAD1008LIS1?t=abc&marker=otro");
  assert.equal((mid.match(/marker=/g) || []).length, 1);
});

test("buildAffiliateLink: marker con SubID ('738121.app') va bien encodeado", () => {
  // encodeURIComponent no escapa el punto → el SubID llega literal a la URL,
  // que es lo que esperan los informes de Travelpayouts.
  const link = buildAffiliateLink("/search/MAD1008LIS1");
  assert.ok(link.endsWith("?marker=738121.app"));
  assert.equal(decodeURIComponent(link.split("marker=")[1]), "738121.app");
});

test("buildAffiliateLink: sin TRAVELPAYOUTS_MARKER → link absoluto sin marker", () => {
  // MARKER_AFF se fija en tiempo de carga → re-require limpio sin la variable.
  // El TtlCache interno usa unref() y el módulo no tiene más efectos de carga,
  // así que la instancia extra es inocua. Se restaura todo en finally.
  const servicePath = require.resolve("../services/travelpayoutsService");
  const savedMarker = process.env.TRAVELPAYOUTS_MARKER;
  const savedModule = require.cache[servicePath];
  delete process.env.TRAVELPAYOUTS_MARKER;
  delete require.cache[servicePath];
  try {
    const fresh = require("../services/travelpayoutsService");
    assert.equal(
      fresh.__test.buildAffiliateLink("/search/MAD1008LIS1?t=abc"),
      "https://www.aviasales.com/search/MAD1008LIS1?t=abc"
    );
    assert.equal(
      fresh.__test.buildAffiliateLink("/search/MAD1008LIS1"),
      "https://www.aviasales.com/search/MAD1008LIS1"
    );
  } finally {
    process.env.TRAVELPAYOUTS_MARKER = savedMarker;
    require.cache[servicePath] = savedModule; // el resto del fichero sigue con la instancia original
  }
});
