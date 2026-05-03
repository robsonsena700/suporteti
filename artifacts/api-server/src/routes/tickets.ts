import { Router, type IRouter } from "express";
import { db, userCoordinatorsTable, usersTable, ticketsTable, ticketAttachmentsTable, ticketAuditLogsTable, messagesTable, ticketCollaboratorsTable, ticketRatingsTable } from "@workspace/db";
import { eq, and, desc, inArray, or, sql, asc } from "drizzle-orm";
import { CreateTicketBody, UpdateTicketBody, AssignTicketBody, CreateRatingSchema } from "@workspace/api-zod";
import { requireAuth, requireActive, requireRoles } from "../middlewares/auth";
import { enforceTicketAccess, getManagedUserIdsByCoordinator } from "../lib/access";
import { canReopenClosedTicket, REOPEN_WINDOW_HOURS } from "../lib/ticket-reopen-policy";
import { canReceiveReassign, requiresStaffAssigneeForStatus } from "../lib/ticket-reassign-policy";
import { validateMunicipalityForUf } from "../lib/ibge";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const userRefSelect = {
  id: usersTable.id,
  name: usersTable.name,
  email: usersTable.email,
  role: usersTable.role,
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseTicketType(value: unknown): "SOFTWARE" | "HARDWARE" | null {
  if (value === "SOFTWARE" || value === "HARDWARE") return value;
  return null;
}

function parseTicketStatus(value: unknown): "OPEN" | "IN_PROGRESS" | "AWAITING_CUSTOMER" | "RESOLVED" | "CLOSED" | null {
  if (value === "OPEN" || value === "IN_PROGRESS" || value === "AWAITING_CUSTOMER" || value === "RESOLVED" || value === "CLOSED") return value;
  return null;
}

function parseTicketPriority(value: unknown): "LOW" | "MEDIUM" | "HIGH" | null {
  if (value === "LOW" || value === "MEDIUM" || value === "HIGH") return value;
  return null;
}

function parseBooleanQuery(value: unknown): boolean | null {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

function formatChange(field: string, from: unknown, to: unknown): string {
  const fromText = from == null || from === "" ? "—" : String(from);
  const toText = to == null || to === "" ? "—" : String(to);
  return `${field}: ${fromText} -> ${toText}`;
}

async function auditTicketUpdate(args: {
  ticketId: number;
  actorUserId: number;
  changes: Array<{ field: string; from: unknown; to: unknown }>;
}): Promise<void> {
  const { ticketId, actorUserId, changes } = args;
  if (changes.length === 0) return;
  const detail = changes.map(c => formatChange(c.field, c.from, c.to)).join("\n");
  await db.insert(ticketAuditLogsTable).values({
    ticketId,
    actorUserId,
    type: "TICKET_UPDATED",
    detail,
  });
}

router.get("/tickets", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const { status, type, priority, uf, municipality, mine, noCoordinator } = req.query as Record<string, string | undefined>;

  const whereClauses = [];
  if (user.role !== "ADMIN" && user.role !== "ANALYST") {
    if (user.role === "COORDINATOR") {
      const managedUserIds = await getManagedUserIdsByCoordinator(user.userId);
      const allowedOwners = [user.userId, ...managedUserIds];
      whereClauses.push(
        or(
          inArray(ticketsTable.createdById, allowedOwners),
          eq(ticketsTable.assignedToId, user.userId),
          sql`exists(select 1 from public.ticket_collaborators tc where tc.ticket_id = ${ticketsTable.id} and tc.user_id = ${user.userId})`,
        ),
      );
    } else {
      whereClauses.push(
        or(
          eq(ticketsTable.createdById, user.userId),
          eq(ticketsTable.assignedToId, user.userId),
        ),
      );
    }
  }

  const parsedMine = mine != null ? parseBooleanQuery(mine) : null;
  if (mine != null && parsedMine == null) {
    res.status(400).json({ error: "Filtro inválido" });
    return;
  }
  if (parsedMine === true && !(user.role === "ADMIN" || user.role === "ANALYST" || user.role === "COORDINATOR")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const parsedNoCoordinator = noCoordinator != null ? parseBooleanQuery(noCoordinator) : null;
  if (noCoordinator != null && parsedNoCoordinator == null) {
    res.status(400).json({ error: "Filtro inválido" });
    return;
  }
  if (parsedNoCoordinator === true && !(user.role === "ADMIN" || user.role === "ANALYST")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const parsedStatus = status != null ? parseTicketStatus(status) : null;
  if (status != null && !parsedStatus) {
    res.status(400).json({ error: "Status inválido" });
    return;
  }
  if (parsedStatus === "RESOLVED" || parsedStatus === "CLOSED") {
    res.status(400).json({ error: "Use a aba Resolvidos para listar chamados concluídos." });
    return;
  }

  const parsedType = type != null ? parseTicketType(type) : null;
  if (type != null && !parsedType) {
    res.status(400).json({ error: "Tipo inválido" });
    return;
  }

  const parsedPriority = priority != null ? parseTicketPriority(priority) : null;
  if (priority != null && !parsedPriority) {
    res.status(400).json({ error: "Prioridade inválida" });
    return;
  }

  const parsedUf = uf != null ? normalizeText(uf)?.toUpperCase() ?? null : null;
  const parsedMunicipality = municipality != null ? normalizeText(municipality) : null;

  const dbWhereClauses: any[] = [];
  if (whereClauses.length > 0) dbWhereClauses.push(and(...whereClauses));
  if (parsedMine === true) {
    dbWhereClauses.push(
      or(
        eq(ticketsTable.createdById, user.userId),
        eq(ticketsTable.assignedToId, user.userId),
      ),
    );
  }
  dbWhereClauses.push(inArray(ticketsTable.status, parsedStatus ? [parsedStatus] : ["OPEN", "IN_PROGRESS", "AWAITING_CUSTOMER"]));
  if (parsedType) dbWhereClauses.push(eq(ticketsTable.type, parsedType));
  if (parsedPriority) dbWhereClauses.push(eq(ticketsTable.priority, parsedPriority));
  if (parsedUf) dbWhereClauses.push(eq(ticketsTable.uf, parsedUf));
  if (parsedMunicipality) dbWhereClauses.push(eq(ticketsTable.municipality, parsedMunicipality));
  if (parsedNoCoordinator === true) {
    dbWhereClauses.push(
      sql`not exists(select 1 from public.user_coordinators uc where uc.user_id = ${ticketsTable.createdById})`,
    );
  }

  const finalWhere = dbWhereClauses.length > 0 ? and(...dbWhereClauses) : undefined;

  const allTickets = await db.query.ticketsTable.findMany({
    where: finalWhere,
    with: {
      createdBy: true,
      assignedTo: true,
      attachments: {
        columns: { id: true, mimeType: true },
      },
    },
    orderBy: [desc(ticketsTable.createdAt)],
  });
  const ownerIds = Array.from(new Set(allTickets.map(t => t.createdById)));
  const ownersWithCoordinator = ownerIds.length > 0
    ? new Set(
      (await db
        .select({ userId: userCoordinatorsTable.userId })
        .from(userCoordinatorsTable)
        .where(inArray(userCoordinatorsTable.userId, ownerIds)))
        .map((r) => r.userId),
    )
    : new Set<number>();
  const result = allTickets.map(t => ({
    id: t.id,
    title: t.title,
    description: t.description,
    type: t.type,
    hardwareSubtype: t.hardwareSubtype ?? null,
    status: t.status,
    priority: t.priority,
    uf: t.uf,
    municipality: t.municipality,
    establishment: t.establishment ?? null,
    dueAt: t.dueAt ?? null,
    imageAttachmentsCount: (t.attachments ?? []).filter(a => a.mimeType.startsWith("image/")).length,
    ownerHasCoordinator: ownersWithCoordinator.has(t.createdById),
    createdById: t.createdById,
    assignedToId: t.assignedToId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    createdBy: t.createdBy ? {
      id: t.createdBy.id,
      name: t.createdBy.name,
      email: t.createdBy.email,
      role: t.createdBy.role,
    } : null,
    assignedTo: t.assignedTo ? {
      id: t.assignedTo.id,
      name: t.assignedTo.name,
      email: t.assignedTo.email,
      role: t.assignedTo.role,
    } : null,
  }));

  res.json(result);
});

router.get("/tickets/resolved", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const { status, type, priority, uf, municipality, mine, noCoordinator } = req.query as Record<string, string | undefined>;

  const whereClauses = [];
  if (user.role !== "ADMIN" && user.role !== "ANALYST") {
    if (user.role === "COORDINATOR") {
      const managedUserIds = await getManagedUserIdsByCoordinator(user.userId);
      const allowedOwners = [user.userId, ...managedUserIds];
      whereClauses.push(
        or(
          inArray(ticketsTable.createdById, allowedOwners),
          eq(ticketsTable.assignedToId, user.userId),
          sql`exists(select 1 from public.ticket_collaborators tc where tc.ticket_id = ${ticketsTable.id} and tc.user_id = ${user.userId})`,
        ),
      );
    } else {
      whereClauses.push(
        or(
          eq(ticketsTable.createdById, user.userId),
          eq(ticketsTable.assignedToId, user.userId),
        ),
      );
    }
  }

  const parsedMine = mine != null ? parseBooleanQuery(mine) : null;
  if (mine != null && parsedMine == null) {
    res.status(400).json({ error: "Filtro inválido" });
    return;
  }

  const parsedNoCoordinator = noCoordinator != null ? parseBooleanQuery(noCoordinator) : null;
  if (noCoordinator != null && parsedNoCoordinator == null) {
    res.status(400).json({ error: "Filtro inválido" });
    return;
  }
  if (parsedNoCoordinator === true && !(user.role === "ADMIN" || user.role === "ANALYST")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const parsedStatus = status != null ? parseTicketStatus(status) : null;
  if (status != null && !parsedStatus) {
    res.status(400).json({ error: "Status inválido" });
    return;
  }
  if (parsedStatus && parsedStatus !== "RESOLVED" && parsedStatus !== "CLOSED") {
    res.status(400).json({ error: "Status inválido" });
    return;
  }

  const parsedType = type != null ? parseTicketType(type) : null;
  if (type != null && !parsedType) {
    res.status(400).json({ error: "Tipo inválido" });
    return;
  }

  const parsedPriority = priority != null ? parseTicketPriority(priority) : null;
  if (priority != null && !parsedPriority) {
    res.status(400).json({ error: "Prioridade inválida" });
    return;
  }

  const parsedUf = uf != null ? normalizeText(uf)?.toUpperCase() ?? null : null;
  const parsedMunicipality = municipality != null ? normalizeText(municipality) : null;

  const dbWhereClauses: any[] = [];
  if (whereClauses.length > 0) dbWhereClauses.push(and(...whereClauses));
  if (parsedMine === true) {
    dbWhereClauses.push(
      or(
        eq(ticketsTable.createdById, user.userId),
        eq(ticketsTable.assignedToId, user.userId),
      ),
    );
  }
  dbWhereClauses.push(inArray(ticketsTable.status, parsedStatus ? [parsedStatus] : ["RESOLVED", "CLOSED"]));
  if (parsedType) dbWhereClauses.push(eq(ticketsTable.type, parsedType));
  if (parsedPriority) dbWhereClauses.push(eq(ticketsTable.priority, parsedPriority));
  if (parsedUf) dbWhereClauses.push(eq(ticketsTable.uf, parsedUf));
  if (parsedMunicipality) dbWhereClauses.push(eq(ticketsTable.municipality, parsedMunicipality));
  if (parsedNoCoordinator === true) {
    dbWhereClauses.push(
      sql`not exists(select 1 from public.user_coordinators uc where uc.user_id = ${ticketsTable.createdById})`,
    );
  }

  const finalWhere = dbWhereClauses.length > 0 ? and(...dbWhereClauses) : undefined;

  const allTickets = await db.query.ticketsTable.findMany({
    where: finalWhere,
    with: {
      createdBy: true,
      assignedTo: true,
      attachments: {
        columns: { id: true, mimeType: true },
      },
    },
    orderBy: [desc(ticketsTable.createdAt)],
  });

  const result = allTickets.map(t => ({
    id: t.id,
    title: t.title,
    description: t.description,
    type: t.type,
    hardwareSubtype: t.hardwareSubtype ?? null,
    status: t.status,
    priority: t.priority,
    uf: t.uf,
    municipality: t.municipality,
    establishment: t.establishment ?? null,
    imageAttachmentsCount: (t.attachments ?? []).filter(a => a.mimeType.startsWith("image/")).length,
    createdById: t.createdById,
    assignedToId: t.assignedToId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    createdBy: t.createdBy ? {
      id: t.createdBy.id,
      name: t.createdBy.name,
      email: t.createdBy.email,
      role: t.createdBy.role,
    } : null,
    assignedTo: t.assignedTo ? {
      id: t.assignedTo.id,
      name: t.assignedTo.name,
      email: t.assignedTo.email,
      role: t.assignedTo.role,
    } : null,
  }));

  res.json(result);
});

router.post("/tickets", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const parsed = CreateTicketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [ticket] = await db.insert(ticketsTable).values({
    ...parsed.data,
    uf: user.uf,
    municipality: user.municipality,
    createdById: user.userId,
    status: "OPEN",
  }).returning();

  const [createdBy] = await db.select().from(usersTable).where(eq(usersTable.id, user.userId));

  res.status(201).json({
    ...ticket,
    establishment: ticket.establishment ?? null,
    createdBy: {
      id: createdBy.id,
      name: createdBy.name,
      email: createdBy.email,
      role: createdBy.role,
    },
    assignedTo: null,
  });
});

router.get("/tickets/:id", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const ticket = await db.query.ticketsTable.findFirst({
    where: eq(ticketsTable.id, id),
    with: {
      createdBy: true,
      assignedTo: true,
      messages: {
        with: { sender: true },
        orderBy: (m, { asc }) => [asc(m.createdAt)],
      },
      rating: true,
      attachments: {
        columns: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
      },
      collaborators: {
        with: { user: true },
        orderBy: (c, { asc }) => [asc(c.createdAt)],
      },
    },
  });

  if (!ticket) {
    res.status(404).json({ error: "Chamado não encontrado" });
    return;
  }

  if (!(await enforceTicketAccess(user, ticket, "tickets:getById"))) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const [coordLink] = await db
    .select({ userId: userCoordinatorsTable.userId })
    .from(userCoordinatorsTable)
    .where(eq(userCoordinatorsTable.userId, ticket.createdById));
  const ownerHasCoordinator = Boolean(coordLink?.userId);

  res.json({
    id: ticket.id,
    title: ticket.title,
    description: ticket.description,
    type: ticket.type,
    hardwareSubtype: ticket.hardwareSubtype ?? null,
    status: ticket.status,
    priority: ticket.priority,
    uf: ticket.uf,
    municipality: ticket.municipality,
    establishment: ticket.establishment ?? null,
    createdById: ticket.createdById,
    assignedToId: ticket.assignedToId,
    dueAt: (ticket as any).dueAt ?? null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    ownerHasCoordinator,
    createdBy: ticket.createdBy ? {
      id: ticket.createdBy.id,
      name: ticket.createdBy.name,
      email: ticket.createdBy.email,
      role: ticket.createdBy.role,
    } : null,
    assignedTo: ticket.assignedTo ? {
      id: ticket.assignedTo.id,
      name: ticket.assignedTo.name,
      email: ticket.assignedTo.email,
      role: ticket.assignedTo.role,
    } : null,
    messages: ticket.messages.map(m => ({
      id: m.id,
      ticketId: m.ticketId,
      senderId: m.senderId,
      message: m.message,
      createdAt: m.createdAt,
      sender: {
        id: m.sender.id,
        name: m.sender.name,
        email: m.sender.email,
        role: m.sender.role,
      },
    })),
    rating: user.role === "USER" && ticket.createdById === user.userId
      ? (
        ticket.rating
          ? {
            id: ticket.rating.id,
            ticketId: ticket.rating.ticketId,
            userId: ticket.createdById,
            score: ticket.rating.rating,
            feedback: ticket.rating.comment ?? null,
            createdAt: ticket.rating.createdAt,
          }
          : null
      )
      : undefined,
    attachments: ticket.attachments.map(a => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      createdAt: a.createdAt,
    })),
    collaborators: ticket.collaborators.map((c) => ({
      id: c.user.id,
      name: c.user.name,
      email: c.user.email,
      role: c.user.role,
    })),
  });
});

