import { createRequire } from "node:module";
import { logger } from "./logger";

type MailMode = "smtp" | "console" | "disabled" | "fail";

function getMailMode(): MailMode {
  const raw = String(process.env.MAIL_MODE || "smtp").toLowerCase();
  if (raw === "console" || raw === "disabled" || raw === "fail") return raw;
  return "smtp";
}

function redactEmail(email: string) {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const prefix = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = prefix.slice(0, 1);
  return `${visible}***@${domain}`;
}

export async function sendEmail(args: { to: string; subject: string; text: string; html?: string | undefined }): Promise<void> {
  const mode = getMailMode();
  if (mode === "disabled") return;
  if (mode === "fail") throw new Error("Falha forçada no envio de e-mail (MAIL_MODE=fail)");

  if (mode === "console") {
    logger.info({ to: redactEmail(args.to), subject: args.subject }, "E-mail enviado (console)");
    return;
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (!host || !from) {
    if (process.env.NODE_ENV !== "production") {
      logger.info({ to: redactEmail(args.to), subject: args.subject }, "E-mail não enviado (SMTP não configurado)");
      return;
    }
    throw new Error("Configuração SMTP incompleta (SMTP_HOST/SMTP_FROM).");
  }

  const require = createRequire(import.meta.url);
  const nodemailer = require("nodemailer") as any;
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });

  await transport.sendMail({
    from,
    to: args.to,
    subject: args.subject,
    text: args.text,
    html: args.html,
  });
}
