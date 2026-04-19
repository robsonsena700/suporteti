import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import multer from "multer";
import { db, usersTable, userCoordinatorsTable, ticketsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { UpdateUserBody } from "@workspace/api-zod";
import { requireAuth, requireActive, requireRoles } from "../middlewares/auth";
import { signToken } from "../middlewares/auth";
import { isValidCpf, normalizeCpf } from "../lib/cpf";
import { isValidBrazilMobile, normalizePhoneE164Brazil } from "../lib/phone";
import { validateMunicipalityForUf } from "../lib/ibge";
import { listCoordinatorsForUser } from "../lib/access";

const router: IRouter = Router();

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

type UserRole = "USER" | "COORDINATOR" | "ANALYST" | "ADMIN";
type UserStatus = "ACTIVE" | "INACTIVE";

function parseRole(value: unknown): UserRole | null {
  if (value === "USER" || value === "COORDINATOR" || value === "ANALYST" || value === "ADMIN") {
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

function generateTemporaryPassword(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%*";
  const bytes = randomBytes(length);
  let password = "";
  for (let i = 0; i < length; i += 1) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
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

router.get("/users/assignable", requireAuth, requireActive, requireRoles("ADMIN", "ANALYST", "COORDINATOR"), async (_req, res): Promise<void> => {
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

  const openStatuses = ["OPEN", "IN_PROGRESS"] as const;
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
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const coordinatorId = parseSingleCoordinatorId(
    (req.body as { coordinatorId?: unknown; coordinatorIds?: unknown } | undefined)?.coordinatorId
    ?? (req.body as { coordinatorId?: unknown; coordinatorIds?: unknown } | undefined)?.coordinatorIds,
  );
  if (!coordinatorId) {
    res.status(400).json({ error: "Informe um coordenador válido" });
    return;
  }

  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!targetUser) {
    res.status(404).json({ error: "Usuário não encontrado" });
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
  } else {
    if (parsed.data.cpf && !isValidCpf(parsed.data.cpf)) {
      res.status(400).json({ error: "CPF inválido" });
      return;
    }
    if (parsed.data.contactPhone && !isValidBrazilMobile(parsed.data.contactPhone)) {
      res.status(400).json({ error: "Contato inválido" });
      return;
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

router.post("/users/:id/reset-password", requireAuth, requireActive, requireRoles("ADMIN", "ANALYST", "COORDINATOR"), async (req, res): Promise<void> => {
  const currentUser = req.user!;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const providedPassword = (req.body as { temporaryPassword?: unknown } | undefined)?.temporaryPassword;
  if (providedPassword != null && (typeof providedPassword !== "string" || providedPassword.length < 8)) {
    res.status(400).json({ error: "A senha provisória deve possuir no mínimo 8 caracteres" });
    return;
  }
  const temporaryPassword = typeof providedPassword === "string"
    ? providedPassword
    : generateTemporaryPassword();

  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!targetUser) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  if (currentUser.role === "COORDINATOR" && currentUser.userId !== id) {
    const [link] = await db
      .select()
      .from(userCoordinatorsTable)
      .where(and(
        eq(userCoordinatorsTable.coordinatorId, currentUser.userId),
        eq(userCoordinatorsTable.userId, id),
      ));

    if (!link) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
  }

  const passwordHash = await bcrypt.hash(temporaryPassword, 10);
  await db.update(usersTable)
    .set({ passwordHash, mustChangePassword: true })
    .where(eq(usersTable.id, id));

  res.json({
    message: "Senha provisória atualizada com sucesso",
    temporaryPassword,
  });
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

  if (role === "USER" && !coordinatorId) {
    res.status(400).json({ error: "Usuário ativo deve possuir ao menos um coordenador" });
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
    if (coordinatorId) {
      await tx.insert(userCoordinatorsTable).values({ userId: id, coordinatorId });
    }

    return approvedUser;
  });

  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  res.json(user);
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
    res.status(404).json({ error: "Avatar não encontrado" });
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
