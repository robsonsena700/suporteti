import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, passwordResetTokensTable, securityAuditLogsTable, userPasswordHistoryTable, usersTable } from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { RegisterBody, LoginBody } from "@workspace/api-zod";
import { signToken, requireAuth } from "../middlewares/auth";
import { isValidCpf, normalizeCpf } from "../lib/cpf";
import { isValidBrazilMobile, normalizePhoneE164Brazil } from "../lib/phone";
import { validateMunicipalityForUf } from "../lib/ibge";
import { logger } from "../lib/logger";
import { sendEmail } from "../lib/mailer";
import { buildPasswordResetEmail, buildPasswordResetLink, generateResetToken, hashResetToken } from "../lib/password-reset";
import { isPasswordReused, validatePasswordStrength } from "../lib/password-policy";

const router: IRouter = Router();

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    name,
    email,
    password,
    uf,
    municipality,
    birthDate,
    cpf,
    establishment,
    contactPhone,
    prefersWhatsapp,
    prefersTelegram,
    termsAccepted,
  } = parsed.data;

  if (!termsAccepted) {
    res.status(400).json({ error: "É necessário concordar com os Termos de Uso e a Política de Privacidade." });
    return;
  }

  if (!isValidCpf(cpf)) {
    res.status(400).json({ error: "CPF inválido" });
    return;
  }

  if (!isValidBrazilMobile(contactPhone)) {
    res.status(400).json({ error: "Contato inválido" });
    return;
  }

  if (!(birthDate instanceof Date) || Number.isNaN(birthDate.getTime())) {
    res.status(400).json({ error: "Data de nascimento inválida" });
    return;
  }
  const minBirth = new Date("1900-01-01T00:00:00.000Z");
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (birthDate < minBirth || birthDate > today) {
    res.status(400).json({ error: "Data de nascimento inválida" });
    return;
  }

  try {
    const ok = await validateMunicipalityForUf(uf, municipality);
    if (!ok) {
      res.status(400).json({ error: "Município não pertence à UF informada" });
      return;
    }
  } catch {
    res.status(503).json({ error: "Serviço do IBGE indisponível no momento" });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "E-mail já cadastrado" });
    return;
  }

  const normalizedCpf = normalizeCpf(cpf);
  const [cpfExisting] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.cpf, normalizedCpf));
  if (cpfExisting) {
    res.status(409).json({ error: "CPF já cadastrado" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const normalizedPhone = normalizePhoneE164Brazil(contactPhone)!;
  const [user] = await db.insert(usersTable).values({
    name,
    email,
    passwordHash,
    birthDate,
    cpf: normalizedCpf,
    establishment,
    contactPhone: normalizedPhone,
    prefersWhatsapp: Boolean(prefersWhatsapp),
    prefersTelegram: Boolean(prefersTelegram),
    termsAccepted: true,
    termsAcceptedAt: new Date(),
    uf,
    municipality,
    role: "USER",
    status: "PENDING",
  }).returning();

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    uf: user.uf,
    municipality: user.municipality,
  });

  res.status(201).json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      cpf: user.cpf,
      establishment: user.establishment,
      contactPhone: user.contactPhone,
      prefersWhatsapp: user.prefersWhatsapp,
      prefersTelegram: user.prefersTelegram,
      termsAccepted: user.termsAccepted,
      termsAcceptedAt: user.termsAcceptedAt,
      birthDate: user.birthDate,
      uf: user.uf,
      municipality: user.municipality,
      createdAt: user.createdAt,
      mustChangePassword: user.mustChangePassword,
    },
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }

  const now = new Date();
  await db.update(usersTable).set({ lastLoginAt: now }).where(eq(usersTable.id, user.id));

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    uf: user.uf,
    municipality: user.municipality,
  });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      cpf: user.cpf,
      establishment: user.establishment,
      contactPhone: user.contactPhone,
      prefersWhatsapp: user.prefersWhatsapp,
      prefersTelegram: user.prefersTelegram,
      termsAccepted: user.termsAccepted,
      termsAcceptedAt: user.termsAcceptedAt,
      birthDate: user.birthDate,
      uf: user.uf,
      municipality: user.municipality,
      createdAt: user.createdAt,
      lastLoginAt: now,
      mustChangePassword: user.mustChangePassword,
    },
  });
});