router.post("/tickets/:id/rate", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  if (user.role !== "USER") {
    res.status(403).json({ error: "Apenas usuário padrão pode avaliar chamados" });
    return;
  }
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const ticketId = parseInt(raw, 10);

  if (isNaN(ticketId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId));
  if (!ticket) {
    res.status(404).json({ error: "Chamado não encontrado" });
    return;
  }

  if (ticket.createdById !== user.userId) {
    res.status(403).json({ error: "Apenas o criador do chamado pode avaliá-lo" });
    return;
  }

  if (ticket.status !== "RESOLVED") {
    res.status(400).json({ error: "Chamado deve estar resolvido para ser avaliado" });
    return;
  }

  const parsed = CreateRatingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select({ id: ticketRatingsTable.id })
    .from(ticketRatingsTable)
    .where(eq(ticketRatingsTable.ticketId, ticketId));

  if (existing) {
    res.status(409).json({ error: "Este chamado já foi avaliado" });
    return;
  }

  const [created] = await db
    .insert(ticketRatingsTable)
    .values({
      ticketId,
      rating: parsed.data.rating,
      reasonLowRating: parsed.data.reason_low_rating?.trim() ?? null,
      comment: parsed.data.comment?.trim() ?? null,
    })
    .returning();

  res.status(201).json({
    id: created.id,
    ticketId: created.ticketId,
    rating: created.rating,
    reason_low_rating: created.reasonLowRating ?? null,
    comment: created.comment ?? null,
    created_at: created.createdAt,
  });
});

