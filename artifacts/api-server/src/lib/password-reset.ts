import crypto from "node:crypto";

export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function getAppPublicUrl(): string {
  const raw = String(process.env.APP_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (!raw) {
    throw new Error("APP_PUBLIC_URL não configurada.");
  }
  if (process.env.NODE_ENV === "production" && !raw.startsWith("https://")) {
    throw new Error("APP_PUBLIC_URL deve utilizar HTTPS em produção.");
  }
  return raw;
}

export function buildPasswordResetLink(token: string, baseUrl?: string): string {
  const base = String(baseUrl || "").trim().replace(/\/$/, "") || getAppPublicUrl();
  if (process.env.NODE_ENV === "production" && !base.startsWith("https://")) {
    throw new Error("URL pública deve utilizar HTTPS em produção.");
  }
  return `${base}/redefinir-senha?token=${encodeURIComponent(token)}`;
}

export function buildPasswordResetEmail(args: {
  recipientName: string;
  resetLink: string;
  expiresAt: Date;
}): { subject: string; text: string; html: string } {
  const subject = "SuporteTI — Redefinição de senha";
  const expires = args.expiresAt.toLocaleString("pt-BR");
  const text =
    `Olá, ${args.recipientName}.\n\n` +
    `Recebemos uma solicitação de redefinição de senha para sua conta no SuporteTI.\n\n` +
    `Para criar uma nova senha, acesse o link abaixo (válido até ${expires}):\n` +
    `${args.resetLink}\n\n` +
    `Se você não solicitou esta redefinição, ignore este e-mail.\n\n` +
    `Atenciosamente,\nEquipe SuporteTI\n`;

  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111">` +
    `<h2 style="margin:0 0 12px 0">SuporteTI</h2>` +
    `<p>Olá, <strong>${escapeHtml(args.recipientName)}</strong>.</p>` +
    `<p>Recebemos uma solicitação de redefinição de senha para sua conta.</p>` +
    `<p>Para criar uma nova senha, utilize o link abaixo (válido até <strong>${escapeHtml(expires)}</strong>):</p>` +
    `<p><a href="${escapeAttr(args.resetLink)}" style="color:#0b57d0">${escapeHtml(args.resetLink)}</a></p>` +
    `<p>Se você não solicitou esta redefinição, ignore este e-mail.</p>` +
    `<p style="margin-top:24px">Atenciosamente,<br/>Equipe SuporteTI</p>` +
    `</div>`;

  return { subject, text, html };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value: string) {
  return escapeHtml(value);
}
