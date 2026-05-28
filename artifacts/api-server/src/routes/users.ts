import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import {
  db,
  passwordResetTokensTable,
  securityAuditLogsTable,
  usersTable,
  userCoordinatorsTable,
  gestorAllowedUsersTable,
  gestorCoordinatorsTable,
  ticketsTable,
} from "@workspace/db";
import { eq, and, inArray, or, sql } from "drizzle-orm";
import { UpdateUserBody } from "@workspace/api-zod";
import { requireAuth, requireActive, requireRoles } from "../middlewares/auth";
import { signToken } from "../middlewares/auth";
import { isValidCpf, normalizeCpf } from "../lib/cpf";
import { isValidBrazilMobile, normalizePhoneE164Brazil } from "../lib/phone";
import { validateMunicipalityForUf } from "../lib/ibge";
import { listCoordinatorsForUser } from "../lib/access";
import { requireHttpsInProduction, requireSameOriginInProduction } from "../middlewares/security";
import { logger } from "../lib/logger";
import { sendEmail } from "../lib/mailer";
import { buildPasswordResetEmail, buildPasswordResetLink, generateResetToken, hashResetToken } from "../lib/password-reset";
import { createInMemoryRateLimiter } from "../lib/rate-limit";

const router: IRouter = Router();

const adminEditEmailLimiter = createInMemoryRateLimiter({ windowMs: 60_000, max: 10 });

