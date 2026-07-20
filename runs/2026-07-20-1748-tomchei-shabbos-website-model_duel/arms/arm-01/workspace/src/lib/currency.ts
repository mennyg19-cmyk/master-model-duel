const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
});

export function formatCurrency(cents: number) {
  return usdFormatter.format(cents / 100);
}
