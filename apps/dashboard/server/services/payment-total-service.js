function positiveNumber(value) {
  return Math.max(0, Number(value || 0));
}

export function deriveProviderTotalPayment(amount = 0, fee = 0, providerTotal = 0) {
  const nominal = positiveNumber(amount);
  const reportedTotal = positiveNumber(providerTotal);

  // Pakasir still reports its merchant fee when the merchant absorbs it.
  // An explicit total_payment is therefore authoritative for the customer.
  if (reportedTotal > 0) return reportedTotal;

  return nominal > 0 ? nominal + positiveNumber(fee) : 0;
}

export function deriveCustomerPaymentBreakdown(amount = 0, fee = 0, providerTotal = 0) {
  const nominal = positiveNumber(amount);
  const total = deriveProviderTotalPayment(nominal, fee, providerTotal);
  return {
    nominal,
    total,
    customerFee: Math.max(0, total - nominal),
  };
}