const AVATAR_MAX_SIZE = 1 * 1024 * 1024; // 1 MB
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Tipo de arquivo não permitido: ${file.mimetype}`));
  },
});

type UserRole = "USER" | "COORDINATOR" | "ANALYST" | "ADMIN" | "GESTOR";
type UserStatus = "ACTIVE" | "INACTIVE";

function parseRole(value: unknown): UserRole | null {
  if (value === "USER" || value === "COORDINATOR" || value === "ANALYST" || value === "ADMIN" || value === "GESTOR") {
    return value;
  }
  return null;
}

function parseStatus(value: unknown): UserStatus | null {
  if (value === "ACTIVE" || value === "INACTIVE") {
    return value;
  }
  return null;
}

function parseSingleCoordinatorId(value: unknown): number | null {
  if (Array.isArray(value)) {
    if (value.length !== 1) return null;
    const only = Number(value[0]);
    return Number.isInteger(only) && only > 0 ? only : null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

router.get("/users", requireAuth, requireActive, requireRoles("ADMIN", "ANALYST"), async (req, res): Promise<void> => {
  const { status, role, includeCoordinator } = req.query as { status?: string; role?: string; includeCoordinator?: string };

  const wantsCoordinator = includeCoordinator === "true" || includeCoordinator === "1";

  let query = wantsCoordinator
    ? db.select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      cpf: usersTable.cpf,
      establishment: usersTable.establishment,
      contactPhone: usersTable.contactPhone,
      prefersWhatsapp: usersTable.prefersWhatsapp,
      prefersTelegram: usersTable.prefersTelegram,
      termsAccepted: usersTable.termsAccepted,
      termsAcceptedAt: usersTable.termsAcceptedAt,
      birthDate: usersTable.birthDate,
      uf: usersTable.uf,
      municipality: usersTable.municipality,
      createdAt: usersTable.createdAt,
      coordinatorId: userCoordinatorsTable.coordinatorId,
    }).from(usersTable).leftJoin(userCoordinatorsTable, eq(userCoordinatorsTable.userId, usersTable.id))
    : db.select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      cpf: usersTable.cpf,
      establishment: usersTable.establishment,
      contactPhone: usersTable.contactPhone,
      prefersWhatsapp: usersTable.prefersWhatsapp,
      prefersTelegram: usersTable.prefersTelegram,
      termsAccepted: usersTable.termsAccepted,
      termsAcceptedAt: usersTable.termsAcceptedAt,
      birthDate: usersTable.birthDate,
      uf: usersTable.uf,
      municipality: usersTable.municipality,
      createdAt: usersTable.createdAt,
    }).from(usersTable);

  const conditions = [];
  if (status) conditions.push(eq(usersTable.status, status as any));
  if (role) conditions.push(eq(usersTable.role, role as any));

  const users = conditions.length > 0
    ? await query.where(and(...conditions))
    : await query;

  res.json(users);
});

router.get("/admin/users", requireAuth, requireActive, requireRoles("ADMIN"), async (req, res): Promise<void> => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSizeRaw = Number(req.query.pageSize || 20);
  const pageSize = Math.max(5, Math.min(50, Number.isFinite(pageSizeRaw) ? pageSizeRaw : 20));
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const qLower = q.toLowerCase();

  const where = q
    ? or(
      sql`lower(${usersTable.name}) like ${`%${qLower}%`}`,
      sql`lower(${usersTable.email}) like ${`%${qLower}%`}`,
    )
    : sql`true`;

  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(usersTable).where(where);
  const items = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(where)
    .orderBy(usersTable.name)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  res.json({ items, page, pageSize, total: Number(total) });
});

router.post("/admin/users/:id/password-reset", requireAuth, requireActive, requireRoles("ADMIN"), async (req, res): Promise<void> => {
  const actorUserId = req.user!.userId;
  const targetUserId = Number(req.params.id);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    res.status(400).json({ error: "Usuário inválido" });
    return;
  }

  const ip = String(req.ip || "");
  const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : "";

  const [admin] = await db.select({ id: usersTable.id, email: usersTable.email, name: usersTable.name }).from(usersTable)
    .where(eq(usersTable.id, actorUserId));
  const [target] = await db.select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, status: usersTable.status }).from(usersTable)
    .where(eq(usersTable.id, targetUserId));

  if (!target) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  const token = generateResetToken();
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await db.insert(passwordResetTokensTable).values({
    userId: target.id,
    tokenHash,
    purpose: "admin_reset",
    requestedByUserId: actorUserId,
    requestedIp: ip,
    requestedUserAgent: userAgent,
    expiresAt,
  });

  let resetLink = "";
  let mail: { subject: string; text: string; html: string };
  try {
    const baseUrl = resolvePublicBaseUrlFromRequest(req);
    resetLink = buildPasswordResetLink(token, baseUrl);
    mail = buildPasswordResetEmail({ recipientName: target.name, resetLink, expiresAt });
  } catch (err) {
    await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.tokenHash, tokenHash));
    await db.insert(securityAuditLogsTable).values({
      eventType: "ADMIN_PASSWORD_RESET_LINK_FAILED",
      actorUserId,
      targetUserId: target.id,
      targetEmail: target.email,
      ip,
      userAgent,
      detail: err instanceof Error ? String(err.message).slice(0, 500) : "Falha ao gerar link",
    });
    res.status(503).json({ error: "Falha ao gerar link de redefinição" });
    return;
  }

  try {
    await sendEmail({ to: target.email, subject: mail.subject, text: mail.text, html: mail.html });
    await db.insert(securityAuditLogsTable).values({
      eventType: "ADMIN_PASSWORD_RESET_EMAIL_SENT",
      actorUserId,
      targetUserId: target.id,
      targetEmail: target.email,
      ip,
      userAgent,
      detail: admin?.email ? `adminEmail=${admin.email}` : null,
    });
    res.json({ message: "Reset de senha enviado ao usuário" });
  } catch (err) {
    await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.tokenHash, tokenHash));
    await db.insert(securityAuditLogsTable).values({
      eventType: "ADMIN_PASSWORD_RESET_EMAIL_FAILED",
      actorUserId,
      targetUserId: target.id,
      targetEmail: target.email,
      ip,
      userAgent,
      detail: err instanceof Error ? String(err.message).slice(0, 500) : "Erro ao enviar e-mail",
    });
    logger.error({ err }, "Falha ao enviar e-mail de reset por administrador");
    res.status(503).json({ error: "Falha ao enviar e-mail de reset" });
  }
});

router.post(
  "/admin/users/:id/email",
  requireAuth,
  requireActive,
  requireRoles("ADMIN"),
  requireHttpsInProduction,
  requireSameOriginInProduction,
  async (req, res): Promise<void> => {
    const actorUserId = req.user!.userId;
    const targetUserId = Number(req.params.id);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      res.status(400).json({ error: "Usuário inválido" });
      return;
    }

    const ip = String(req.ip || "");
    const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : "";

    const rateKey = `${actorUserId}:${ip}`;
    const rate = adminEditEmailLimiter.check(rateKey);
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSeconds));
      res.status(429).json({ error: "Muitas tentativas. Tente novamente mais tarde." });
      return;
    }

    const body = req.body as { newEmail?: unknown; confirmNewEmail?: unknown; adminPassword?: unknown } | undefined;
    const newEmail = typeof body?.newEmail === "string" ? body.newEmail.trim().toLowerCase() : "";
    const confirmNewEmail = typeof body?.confirmNewEmail === "string" ? body.confirmNewEmail.trim().toLowerCase() : "";
    const adminPassword = typeof body?.adminPassword === "string" ? body.adminPassword : "";

    if (!newEmail || !isEmailLike(newEmail)) {
      res.status(400).json({ error: "E-mail inválido" });
      return;
    }
    if (newEmail !== confirmNewEmail) {
      res.status(400).json({ error: "Os e-mails não conferem" });
      return;
    }
    if (!adminPassword) {
      res.status(400).json({ error: "Informe a senha do administrador" });
      return;
    }

    const [admin] = await db.select({
      id: usersTable.id,
      email: usersTable.email,
      passwordHash: usersTable.passwordHash,
    }).from(usersTable).where(eq(usersTable.id, actorUserId));

    if (!admin) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }

    const ok = await bcrypt.compare(adminPassword, admin.passwordHash);
    if (!ok) {
      await db.insert(securityAuditLogsTable).values({
        eventType: "ADMIN_USER_EMAIL_CHANGE_DENIED_BAD_PASSWORD",
        actorUserId,
        targetUserId,
        ip,
        userAgent,
      });
      res.status(403).json({ error: "Senha do administrador inválida" });
      return;
    }

    const [target] = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
    }).from(usersTable).where(eq(usersTable.id, targetUserId));

    if (!target) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    const oldEmail = String(target.email || "").toLowerCase();
    if (oldEmail === newEmail) {
      res.status(400).json({ error: "O novo e-mail é igual ao e-mail atual" });
      return;
    }

    const [duplicate] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, newEmail));
    if (duplicate && duplicate.id !== target.id) {
      res.status(409).json({ error: "E-mail já cadastrado para outro usuário" });
      return;
    }

    const detail = JSON.stringify({
      oldEmail: target.email,
      newEmail,
      adminEmail: admin.email,
    });

    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ email: newEmail }).where(eq(usersTable.id, target.id));
      await tx.insert(securityAuditLogsTable).values({
        eventType: "ADMIN_USER_EMAIL_CHANGED",
        actorUserId,
        targetUserId: target.id,
        targetEmail: newEmail,
        ip,
        userAgent,
        detail,
      });
    });

    const mailOld = buildEmailChangedNotification({
      recipientEmail: target.email,
      recipientName: target.name,
      oldEmail: target.email,
      newEmail,
      adminEmail: admin.email,
    });
    const mailNew = buildEmailChangedNotification({
      recipientEmail: newEmail,
      recipientName: target.name,
      oldEmail: target.email,
      newEmail,
      adminEmail: admin.email,
    });

    try {
      await sendEmail({ to: target.email, subject: mailOld.subject, text: mailOld.text, html: mailOld.html });
      await sendEmail({ to: newEmail, subject: mailNew.subject, text: mailNew.text, html: mailNew.html });
    } catch (err) {
      await db.transaction(async (tx) => {
        await tx.update(usersTable).set({ email: target.email }).where(eq(usersTable.id, target.id));
        await tx.insert(securityAuditLogsTable).values({
          eventType: "ADMIN_USER_EMAIL_CHANGE_REVERTED_EMAIL_NOTIFICATION_FAILED",
          actorUserId,
          targetUserId: target.id,
          targetEmail: target.email,
          ip,
          userAgent,
          detail: err instanceof Error ? String(err.message).slice(0, 500) : "Falha ao enviar e-mails",
        });
      });
      logger.error({ err }, "Falha ao enviar e-mails de notificação da troca de e-mail");
      res.status(503).json({ error: "Falha ao enviar e-mails de notificação" });
      return;
    }

    res.json({ message: "E-mail atualizado com sucesso" });
  },
);

router.get("/users/assignable", requireAuth, requireActive, requireRoles("ADMIN", "ANALYST", "COORDINATOR", "GESTOR"), async (_req, res): Promise<void> => {
  const assignable = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    status: usersTable.status,
  }).from(usersTable).where(
    and(
      eq(usersTable.status, "ACTIVE"),
      inArray(usersTable.role, ["ADMIN", "ANALYST", "COORDINATOR"]),
    ),
  );

  const openStatuses = ["OPEN", "IN_PROGRESS", "AWAITING_CUSTOMER"] as const;
  const withLoad = await Promise.all(assignable.map(async (u) => {
    const assigned = await db.select({ id: ticketsTable.id }).from(ticketsTable).where(
      and(eq(ticketsTable.assignedToId, u.id), inArray(ticketsTable.status, [...openStatuses])),
    );
    return {
      ...u,
      assignedOpenTickets: assigned.length,
    };
  }));

  withLoad.sort((a, b) => a.assignedOpenTickets - b.assignedOpenTickets || a.name.localeCompare(b.name, "pt-BR"));
  res.json(withLoad);
});

function isEmailLike(value: string): boolean {
  const v = value.trim();
  if (v.length < 6) return false;
  const at = v.indexOf("@");
  if (at <= 0) return false;
  if (at !== v.lastIndexOf("@")) return false;
  const domain = v.slice(at + 1);
  if (domain.length < 3 || !domain.includes(".")) return false;
  if (v.includes(" ")) return false;
  return true;
}

function buildEmailChangedNotification(args: {
  recipientEmail: string;
  recipientName: string;
  oldEmail: string;
  newEmail: string;
  adminEmail: string;
}): { subject: string; text: string; html: string } {
  const subject = "SuporteTI — E-mail atualizado";
  const when = new Date().toLocaleString("pt-BR");

  const text =
    `Olá, ${args.recipientName}.\n\n` +
    `O e-mail da sua conta no SuporteTI foi atualizado por um administrador em ${when}.\n\n` +
    `E-mail anterior: ${args.oldEmail}\n` +
    `Novo e-mail: ${args.newEmail}\n\n` +
    `Se você não reconhece esta alteração, entre em contato com o suporte imediatamente.\n\n` +
    `Atenciosamente,\nEquipe SuporteTI\n`;

  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111">` +
    `<h2 style="margin:0 0 12px 0">SuporteTI</h2>` +
    `<p>Olá, <strong>${escapeHtml(args.recipientName)}</strong>.</p>` +
    `<p>O e-mail da sua conta foi atualizado por um administrador em <strong>${escapeHtml(when)}</strong>.</p>` +
    `<ul>` +
    `<li><strong>E-mail anterior:</strong> ${escapeHtml(args.oldEmail)}</li>` +
    `<li><strong>Novo e-mail:</strong> ${escapeHtml(args.newEmail)}</li>` +
    `</ul>` +
    `<p>Se você não reconhece esta alteração, entre em contato com o suporte imediatamente.</p>` +
    `<p style="margin-top:24px">Atenciosamente,<br/>Equipe SuporteTI</p>` +
    `</div>`;

  return { subject, text, html };
}