router.get(
  "/tickets/:id/collaborators",
  requireAuth,
  requireActive,
  requireRoles("ADMIN", "ANALYST", "COORDINATOR"),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, id));
    if (!ticket) {
      res.status(404).json({ error: "Chamado não encontrado" });
      return;
    }

    if (!(await enforceTicketAccess(user, ticket, "tickets:getById"))) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }

    const rows = await db
      .select(userRefSelect)
      .from(ticketCollaboratorsTable)
      .innerJoin(usersTable, eq(usersTable.id, ticketCollaboratorsTable.userId))
      .where(eq(ticketCollaboratorsTable.ticketId, id))
      .orderBy(asc(usersTable.name));

    res.json(rows);
  },
);

router.post(
  "/tickets/:id/collaborators",
  requireAuth,
  requireActive,
  requireRoles("ADMIN", "ANALYST", "COORDINATOR"),
  async (req, res): Promise<void> => {
    const actor = req.user!;
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(raw, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const userIdsRaw = body.userIds;
    if (!Array.isArray(userIdsRaw) || userIdsRaw.length === 0) {
      res.status(400).json({ error: "Informe userIds" });
      return;
    }

    const userIds = Array.from(
      new Set(
        userIdsRaw
          .map((v) => (typeof v === "number" ? v : Number(v)))
          .filter((v) => Number.isInteger(v) && v > 0),
      ),
    );

    if (userIds.length === 0) {
      res.status(400).json({ error: "Informe ao menos um usuário válido" });
      return;
    }

    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, id));
    if (!ticket) {
      res.status(404).json({ error: "Chamado não encontrado" });
      return;
    }

    if (!(await enforceTicketAccess(actor, ticket, "tickets:collaborators"))) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }

    const targets = await db.select().from(usersTable).where(inArray(usersTable.id, userIds));
    const targetsById = new Map(targets.map(t => [t.id, t]));
    const missing = userIds.filter(uid => !targetsById.has(uid));
    if (missing.length > 0) {
      res.status(404).json({ error: "Usuário(s) não encontrado(s)", missing });
      return;
    }

    const invalidRole = targets.filter(t => !(t.role === "ADMIN" || t.role === "ANALYST" || t.role === "COORDINATOR"));
    if (invalidRole.length > 0) {
      res.status(400).json({ error: "Apenas Admin, Analista e Coordenador podem ser colaboradores" });
      return;
    }

    const inactive = targets.filter(t => t.status !== "ACTIVE");
    if (inactive.length > 0) {
      res.status(400).json({ error: "O colaborador precisa estar ativo" });
      return;
    }

    const existingRows = await db
      .select({ userId: ticketCollaboratorsTable.userId })
      .from(ticketCollaboratorsTable)
      .where(and(eq(ticketCollaboratorsTable.ticketId, id), inArray(ticketCollaboratorsTable.userId, userIds)));
    if (existingRows.length > 0) {
      res.status(409).json({ error: "Um ou mais usuários já são colaboradores deste chamado", duplicates: existingRows.map(r => r.userId) });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.insert(ticketCollaboratorsTable).values(
        userIds.map(uid => ({
          ticketId: id,
          userId: uid,
          addedByUserId: actor.userId,
        })),
      );

      await tx.insert(ticketAuditLogsTable).values(
        userIds.map(uid => ({
          ticketId: id,
          actorUserId: actor.userId,
          type: "COLLABORATOR_ADDED" as const,
          detail: JSON.stringify({ collaboratorUserId: uid }),
        })),
      );
    });

    logger.info({ ticketId: id, actorUserId: actor.userId, collaboratorUserIds: userIds }, "Colaboradores adicionados ao chamado");

    const rows = await db
      .select(userRefSelect)
      .from(ticketCollaboratorsTable)
      .innerJoin(usersTable, eq(usersTable.id, ticketCollaboratorsTable.userId))
      .where(eq(ticketCollaboratorsTable.ticketId, id))
      .orderBy(asc(usersTable.name));

    res.json(rows);
  },
);

