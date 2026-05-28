import bcrypt from "bcryptjs";

export type PasswordPolicyResult = { ok: true } | { ok: false; code: "PASSWORD_WEAK" | "PASSWORD_REUSED"; message: string };

export function validatePasswordStrength(password: string): PasswordPolicyResult {
  if (password.length < 8) {
    return { ok: false, code: "PASSWORD_WEAK", message: "A senha deve possuir no mínimo 8 caracteres" };
  }
  if (!/[A-Za-z]/.test(password)) {
    return { ok: false, code: "PASSWORD_WEAK", message: "A senha deve conter letras" };
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, code: "PASSWORD_WEAK", message: "A senha deve conter números" };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { ok: false, code: "PASSWORD_WEAK", message: "A senha deve conter caracteres especiais" };
  }
  return { ok: true };
}

export async function isPasswordReused(args: { password: string; hashes: string[] }): Promise<boolean> {
  for (const hash of args.hashes) {
    if (!hash) continue;
    const match = await bcrypt.compare(args.password, hash);
    if (match) return true;
  }
  return false;
}