function escapeHtml(value: string) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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

router.get("/users/gestor-configs", requireAuth, requireActive, requireRoles("ADMIN", "ANALYST"), async (_req, res): Promise<void> => {
  const gestores = await db
    .select({ gestorId: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "GESTOR" as any));

  const coordinatorLinks = await db
    .select({ gestorId: gestorCoordinatorsTable.gestorId, coordinatorId: gestorCoordinatorsTable.coordinatorId })
    .from(gestorCoordinatorsTable);

  const allowedLinks = await db
    .select({ gestorId: gestorAllowedUsersTable.gestorId, userId: gestorAllowedUsersTable.userId })
    .from(gestorAllowedUsersTable);

  const coordinatorByGestor = new Map<number, number>();
  coordinatorLinks.forEach((r) => coordinatorByGestor.set(r.gestorId, r.coordinatorId));

  const allowedByGestor = new Map<number, number[]>();
  allowedLinks.forEach((r) => {
    const existing = allowedByGestor.get(r.gestorId) ?? [];
    existing.push(r.userId);
    allowedByGestor.set(r.gestorId, existing);
  });

  res.json(
    gestores.map((g) => ({
      gestorId: g.gestorId,
      coordinatorId: coordinatorByGestor.get(g.gestorId) ?? null,
      allowedUserIds: allowedByGestor.get(g.gestorId) ?? [],
    })),
  );
});