router.delete(
  "/tickets/:id/collaborators/:userId",
  requireAuth,
  requireActive,
  requireRoles("ADMIN", "ANALYST", "COORDINATOR"),
  async (req, res): Promise<void> => {
    const actor = req.user!;
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const rawUserId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const id = parseInt(rawId, 10);
    const targetUserId = parseInt(rawUserId, 10);

    if (isNaN(id) || isNaN(targetUserId)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, id));
    if (!ticket) {
      res.status(404).json({ error: "Chamado não encontrado" });
      return;
    }

    if (!(await enforceTicketAccess(actor, ticket, "tickets:collaborators"))) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }

    const [existing] = await db
      .select({ userId: ticketCollaboratorsTable.userId })
      .from(ticketCollaboratorsTable)
      .where(and(eq(ticketCollaboratorsTable.ticketId, id), eq(ticketCollaboratorsTable.userId, targetUserId)));
    if (!existing) {
      res.status(404).json({ error: "Colaborador não encontrado no chamado" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(ticketCollaboratorsTable)
        .where(and(eq(ticketCollaboratorsTable.ticketId, id), eq(ticketCollaboratorsTable.userId, targetUserId)));

      await tx.insert(ticketAuditLogsTable).values({
        ticketId: id,
        actorUserId: actor.userId,
        type: "COLLABORATOR_REMOVED",
        detail: JSON.stringify({ collaboratorUserId: targetUserId }),
      });
    });

    logger.info({ ticketId: id, actorUserId: actor.userId, collaboratorUserId: targetUserId }, "Colaborador removido do chamado");

    res.json({ ok: true });
  },
);

