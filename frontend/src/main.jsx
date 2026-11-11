import React from 'react'
import ReactDOM from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import App from './App.jsx'
import CheckoutPage from './components/CheckoutPage.jsx'
import { I18nProvider } from './i18n/useI18n.jsx'

// La analítica no recibe los identificadores que van en la URL: la caja de
// pago, un resultado compartido, un grupo o un enlace del correo.
const PRIVATE_PARAMS = ["caja", "share", "group", "reset", "verify"];
function withoutPrivateParams(event) {
  try {
    const url = new URL(event.url);
    let changed = false;
    for (const name of PRIVATE_PARAMS) {
      if (url.searchParams.has(name)) { url.searchParams.set(name, "x"); changed = true; }
    }
    return changed ? { ...event, url: url.toString() } : event;
  } catch {
    return event;
  }
}

const caja = new URLSearchParams(window.location.search).get("caja");
const cajaId = /^[A-Za-z0-9_-]{16}$/.test(caja || "") ? caja : "";

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      {cajaId ? <CheckoutPage quoteId={cajaId} /> : <App />}
    </I18nProvider>
    <Analytics beforeSend={withoutPrivateParams} />
  </React.StrictMode>,
)
