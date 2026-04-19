export function normalizePhoneE164Brazil(value: string): string | null {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 13 && digits.startsWith("55")) {
    return `+${digits}`;
  }

  if (digits.length === 11) {
    return `+55${digits}`;
  }

  return null;
}

export function isValidBrazilMobile(value: string): boolean {
  const normalized = normalizePhoneE164Brazil(value);
  if (!normalized) return false;

  const digits = normalized.replace(/\D/g, "");
  if (!digits.startsWith("55")) return false;
  if (digits.length !== 13) return false;

  const ddd = digits.slice(2, 4);
  const firstNumber = digits.slice(4, 5);

  if (ddd === "00") return false;
  if (firstNumber !== "9") return false;

  return true;
}