router.patch("/tickets/:id", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [existing] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Chamado não encontrado" });
    return;
  }

  if (!(await enforceTicketAccess(user, existing, "tickets:update"))) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const parsed = UpdateTicketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const requestedStatus = parsed.data.status;
  const isReopenAction =
    typeof requestedStatus === "string"
    && existing.status === "CLOSED"
    && requestedStatus !== "CLOSED";

  const awaitingCustomerMessage = "Estamos aguardando seu retorno para dar continuidade ao atendimento. Caso não haja resposta ou interação dentro do período previsto, o chamado poderá ser encerrado automaticamente como 'Cancelado'.";

  if (isReopenAction) {
    const allowed = canReopenClosedTicket({
      role: user.role,
      closedAt: existing.updatedAt,
    });
    if (!allowed) {
      res.status(403).json({
        error: `Reabertura permitida apenas para Admin e Analista em até ${REOPEN_WINDOW_HOURS}h após o cancelamento.`,
      });
      return;
    }
  }

  if (typeof requestedStatus === "string" && requiresStaffAssigneeForStatus(requestedStatus)) {
    if (!existing.assignedToId) {
      res.status(400).json({ error: "Para alterar o status, é obrigatório atribuir previamente um responsável (Admin, Coordenador ou Analista)." });
      return;
    }
    const [assignee] = await db
      .select({ role: usersTable.role, status: usersTable.status })
      .from(usersTable)
      .where(eq(usersTable.id, existing.assignedToId));
    if (!assignee || !canReceiveReassign(assignee.role, assignee.status)) {
      res.status(400).json({ error: "Para alterar o status, é obrigatório atribuir previamente um responsável (Admin, Coordenador ou Analista)." });
      return;
    }
  }

  if (requestedStatus === "RESOLVED" && existing.status !== "RESOLVED") {
    res.status(400).json({ error: "Para marcar como Resolvido, envie uma mensagem de solução." });
    return;
  }

  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  if (parsed.data.status && parsed.data.status !== existing.status) {
    changes.push({ field: "status", from: existing.status, to: parsed.data.status });
  }
  if (parsed.data.priority && parsed.data.priority !== existing.priority) {
    changes.push({ field: "priority", from: existing.priority, to: parsed.data.priority });
  }
  if (typeof parsed.data.title === "string" && parsed.data.title !== existing.title) {
    changes.push({ field: "title", from: existing.title, to: parsed.data.title });
  }
  if (typeof parsed.data.description === "string" && parsed.data.description !== existing.description) {
    changes.push({ field: "description", from: "(texto)", to: "(texto)" });
  }
  const detail = changes.map(c => formatChange(c.field, c.from, c.to)).join("\n");

  const shouldNotifyAwaitingCustomer =
    requestedStatus === "AWAITING_CUSTOMER"
    && existing.status !== "AWAITING_CUSTOMER";

  const [ticket] = shouldNotifyAwaitingCustomer
    ? await db.transaction(async (tx) => {
      const [updated] = await tx.update(ticketsTable)
        .set(parsed.data)
        .where(eq(ticketsTable.id, id))
        .returning();

      const preview = awaitingCustomerMessage.trim().slice(0, 140);
      const [msg] = await tx.insert(messagesTable).values({
        ticketId: id,
        senderId: user.userId,
        message: awaitingCustomerMessage,
      }).returning();

      if (detail) {
        await tx.insert(ticketAuditLogsTable).values({
          ticketId: id,
          actorUserId: user.userId,
          type: "TICKET_UPDATED",
          detail,
        });
      }

      if (msg) {
        await tx.insert(ticketAuditLogsTable).values({
          ticketId: id,
          actorUserId: user.userId,
          type: "MESSAGE_SENT",
          messageId: msg.id,
          detail: preview,
        });
      }

      return [updated];
    })
    : await db.update(ticketsTable)
      .set(parsed.data)
      .where(eq(ticketsTable.id, id))
      .returning();

  if (!shouldNotifyAwaitingCustomer) {
    await auditTicketUpdate({ ticketId: id, actorUserId: user.userId, changes });
  }

  const [createdBy] = await db.select().from(usersTable).where(eq(usersTable.id, ticket.createdById));
  const assignedTo = ticket.assignedToId
    ? (await db.select().from(usersTable).where(eq(usersTable.id, ticket.assignedToId)))[0]
    : null;

  res.json({
    ...ticket,
    createdBy: createdBy ? {
      id: createdBy.id,
      name: createdBy.name,
      email: createdBy.email,
      role: createdBy.role,
    } : null,
    assignedTo: assignedTo ? {
      id: assignedTo.id,
      name: assignedTo.name,
      email: assignedTo.email,
      role: assignedTo.role,
    } : null,
  });
});