router.post("/auth/logout", (_req, res): void => {
  res.json({ message: "Sessão encerrada" });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    cpf: user.cpf,
    establishment: user.establishment,
    contactPhone: user.contactPhone,
    prefersWhatsapp: user.prefersWhatsapp,
    prefersTelegram: user.prefersTelegram,
    termsAccepted: user.termsAccepted,
    termsAcceptedAt: user.termsAcceptedAt,
    birthDate: user.birthDate,
    uf: user.uf,
    municipality: user.municipality,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    mustChangePassword: user.mustChangePassword,
  });
});

router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const body = req.body as { currentPassword?: unknown; newPassword?: unknown } | undefined;
  const currentPassword = body?.currentPassword;
  const newPassword = body?.newPassword;
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    res.status(400).json({ error: "Informe a senha atual" });
    return;
  }
  if (typeof newPassword !== "string") {
    res.status(400).json({ error: "Informe a nova senha", code: "PASSWORD_WEAK" });
    return;
  }

  const userId = req.user!.userId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }
  if (user.status !== "ACTIVE") {
    res.status(403).json({ error: "Sua conta está desativada. Entre em contato com o suporte.", code: "ACCOUNT_INACTIVE" });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Senha atual inválida" });
    return;
  }

  const strength = validatePasswordStrength(newPassword);
  if (!strength.ok) {
    res.status(400).json({ error: strength.message, code: strength.code });
    return;
  }

  const historyRows = await db
    .select({ passwordHash: userPasswordHistoryTable.passwordHash })
    .from(userPasswordHistoryTable)
    .where(eq(userPasswordHistoryTable.userId, userId))
    .orderBy(desc(userPasswordHistoryTable.createdAt))
    .limit(2);
  const recentHashes = [user.passwordHash, ...historyRows.map((r) => r.passwordHash)];
  if (await isPasswordReused({ password: newPassword, hashes: recentHashes })) {
    res.status(400).json({ error: "A nova senha não pode ser igual às últimas senhas utilizadas.", code: "PASSWORD_REUSED" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.transaction(async (tx) => {
    await tx.insert(userPasswordHistoryTable).values({ userId, passwordHash: user.passwordHash });
    await tx.update(usersTable).set({ passwordHash, mustChangePassword: false }).where(eq(usersTable.id, userId));
    const oldIds = await tx
      .select({ id: userPasswordHistoryTable.id })
      .from(userPasswordHistoryTable)
      .where(eq(userPasswordHistoryTable.userId, userId))
      .orderBy(desc(userPasswordHistoryTable.createdAt))
      .offset(2);
    if (oldIds.length > 0) {
      await tx.delete(userPasswordHistoryTable).where(inArray(userPasswordHistoryTable.id, oldIds.map((r) => r.id)));
    }
  });

  res.json({ message: "Senha atualizada com sucesso" });
});

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const body = req.body as { email?: unknown } | undefined;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Informe um e-mail válido" });
    return;
  }

  const ip = String(req.ip || "");
  const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : "";

  const [user] = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    status: usersTable.status,
  }).from(usersTable).where(eq(usersTable.email, email));

  if (!user) {
    await db.insert(securityAuditLogsTable).values({
      eventType: "PASSWORD_RESET_REQUESTED_UNKNOWN_EMAIL",
      targetEmail: email,
      ip,
      userAgent,
    });
    res.status(404).json({ error: "E-mail não encontrado" });
    return;
  }

  if (user.status !== "ACTIVE") {
    await db.insert(securityAuditLogsTable).values({
      eventType: "PASSWORD_RESET_REQUESTED_INACTIVE",
      targetUserId: user.id,
      targetEmail: user.email,
      ip,
      userAgent,
    });
    res.status(403).json({ error: "Sua conta está desativada. Entre em contato com o suporte.", code: "ACCOUNT_INACTIVE" });
    return;
  }

  const token = generateResetToken();
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await db.insert(passwordResetTokensTable).values({
    userId: user.id,
    tokenHash,
    purpose: "forgot_password",
    requestedIp: ip,
    requestedUserAgent: userAgent,
    expiresAt,
  });

  let resetLink = "";
  let mail: { subject: string; text: string; html: string };
  try {
    const baseUrl = resolvePublicBaseUrlFromRequest(req);
    resetLink = buildPasswordResetLink(token, baseUrl);
    mail = buildPasswordResetEmail({ recipientName: user.name, resetLink, expiresAt });
  } catch (err) {
    await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.tokenHash, tokenHash));
    await db.insert(securityAuditLogsTable).values({
      eventType: "PASSWORD_RESET_LINK_FAILED",
      targetUserId: user.id,
      targetEmail: user.email,
      ip,
      userAgent,
      detail: err instanceof Error ? String(err.message).slice(0, 500) : "Falha ao gerar link",
    });
    res.status(503).json({ error: "Falha ao gerar link de redefinição" });
    return;
  }

  try {
    await sendEmail({ to: user.email, subject: mail.subject, text: mail.text, html: mail.html });
    await db.insert(securityAuditLogsTable).values({
      eventType: "PASSWORD_RESET_EMAIL_SENT",
      targetUserId: user.id,
      targetEmail: user.email,
      ip,
      userAgent,
    });
    res.json({ message: "E-mail de recuperação enviado" });
  } catch (err) {
    await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.tokenHash, tokenHash));
    await db.insert(securityAuditLogsTable).values({
      eventType: "PASSWORD_RESET_EMAIL_FAILED",
      targetUserId: user.id,
      targetEmail: user.email,
      ip,
      userAgent,
      detail: err instanceof Error ? String(err.message).slice(0, 500) : "Erro ao enviar e-mail",
    });
    logger.error({ err }, "Falha ao enviar e-mail de recuperação");
    res.status(503).json({ error: "Falha ao enviar e-mail de recuperação" });
  }
});

