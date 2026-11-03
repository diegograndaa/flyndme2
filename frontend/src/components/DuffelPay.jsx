// Cobro con la tarjeta. Duffel Payments (Stripe) solo se carga cuando hay un
// intento de pago: el número de tarjeta no pasa por FlyndMe.
import React from "react";
import { DuffelPayments } from "@duffel/components";

// Duffel pinta el botón con rgba(var(--ACCENT)). El triplete es el amarillo
// de señalética; al ser claro, el texto del botón sale en negro.
const PAY_STYLES = {
  accentColor: "255, 194, 14",
  buttonCornerRadius: "4px",
  fontFamily: "IBM Plex Sans, sans-serif",
};

export default function DuffelPay({ clientToken, onSuccess, onFail }) {
  if (!clientToken) return null;
  return (
    <DuffelPayments
      paymentIntentClientToken={clientToken}
      styles={PAY_STYLES}
      onSuccessfulPayment={onSuccess}
      onFailedPayment={onFail}
    />
  );
}