router.post("/tickets/:id/resolve", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const body = (req.body ?? {}) as { message?: unknown };
  const solutionMessage = typeof body.message === "string" ? body.message.trim() : "";
  if (solutionMessage.length === 0) {
    res.status(400).json({ error: "Mensagem obrigatória para resolver o chamado." });
    return;
  }
  if (solutionMessage.length > 2000) {
    res.status(400).json({ error: "Mensagem muito longa (máx. 2000 caracteres)." });
    return;
  }

  const [existing] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Chamado não encontrado" });
    return;
  }

  if (existing.status === "CLOSED") {
    res.status(400).json({ error: "Tickets cancelados não podem ser marcados como resolvidos" });
    return;
  }

  if (!(await enforceTicketAccess(user, existing, "tickets:update"))) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  if (!existing.assignedToId) {
    res.status(400).json({ error: "Para alterar o status, é obrigatório atribuir previamente um responsável (Admin, Coordenador ou Analista)." });
    return;
  }
  const [assignee] = await db
    .select({ role: usersTable.role, status: usersTable.status })
    .from(usersTable)
    .where(eq(usersTable.id, existing.assignedToId));
  if (!assignee || !canReceiveReassign(assignee.role, assignee.status)) {
    res.status(400).json({ error: "Para alterar o status, é obrigatório atribuir previamente um responsável (Admin, Coordenador ou Analista)." });
    return;
  }

  const [ticket] = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(ticketsTable)
      .set({ status: "RESOLVED" })
      .where(eq(ticketsTable.id, id))
      .returning();

    const preview = solutionMessage.trim().slice(0, 140);
    const [msg] = await tx.insert(messagesTable).values({
      ticketId: id,
      senderId: user.userId,
      message: solutionMessage,
    }).returning();

    await tx.insert(ticketAuditLogsTable).values({
      ticketId: id,
      actorUserId: user.userId,
      type: "TICKET_UPDATED",
      detail: formatChange("status", existing.status, "RESOLVED"),
    });

    if (msg) {
      await tx.insert(ticketAuditLogsTable).values({
        ticketId: id,
        actorUserId: user.userId,
        type: "MESSAGE_SENT",
        messageId: msg.id,
        detail: preview,
      });
    }

    return [updated];
  });

  if (!ticket) {
    res.status(404).json({ error: "Chamado não encontrado" });
    return;
  }

  const [createdBy] = await db.select().from(usersTable).where(eq(usersTable.id, ticket.createdById));
  const assignedTo = ticket.assignedToId
    ? (await db.select().from(usersTable).where(eq(usersTable.id, ticket.assignedToId)))[0]
    : null;

  res.json({
    ...ticket,
    createdBy: createdBy ? {
      id: createdBy.id,
      name: createdBy.name,
      email: createdBy.email,
      role: createdBy.role,
    } : null,
    assignedTo: assignedTo ? {
      id: assignedTo.id,
      name: assignedTo.name,
      email: assignedTo.email,
      role: assignedTo.role,
    } : null,
  });
});

