// Stubs mínimos de browser para renderToString en Node. Los efectos no corren
// en SSR; esto cubre lo que se toca durante el render/inicializadores.
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
};
globalThis.window = globalThis;
// globalThis.navigator es getter-only en Node >= 21: existe y basta para los
// checks tipo "serviceWorker" in navigator / navigator.share (undefined).
globalThis.matchMedia = (q) => ({
  matches: false, media: q,
  addEventListener: () => {}, removeEventListener: () => {},
  addListener: () => {}, removeListener: () => {},
});
globalThis.window.matchMedia = globalThis.matchMedia;
globalThis.document = {
  documentElement: { setAttribute: () => {}, getAttribute: () => null, lang: "en", style: {} },
  title: "",
  addEventListener: () => {}, removeEventListener: () => {},
  createElement: () => ({ style: {}, setAttribute: () => {}, getContext: () => null, click: () => {} }),
  body: { appendChild: () => {}, removeChild: () => {} },
  getElementById: () => null,
  querySelector: () => null,
};
globalThis.history = { pushState: () => {}, replaceState: () => {}, back: () => {} };
globalThis.location = { search: "", pathname: "/", hash: "", href: "http://localhost/" };
globalThis.scrollTo = () => {};
globalThis.addEventListener = globalThis.addEventListener || (() => {});
globalThis.removeEventListener = globalThis.removeEventListener || (() => {});
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
