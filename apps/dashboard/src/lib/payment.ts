function positiveNumber(value: unknown) {
  return Math.max(0, Number(value || 0));
}

export function customerPaymentBreakdown(amount: unknown, fee: unknown, providerTotal: unknown) {
  const nominal = positiveNumber(amount);
  const reportedTotal = positiveNumber(providerTotal);
  const total = reportedTotal > 0 ? reportedTotal : nominal > 0 ? nominal + positiveNumber(fee) : 0;

  return {
    nominal,
    total,
    customerFee: Math.max(0, total - nominal),
  };
}