router.patch("/tickets/:id/details", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [existing] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Chamado não encontrado" });
    return;
  }

  if (!(await enforceTicketAccess(user, existing, "tickets:update"))) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const type = body.type != null ? parseTicketType(body.type) : null;
  const priority = body.priority != null ? parseTicketPriority(body.priority) : null;
  const hardwareSubtype = body.hardwareSubtype != null ? normalizeText(body.hardwareSubtype) : null;
  const establishment = body.establishment != null ? normalizeText(body.establishment) : null;
  const uf = body.uf != null ? normalizeText(body.uf)?.toUpperCase() ?? null : null;
  const municipality = body.municipality != null ? normalizeText(body.municipality) : null;
  const dueAtRaw = body.dueAt;
  const dueAt =
    dueAtRaw == null
      ? null
      : typeof dueAtRaw === "string"
        ? (dueAtRaw.trim() === "" ? null : new Date(dueAtRaw))
        : dueAtRaw instanceof Date
          ? dueAtRaw
          : null;

  if (body.type != null && !type) {
    res.status(400).json({ error: "Tipo inválido" });
    return;
  }
  if (body.priority != null && !priority) {
    res.status(400).json({ error: "Prioridade inválida" });
    return;
  }
  const dueAtTypeOk = dueAtRaw == null || typeof dueAtRaw === "string" || dueAtRaw instanceof Date;
  if (!dueAtTypeOk) {
    res.status(400).json({ error: "Prazo inválido" });
    return;
  }
  if (typeof dueAtRaw === "string" && dueAtRaw.trim() !== "" && dueAt instanceof Date && !Number.isFinite(dueAt.getTime())) {
    res.status(400).json({ error: "Prazo inválido" });
    return;
  }
  if ((body.uf != null || body.municipality != null)) {
    const nextUf = uf ?? existing.uf;
    const nextMunicipality = municipality ?? existing.municipality;
    const ok = await validateMunicipalityForUf(nextUf, nextMunicipality);
    if (!ok) {
      res.status(400).json({ error: "Município inválido para a UF selecionada" });
      return;
    }
  }

  const patch: Record<string, unknown> = {};
  if (type) patch.type = type;
  if (priority) patch.priority = priority;
  if (body.hardwareSubtype != null) patch.hardwareSubtype = hardwareSubtype;
  if (body.establishment != null) patch.establishment = establishment;
  if (uf) patch.uf = uf;
  if (municipality) patch.municipality = municipality;
  if (dueAtRaw != null) patch.dueAt = dueAt;

  const [ticket] = await db.update(ticketsTable)
    .set(patch)
    .where(eq(ticketsTable.id, id))
    .returning();

  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  if (type && type !== existing.type) changes.push({ field: "type", from: existing.type, to: type });
  if (priority && priority !== existing.priority) changes.push({ field: "priority", from: existing.priority, to: priority });
  if (body.hardwareSubtype != null && hardwareSubtype !== (existing.hardwareSubtype ?? null)) {
    changes.push({ field: "hardwareSubtype", from: existing.hardwareSubtype ?? null, to: hardwareSubtype });
  }
  if (body.establishment != null && establishment !== (existing.establishment ?? null)) {
    changes.push({ field: "establishment", from: existing.establishment ?? null, to: establishment });
  }
  if (uf && uf !== existing.uf) changes.push({ field: "uf", from: existing.uf, to: uf });
  if (municipality && municipality !== existing.municipality) changes.push({ field: "municipality", from: existing.municipality, to: municipality });
  if (dueAtRaw != null && (dueAt?.toISOString?.() ?? null) !== ((existing as any).dueAt?.toISOString?.() ?? null)) {
    changes.push({ field: "dueAt", from: (existing as any).dueAt ?? null, to: dueAt });
  }
  await auditTicketUpdate({ ticketId: id, actorUserId: user.userId, changes });

  const [createdBy] = await db.select().from(usersTable).where(eq(usersTable.id, ticket.createdById));
  const assignedTo = ticket.assignedToId
    ? (await db.select().from(usersTable).where(eq(usersTable.id, ticket.assignedToId)))[0]
    : null;

  res.json({
    ...ticket,
    createdBy: createdBy ? {
      id: createdBy.id,
      name: createdBy.name,
      email: createdBy.email,
      role: createdBy.role,
    } : null,
    assignedTo: assignedTo ? {
      id: assignedTo.id,
      name: assignedTo.name,
      email: assignedTo.email,
      role: assignedTo.role,
    } : null,
  });
});

