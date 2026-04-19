export function normalizeCpf(value: string): string {
  return value.replace(/\D/g, "");
}

export function isValidCpf(value: string): boolean {
  const cpf = normalizeCpf(value);

  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split("").map((c) => Number(c));

  const calcCheckDigit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += digits[i] * (len + 1 - i);
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const d1 = calcCheckDigit(9);
  const d2 = calcCheckDigit(10);

  return d1 === digits[9] && d2 === digits[10];
}