router.put("/users/:id/gestor-config", requireAuth, requireActive, requireRoles("ADMIN"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const body = req.body as { coordinatorId?: unknown; allowedUserIds?: unknown } | undefined;
  const coordinatorIdRaw = body?.coordinatorId;
  const coordinatorId = coordinatorIdRaw == null ? null : parseSingleCoordinatorId(coordinatorIdRaw);
  if (coordinatorIdRaw != null && !coordinatorId) {
    res.status(400).json({ error: "Coordenador inválido" });
    return;
  }

  const allowedRaw = body?.allowedUserIds;
  const allowedUserIds = Array.isArray(allowedRaw)
    ? allowedRaw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)
    : [];

  const uniqueAllowed = Array.from(new Set(allowedUserIds)).filter((uid) => uid !== id && uid !== coordinatorId);

  const [target] = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }
  if (target.role !== "GESTOR") {
    res.status(400).json({ error: "Usuário não possui perfil Gestor" });
    return;
  }

  if (coordinatorId != null) {
    const [coordinator] = await db.select({ id: usersTable.id, role: usersTable.role, status: usersTable.status })
      .from(usersTable)
      .where(eq(usersTable.id, coordinatorId));
    if (!coordinator) {
      res.status(400).json({ error: "Coordenador não encontrado" });
      return;
    }
    if (coordinator.role !== "COORDINATOR" || coordinator.status !== "ACTIVE") {
      res.status(400).json({ error: "Apenas coordenadores ativos podem ser vinculados" });
      return;
    }
  }

  if (uniqueAllowed.length > 0) {
    const targets = await db
      .select({ id: usersTable.id, role: usersTable.role, status: usersTable.status })
      .from(usersTable)
      .where(inArray(usersTable.id, uniqueAllowed));
    const byId = new Map(targets.map((t) => [t.id, t]));
    const missing = uniqueAllowed.filter((uid) => !byId.has(uid));
    if (missing.length > 0) {
      res.status(404).json({ error: "Usuário(s) não encontrado(s)", missing });
      return;
    }
    const invalid = targets.filter((t) => t.status !== "ACTIVE" || t.role !== "USER");
    if (invalid.length > 0) {
      res.status(400).json({ error: "Apenas usuários padrão ativos podem ser adicionados" });
      return;
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(gestorCoordinatorsTable).where(eq(gestorCoordinatorsTable.gestorId, id));
    if (coordinatorId != null) {
      await tx.insert(gestorCoordinatorsTable).values({ gestorId: id, coordinatorId });
    }
    await tx.delete(gestorAllowedUsersTable).where(eq(gestorAllowedUsersTable.gestorId, id));
    if (uniqueAllowed.length > 0) {
      await tx.insert(gestorAllowedUsersTable).values(uniqueAllowed.map((uid) => ({ gestorId: id, userId: uid })));
    }
  });

  res.json({ gestorId: id, coordinatorId: coordinatorId ?? null, allowedUserIds: uniqueAllowed });
});