function resolvePublicBaseUrlFromRequest(req: any): string {
  const configured = String(process.env.APP_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;

  const origin = typeof req?.headers?.origin === "string" ? String(req.headers.origin).trim().replace(/\/$/, "") : "";
  if (origin) return origin;

  const referer = typeof req?.headers?.referer === "string" ? String(req.headers.referer).trim() : "";
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
    }
  }

  const webPort = String(process.env.WEB_PORT || "").trim();
  if (webPort) return `http://localhost:${webPort}`;

  const port = String(process.env.PORT || process.env.API_PORT || "3001").trim();
  return `http://localhost:${port}`;
}

router.post("/auth/reset-password/validate", async (req, res): Promise<void> => {
  const body = req.body as { token?: unknown } | undefined;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) {
    res.status(400).json({ error: "Token inválido", code: "TOKEN_INVALID" });
    return;
  }

  const tokenHash = hashResetToken(token);
  const [row] = await db.select({
    userId: passwordResetTokensTable.userId,
    expiresAt: passwordResetTokensTable.expiresAt,
    usedAt: passwordResetTokensTable.usedAt,
  }).from(passwordResetTokensTable).where(eq(passwordResetTokensTable.tokenHash, tokenHash));

  if (!row || row.usedAt) {
    res.status(400).json({ error: "Token inválido", code: "TOKEN_INVALID" });
    return;
  }

  const now = new Date();
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    res.status(400).json({ error: "Token expirado", code: "TOKEN_EXPIRED" });
    return;
  }

  const [user] = await db.select({ status: usersTable.status }).from(usersTable).where(eq(usersTable.id, row.userId));
  if (!user) {
    res.status(400).json({ error: "Token inválido", code: "TOKEN_INVALID" });
    return;
  }
  if (user.status !== "ACTIVE") {
    res.status(403).json({ error: "Sua conta está desativada. Entre em contato com o suporte.", code: "ACCOUNT_INACTIVE" });
    return;
  }

  res.json({ message: "OK" });
});

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const body = req.body as { token?: unknown; newPassword?: unknown } | undefined;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (!token) {
    res.status(400).json({ error: "Token inválido", code: "TOKEN_INVALID" });
    return;
  }
  const strength = validatePasswordStrength(newPassword);
  if (!strength.ok) {
    res.status(400).json({ error: strength.message, code: strength.code });
    return;
  }

  const tokenHash = hashResetToken(token);
  const ip = String(req.ip || "");
  const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : "";

  const [row] = await db.select({
    id: passwordResetTokensTable.id,
    userId: passwordResetTokensTable.userId,
    purpose: passwordResetTokensTable.purpose,
    expiresAt: passwordResetTokensTable.expiresAt,
    usedAt: passwordResetTokensTable.usedAt,
  }).from(passwordResetTokensTable).where(eq(passwordResetTokensTable.tokenHash, tokenHash));

  if (!row) {
    await db.insert(securityAuditLogsTable).values({
      eventType: "PASSWORD_RESET_TOKEN_INVALID",
      ip,
      userAgent,
    });
    res.status(400).json({ error: "Token inválido", code: "TOKEN_INVALID" });
    return;
  }

  if (row.usedAt) {
    await db.insert(securityAuditLogsTable).values({
      eventType: "PASSWORD_RESET_TOKEN_USED",
      targetUserId: row.userId,
      ip,
      userAgent,
    });
    res.status(400).json({ error: "Token inválido", code: "TOKEN_INVALID" });
    return;
  }

  const now = new Date();
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    await db.insert(securityAuditLogsTable).values({
      eventType: "PASSWORD_RESET_TOKEN_EXPIRED",
      targetUserId: row.userId,
      ip,
      userAgent,
    });
    res.status(400).json({ error: "Token expirado", code: "TOKEN_EXPIRED" });
    return;
  }

  const [user] = await db.select({ passwordHash: usersTable.passwordHash, status: usersTable.status }).from(usersTable).where(eq(usersTable.id, row.userId));
  if (!user) {
    res.status(400).json({ error: "Token inválido", code: "TOKEN_INVALID" });
    return;
  }
  if (user.status !== "ACTIVE") {
    await db.insert(securityAuditLogsTable).values({
      eventType: "PASSWORD_RESET_DENIED_INACTIVE",
      targetUserId: row.userId,
      ip,
      userAgent,
    });
    res.status(403).json({ error: "Sua conta está desativada. Entre em contato com o suporte.", code: "ACCOUNT_INACTIVE" });
    return;
  }

  const historyRows = await db
    .select({ passwordHash: userPasswordHistoryTable.passwordHash })
    .from(userPasswordHistoryTable)
    .where(eq(userPasswordHistoryTable.userId, row.userId))
    .orderBy(desc(userPasswordHistoryTable.createdAt))
    .limit(2);
  const recentHashes = [user.passwordHash, ...historyRows.map((r) => r.passwordHash)];
  if (await isPasswordReused({ password: newPassword, hashes: recentHashes })) {
    await db.insert(securityAuditLogsTable).values({
      eventType: "PASSWORD_RESET_DENIED_REUSED_PASSWORD",
      targetUserId: row.userId,
      ip,
      userAgent,
    });
    res.status(400).json({ error: "A nova senha não pode ser igual às últimas senhas utilizadas.", code: "PASSWORD_REUSED" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.transaction(async (tx) => {
    await tx.insert(userPasswordHistoryTable).values({ userId: row.userId, passwordHash: user.passwordHash });
    await tx.update(usersTable).set({ passwordHash, mustChangePassword: false }).where(eq(usersTable.id, row.userId));
    await tx.update(passwordResetTokensTable).set({
      usedAt: now,
      usedIp: ip,
      usedUserAgent: userAgent,
    }).where(and(eq(passwordResetTokensTable.id, row.id), sql`${passwordResetTokensTable.usedAt} is null`));
    const oldIds = await tx
      .select({ id: userPasswordHistoryTable.id })
      .from(userPasswordHistoryTable)
      .where(eq(userPasswordHistoryTable.userId, row.userId))
      .orderBy(desc(userPasswordHistoryTable.createdAt))
      .offset(2);
    if (oldIds.length > 0) {
      await tx.delete(userPasswordHistoryTable).where(inArray(userPasswordHistoryTable.id, oldIds.map((r) => r.id)));
    }
  });

  await db.insert(securityAuditLogsTable).values({
    eventType: "PASSWORD_RESET_COMPLETED",
    targetUserId: row.userId,
    ip,
    userAgent,
    detail: row.purpose ? `purpose=${row.purpose}` : null,
  });

  res.json({ message: "Senha redefinida com sucesso" });
});

export default router;
