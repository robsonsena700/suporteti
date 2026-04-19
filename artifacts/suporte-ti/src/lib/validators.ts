export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function formatCpf(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);
  if (d.length <= 3) return p1;
  if (d.length <= 6) return `${p1}.${p2}`;
  if (d.length <= 9) return `${p1}.${p2}.${p3}`;
  return `${p1}.${p2}.${p3}-${p4}`;
}

export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split("").map((c) => Number(c));
  const calcCheckDigit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += digits[i] * (len + 1 - i);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const d1 = calcCheckDigit(9);
  const d2 = calcCheckDigit(10);
  return d1 === digits[9] && d2 === digits[10];
}

export function formatBrazilPhone(value: string): string {
  const digits = onlyDigits(value);

  const d = digits.startsWith("55") ? digits.slice(2) : digits;
  const ddd = d.slice(0, 2);
  const first = d.slice(2, 3);
  const mid = d.slice(3, 7);
  const end = d.slice(7, 11);

  if (d.length === 0) return "+55 ";
  if (d.length < 3) return `+55 (${ddd}`;
  if (d.length < 4) return `+55 (${ddd}) ${first}`;
  if (d.length < 8) return `+55 (${ddd}) ${first} ${mid}`;
  return `+55 (${ddd}) ${first} ${mid}-${end}`;
}

export function isValidBrazilMobile(value: string): boolean {
  const digits = onlyDigits(value);
  const d = digits.startsWith("55") ? digits.slice(2) : digits;
  if (d.length !== 11) return false;
  if (d.slice(2, 3) !== "9") return false;
  if (d.slice(0, 2) === "00") return false;
  return true;
}

