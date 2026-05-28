import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, passwordResetTokensTable, securityAuditLogsTable, usersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { RegisterBody, LoginBody } from "@workspace/api-zod";
import { signToken, requireAuth } from "../middlewares/auth";
import { isValidCpf, normalizeCpf } from "../lib/cpf";
import { isValidBrazilMobile, normalizePhoneE164Brazil } from "../lib/phone";
import { validateMunicipalityForUf } from "../lib/ibge";
import { logger } from "../lib/logger";
import { sendEmail } from "../lib/mailer";
import { buildPasswordResetEmail, buildPasswordResetLink, generateResetToken, hashResetToken } from "../lib/password-reset";

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
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ error: "A nova senha deve possuir no mínimo 8 caracteres" });
    return;
  }

  const userId = req.user!.userId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Senha atual inválida" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(usersTable)
    .set({ passwordHash, mustChangePassword: false })
    .where(eq(usersTable.id, userId));

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
    res.status(403).json({ error: "Conta não está ativa" });
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

  const resetLink = buildPasswordResetLink(token);
  const mail = buildPasswordResetEmail({ recipientName: user.name, resetLink, expiresAt });

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

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const body = req.body as { token?: unknown; newPassword?: unknown } | undefined;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (!token) {
    res.status(400).json({ error: "Token inválido", code: "TOKEN_INVALID" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "A nova senha deve possuir no mínimo 8 caracteres" });
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

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(usersTable).set({ passwordHash, mustChangePassword: false }).where(eq(usersTable.id, row.userId));
  await db.update(passwordResetTokensTable).set({
    usedAt: now,
    usedIp: ip,
    usedUserAgent: userAgent,
  }).where(and(eq(passwordResetTokensTable.id, row.id), sql`${passwordResetTokensTable.usedAt} is null`));

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