router.get("/users/:id", requireAuth, requireActive, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [user] = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    status: usersTable.status,
    cpf: usersTable.cpf,
    establishment: usersTable.establishment,
    contactPhone: usersTable.contactPhone,
    prefersWhatsapp: usersTable.prefersWhatsapp,
    prefersTelegram: usersTable.prefersTelegram,
    termsAccepted: usersTable.termsAccepted,
    termsAcceptedAt: usersTable.termsAcceptedAt,
    birthDate: usersTable.birthDate,
    uf: usersTable.uf,
    municipality: usersTable.municipality,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(eq(usersTable.id, id));

  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  res.json(user);
});

router.get("/users/:id/coordinators", requireAuth, requireActive, async (req, res): Promise<void> => {
  const currentUser = req.user!;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  if (
    currentUser.userId !== id
    && currentUser.role !== "ADMIN"
    && currentUser.role !== "ANALYST"
  ) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const coordinators = await listCoordinatorsForUser(id);
  res.json(coordinators);
});

router.put("/users/:id/coordinators", requireAuth, requireActive, requireRoles("ADMIN", "ANALYST"), async (req, res): Promise<void> => {
  const currentUser = req.user!;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const coordinatorValue = (req.body as { coordinatorId?: unknown; coordinatorIds?: unknown } | undefined)?.coordinatorId
    ?? (req.body as { coordinatorId?: unknown; coordinatorIds?: unknown } | undefined)?.coordinatorIds;
  const coordinatorId = coordinatorValue == null ? null : parseSingleCoordinatorId(coordinatorValue);

  if (coordinatorValue != null && !coordinatorId) {
    res.status(400).json({ error: "Informe um coordenador válido" });
    return;
  }
  if (currentUser.role !== "ADMIN" && !coordinatorId) {
    res.status(400).json({ error: "Informe um coordenador válido" });
    return;
  }

  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!targetUser) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  if (!coordinatorId) {
    await db.delete(userCoordinatorsTable).where(eq(userCoordinatorsTable.userId, id));
    res.json([]);
    return;
  }

  const coordinators = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      status: usersTable.status,
    })
    .from(usersTable)
    .where(eq(usersTable.id, coordinatorId));

  if (coordinators.length !== 1) {
    res.status(400).json({ error: "Coordenador não encontrado" });
    return;
  }

  const invalidCoordinator = coordinators.find(c => c.role !== "COORDINATOR" || c.status !== "ACTIVE");
  if (invalidCoordinator) {
    res.status(400).json({ error: "Apenas coordenadores ativos podem ser vinculados" });
    return;
  }

  await db.transaction(async tx => {
    await tx.delete(userCoordinatorsTable).where(eq(userCoordinatorsTable.userId, id));
    await tx.insert(userCoordinatorsTable).values(
      [{ userId: id, coordinatorId }],
    );
  });

  const updated = await listCoordinatorsForUser(id);
  res.json(updated);
});

