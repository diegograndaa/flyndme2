import React from 'react'
import ReactDOM from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import App from './App.jsx'
import CheckoutPage from './components/CheckoutPage.jsx'
import { I18nProvider } from './i18n/useI18n.jsx'

const caja = new URLSearchParams(window.location.search).get("caja");
const cajaId = /^[A-Za-z0-9_-]{16}$/.test(caja || "") ? caja : "";

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      {cajaId ? <CheckoutPage quoteId={cajaId} /> : <App />}
    </I18nProvider>
    <Analytics />
  </React.StrictMode>,
)
