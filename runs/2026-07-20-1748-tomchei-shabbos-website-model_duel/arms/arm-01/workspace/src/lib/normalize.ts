export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}