router.patch("/users/:id", requireAuth, requireActive, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const currentUser = req.user!;
  if (currentUser.userId !== id && currentUser.role !== "ADMIN") {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  const isSelfUpdate = currentUser.userId === id;
  const nextCpf = parsed.data.cpf ?? existing.cpf ?? "";
  const nextEstablishment = parsed.data.establishment ?? existing.establishment ?? "";
  const nextContactPhone = parsed.data.contactPhone ?? existing.contactPhone ?? "";
  const nextBirthDate = parsed.data.birthDate ?? existing.birthDate ?? null;
  const nextUf = parsed.data.uf ?? existing.uf;
  const nextMunicipality = parsed.data.municipality ?? existing.municipality;

  if (isSelfUpdate) {
    if (!nextCpf || !isValidCpf(nextCpf)) {
      res.status(400).json({ error: "CPF inválido" });
      return;
    }
    if (!nextEstablishment || nextEstablishment.trim().length < 2) {
      res.status(400).json({ error: "Estabelecimento/Unidade de Saúde é obrigatório" });
      return;
    }
    if (!nextContactPhone || !isValidBrazilMobile(nextContactPhone)) {
      res.status(400).json({ error: "Contato inválido" });
      return;
    }
    if (!nextBirthDate) {
      res.status(400).json({ error: "Data de nascimento é obrigatória" });
      return;
    }
    const min = new Date("1900-01-01T00:00:00.000Z");
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (!(nextBirthDate instanceof Date) || Number.isNaN(nextBirthDate.getTime())) {
      res.status(400).json({ error: "Data de nascimento inválida" });
      return;
    }
    if (nextBirthDate < min || nextBirthDate > today) {
      res.status(400).json({ error: "Data de nascimento inválida" });
      return;
    }
  } else {
    if (parsed.data.cpf && !isValidCpf(parsed.data.cpf)) {
      res.status(400).json({ error: "CPF inválido" });
      return;
    }
    if (parsed.data.contactPhone && !isValidBrazilMobile(parsed.data.contactPhone)) {
      res.status(400).json({ error: "Contato inválido" });
      return;
    }
    if (parsed.data.birthDate) {
      const min = new Date("1900-01-01T00:00:00.000Z");
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (Number.isNaN(parsed.data.birthDate.getTime()) || parsed.data.birthDate < min || parsed.data.birthDate > today) {
        res.status(400).json({ error: "Data de nascimento inválida" });
        return;
      }
    }
  }

  if ((parsed.data.uf || parsed.data.municipality) && nextUf && nextMunicipality) {
    try {
      const ok = await validateMunicipalityForUf(nextUf, nextMunicipality);
      if (!ok) {
        res.status(400).json({ error: "Município não pertence à UF informada" });
        return;
      }
    } catch {
      res.status(503).json({ error: "Serviço do IBGE indisponível no momento" });
      return;
    }
  }

  const patch: Record<string, unknown> = { ...parsed.data };

  if (parsed.data.cpf) {
    const normalizedCpf = normalizeCpf(parsed.data.cpf);
    const [cpfExisting] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.cpf, normalizedCpf));
    if (cpfExisting && cpfExisting.id !== id) {
      res.status(409).json({ error: "CPF já cadastrado" });
      return;
    }
    patch.cpf = normalizedCpf;
  }

  if (parsed.data.contactPhone) {
    patch.contactPhone = normalizePhoneE164Brazil(parsed.data.contactPhone);
  }

  const [user] = await db.update(usersTable)
    .set(patch as any)
    .where(eq(usersTable.id, id))
    .returning({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      cpf: usersTable.cpf,
      establishment: usersTable.establishment,
      contactPhone: usersTable.contactPhone,
      prefersWhatsapp: usersTable.prefersWhatsapp,
      prefersTelegram: usersTable.prefersTelegram,
      termsAccepted: usersTable.termsAccepted,
      termsAcceptedAt: usersTable.termsAcceptedAt,
      birthDate: usersTable.birthDate,
      uf: usersTable.uf,
      municipality: usersTable.municipality,
      createdAt: usersTable.createdAt,
    });

  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  res.json(user);
});

