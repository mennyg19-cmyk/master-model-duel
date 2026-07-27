export const brand = {
  name: "Tomchei Shabbos",
  accent: "#e86a33",
  ink: "#172026",
};

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export const centsToDollars = formatMoney;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "").replace(/^1/, "");
}

export function createPublicId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function maskError(error: unknown) {
  if (process.env.NODE_ENV === "production") return "Something went wrong. Please try again.";
  return error instanceof Error ? error.message : "Unexpected error.";
}