router.post("/tickets/:id/assign", requireAuth, requireActive, requireRoles("ANALYST", "ADMIN", "COORDINATOR"), async (req, res): Promise<void> => {
  const user = req.user!;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const parsed = AssignTicketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Chamado não encontrado" });
    return;
  }
  if (!(await enforceTicketAccess(user, existing, "tickets:assign"))) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  if (existing.status === "CLOSED") {
    res.status(400).json({ error: "Tickets cancelados não podem ser reatribuídos" });
    return;
  }

  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, parsed.data.assignedToId));
  if (!targetUser) {
    res.status(404).json({ error: "Responsável de destino não encontrado" });
    return;
  }
  if (targetUser.status !== "ACTIVE") {
    res.status(400).json({ error: "O novo responsável precisa estar ativo" });
    return;
  }
  if (!canReceiveReassign(targetUser.role, targetUser.status)) {
    res.status(400).json({ error: "Somente Admin, Coordenador e Analista podem receber reatribuição" });
    return;
  }

  const previousAssignedToId = existing.assignedToId ?? null;

  const isSelfAssign = parsed.data.assignedToId === user.userId && previousAssignedToId !== user.userId;
  const auditType = isSelfAssign && previousAssignedToId == null ? "AUTO_ASSIGN" : "MANUAL_ASSIGN";

  const [ticket] = await db.update(ticketsTable)
    .set({ assignedToId: parsed.data.assignedToId, status: "IN_PROGRESS" })
    .where(eq(ticketsTable.id, id))
    .returning();

  if (!ticket) {
    res.status(404).json({ error: "Chamado não encontrado" });
    return;
  }

  const [createdBy] = await db.select().from(usersTable).where(eq(usersTable.id, ticket.createdById));
  const assignedTo = ticket.assignedToId
    ? (await db.select().from(usersTable).where(eq(usersTable.id, ticket.assignedToId)))[0]
    : null;

  await db.insert(ticketAuditLogsTable).values({
    ticketId: id,
    actorUserId: user.userId,
    type: auditType,
    fromAssignedToId: previousAssignedToId,
    toAssignedToId: ticket.assignedToId ?? null,
    detail: parsed.data.reason,
  });

  const notificationMessage = isSelfAssign
    ? `usuário ${targetUser.name} atribuiu-se ao seu chamado, aguarde...`
    : `[NOTIFICAÇÃO] Ticket reatribuído para ${targetUser.name}. Motivo: ${parsed.data.reason}`;

  const preview = notificationMessage.trim().slice(0, 140);
  const [msg] = await db.insert(messagesTable).values({
    ticketId: id,
    senderId: user.userId,
    message: notificationMessage,
  }).returning();

  if (msg) {
    await db.insert(ticketAuditLogsTable).values({
      ticketId: id,
      actorUserId: user.userId,
      type: "MESSAGE_SENT",
      messageId: msg.id,
      detail: preview,
    });
  }

  res.json({
    ...ticket,
    createdBy: createdBy ? {
      id: createdBy.id,
      name: createdBy.name,
      email: createdBy.email,
      role: createdBy.role,
    } : null,
    assignedTo: assignedTo ? {
      id: assignedTo.id,
      name: assignedTo.name,
      email: assignedTo.email,
      role: assignedTo.role,
    } : null,
  });
});

export default router;