router.post("/users/:id/status", requireAuth, requireActive, requireRoles("ADMIN", "ANALYST"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const status = parseStatus((req.body as { status?: unknown } | undefined)?.status);
  if (!status) {
    res.status(400).json({ error: "Status inválido" });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  if (status === "ACTIVE" && existing.role === "USER") {
    const [link] = await db.select().from(userCoordinatorsTable).where(eq(userCoordinatorsTable.userId, id));
    if (!link) {
      res.status(400).json({ error: "Usuário ativo deve possuir ao menos um coordenador" });
      return;
    }
  }
  if (status === "ACTIVE" && existing.role === "GESTOR") {
    const [link] = await db.select().from(gestorCoordinatorsTable).where(eq(gestorCoordinatorsTable.gestorId, id));
    if (!link) {
      res.status(400).json({ error: "Gestor ativo deve possuir um coordenador principal vinculado" });
      return;
    }
  }

  const [user] = await db.update(usersTable)
    .set({ status })
    .where(eq(usersTable.id, id))
    .returning({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      cpf: usersTable.cpf,
      establishment: usersTable.establishment,
      contactPhone: usersTable.contactPhone,
      prefersWhatsapp: usersTable.prefersWhatsapp,
      prefersTelegram: usersTable.prefersTelegram,
      termsAccepted: usersTable.termsAccepted,
      termsAcceptedAt: usersTable.termsAcceptedAt,
      uf: usersTable.uf,
      municipality: usersTable.municipality,
      createdAt: usersTable.createdAt,
    });

  res.json(user);
});

router.post("/users/:id/approve", requireAuth, requireActive, requireRoles("ADMIN"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const role = parseRole((req.body as { role?: unknown } | undefined)?.role);
  if (!role) {
    res.status(400).json({ error: "Perfil inválido" });
    return;
  }

  const coordinatorValue = (req.body as { coordinatorId?: unknown; coordinatorIds?: unknown } | undefined)?.coordinatorId
    ?? (req.body as { coordinatorId?: unknown; coordinatorIds?: unknown } | undefined)?.coordinatorIds;
  const coordinatorId = coordinatorValue == null ? null : parseSingleCoordinatorId(coordinatorValue);
  if (coordinatorValue != null && !coordinatorId) {
    res.status(400).json({ error: "Coordenador inválido" });
    return;
  }
  if (role === "USER" && coordinatorId == null) {
    res.status(400).json({ error: "Usuário padrão deve possuir um coordenador" });
    return;
  }
  if (role === "GESTOR" && coordinatorId == null) {
    res.status(400).json({ error: "Gestor deve possuir um coordenador principal" });
    return;
  }

  if (coordinatorId) {
    const coordinators = await db
      .select({
        id: usersTable.id,
        role: usersTable.role,
        status: usersTable.status,
      })
      .from(usersTable)
      .where(eq(usersTable.id, coordinatorId));
    if (coordinators.length !== 1) {
      res.status(400).json({ error: "Coordenador não encontrado" });
      return;
    }
    const invalid = coordinators.find(c => c.role !== "COORDINATOR" || c.status !== "ACTIVE");
    if (invalid) {
      res.status(400).json({ error: "Apenas coordenadores ativos podem ser vinculados" });
      return;
    }
  }

  const user = await db.transaction(async tx => {
    const [approvedUser] = await tx.update(usersTable)
      .set({ role, status: "ACTIVE" })
      .where(eq(usersTable.id, id))
      .returning({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        status: usersTable.status,
        cpf: usersTable.cpf,
        establishment: usersTable.establishment,
        contactPhone: usersTable.contactPhone,
        prefersWhatsapp: usersTable.prefersWhatsapp,
        prefersTelegram: usersTable.prefersTelegram,
        termsAccepted: usersTable.termsAccepted,
        termsAcceptedAt: usersTable.termsAcceptedAt,
        uf: usersTable.uf,
        municipality: usersTable.municipality,
        createdAt: usersTable.createdAt,
      });

    await tx.delete(userCoordinatorsTable).where(eq(userCoordinatorsTable.userId, id));
    await tx.delete(gestorCoordinatorsTable).where(eq(gestorCoordinatorsTable.gestorId, id));
    await tx.delete(gestorAllowedUsersTable).where(eq(gestorAllowedUsersTable.gestorId, id));

    if (role === "USER" && coordinatorId) {
      await tx.insert(userCoordinatorsTable).values({ userId: id, coordinatorId });
    }
    if (role === "GESTOR" && coordinatorId) {
      await tx.insert(gestorCoordinatorsTable).values({ gestorId: id, coordinatorId });
    }

    return approvedUser;
  });

  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  res.json(user);
});

router.post("/users/:id/role", requireAuth, requireActive, requireRoles("ADMIN"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const role = parseRole((req.body as { role?: unknown } | undefined)?.role);
  if (!role) {
    res.status(400).json({ error: "Perfil inválido" });
    return;
  }

  const currentUser = req.user!;
  if (currentUser.userId === id && role !== "ADMIN") {
    res.status(400).json({ error: "Não é permitido remover seu próprio perfil de administrador" });
    return;
  }

  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!targetUser) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  const coordinatorValue = (req.body as { coordinatorId?: unknown; coordinatorIds?: unknown } | undefined)?.coordinatorId
    ?? (req.body as { coordinatorId?: unknown; coordinatorIds?: unknown } | undefined)?.coordinatorIds;
  const coordinatorId = coordinatorValue != null ? parseSingleCoordinatorId(coordinatorValue) : null;

  if ((role === "USER" || role === "GESTOR") && coordinatorId == null) {
    res.status(400).json({ error: "Informe um coordenador válido" });
    return;
  }
  if ((role === "USER" || role === "GESTOR") && coordinatorId != null) {
    const coordinators = await db
      .select({
        id: usersTable.id,
        role: usersTable.role,
        status: usersTable.status,
      })
      .from(usersTable)
      .where(eq(usersTable.id, coordinatorId));

    if (coordinators.length !== 1) {
      res.status(400).json({ error: "Coordenador não encontrado" });
      return;
    }

    const invalidCoordinator = coordinators.find(c => c.role !== "COORDINATOR" || c.status !== "ACTIVE");
    if (invalidCoordinator) {
      res.status(400).json({ error: "Apenas coordenadores ativos podem ser vinculados" });
      return;
    }
  }

  const result = await db.transaction(async tx => {
    const [updated] = await tx.update(usersTable)
      .set({ role })
      .where(eq(usersTable.id, id))
      .returning({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        status: usersTable.status,
        cpf: usersTable.cpf,
        establishment: usersTable.establishment,
        contactPhone: usersTable.contactPhone,
        prefersWhatsapp: usersTable.prefersWhatsapp,
        prefersTelegram: usersTable.prefersTelegram,
        termsAccepted: usersTable.termsAccepted,
        termsAcceptedAt: usersTable.termsAcceptedAt,
        uf: usersTable.uf,
        municipality: usersTable.municipality,
        createdAt: usersTable.createdAt,
      });

    if (!updated) return null;

    await tx.delete(userCoordinatorsTable).where(eq(userCoordinatorsTable.userId, id));
    await tx.delete(gestorCoordinatorsTable).where(eq(gestorCoordinatorsTable.gestorId, id));
    await tx.delete(gestorAllowedUsersTable).where(eq(gestorAllowedUsersTable.gestorId, id));

    if (role === "USER" && coordinatorId != null) {
      await tx.insert(userCoordinatorsTable).values({ userId: id, coordinatorId });
    }
    if (role === "GESTOR" && coordinatorId != null) {
      await tx.insert(gestorCoordinatorsTable).values({ gestorId: id, coordinatorId });
    }

    return updated;
  });

  if (!result) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  res.json(result);
});

