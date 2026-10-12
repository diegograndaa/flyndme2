// Cobro con la tarjeta. Duffel Payments (Stripe) solo se carga cuando hay un
// intento de pago: el número de tarjeta no pasa por FlyndMe.
import React from "react";
import { DuffelPayments } from "@duffel/components";

export default function DuffelPay({ clientToken, onSuccess, onFail }) {
  if (!clientToken) return null;
  return (
    <DuffelPayments
      paymentIntentClientToken={clientToken}
      onSuccessfulPayment={onSuccess}
      onFailedPayment={onFail}
    />
  );
}