router.get("/users/:id/avatar", requireAuth, requireActive, async (req, res): Promise<void> => {
  const currentUser = req.user!;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  if (
    currentUser.userId !== id
    && currentUser.role !== "ADMIN"
    && currentUser.role !== "ANALYST"
    && currentUser.role !== "COORDINATOR"
    && currentUser.role !== "GESTOR"
  ) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const [u] = await db.select({
    id: usersTable.id,
    avatarMimeType: usersTable.avatarMimeType,
    avatarData: usersTable.avatarData,
  }).from(usersTable).where(eq(usersTable.id, id));

  if (!u || !u.avatarMimeType || !u.avatarData) {
    res.setHeader("Cache-Control", "no-store");
    res.json(null);
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({ mimeType: u.avatarMimeType, data: u.avatarData });
});

router.post(
  "/users/me/avatar",
  requireAuth,
  requireActive,
  avatarUpload.single("file"),
  async (req, res): Promise<void> => {
    const currentUser = req.user!;
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ error: "Arquivo não enviado" });
      return;
    }

    const base64 = file.buffer.toString("base64");
    await db.update(usersTable).set({
      avatarMimeType: file.mimetype,
      avatarData: base64,
    }).where(eq(usersTable.id, currentUser.userId));

    res.json({ message: "Avatar atualizado com sucesso" });
  },
);

router.delete("/users/me/avatar", requireAuth, requireActive, async (req, res): Promise<void> => {
  const currentUser = req.user!;
  await db.update(usersTable).set({ avatarMimeType: null, avatarData: null }).where(eq(usersTable.id, currentUser.userId));
  res.json({ message: "Avatar removido com sucesso" });
});

export default router;
