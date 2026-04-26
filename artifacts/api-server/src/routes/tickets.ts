import { Router, type IRouter } from "express";
import { db, usersTable, ticketsTable, ticketAttachmentsTable, ticketAuditLogsTable, messagesTable } from "@workspace/db";
import { eq, and, desc, inArray, or } from "drizzle-orm";
import { CreateTicketBody, UpdateTicketBody, AssignTicketBody } from "@workspace/api-zod";
import { requireAuth, requireActive, requireRoles } from "../middlewares/auth";
import { enforceTicketAccess, getManagedUserIdsByCoordinator } from "../lib/access";
import { canReopenClosedTicket, REOPEN_WINDOW_HOURS } from "../lib/ticket-reopen-policy";
import { canReceiveReassign } from "../lib/ticket-reassign-policy";
import { validateMunicipalityForUf } from "../lib/ibge";

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

function parseTicketStatus(value: unknown): "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" | null {
  if (value === "OPEN" || value === "IN_PROGRESS" || value === "RESOLVED" || value === "CLOSED") return value;
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
  const { status, type, priority, uf, municipality, mine } = req.query as Record<string, string | undefined>;

  const whereClauses = [];
  if (user.role !== "ADMIN" && user.role !== "ANALYST") {
    if (user.role === "COORDINATOR") {
      const managedUserIds = await getManagedUserIdsByCoordinator(user.userId);
      const allowedOwners = [user.userId, ...managedUserIds];
      whereClauses.push(
        or(
          inArray(ticketsTable.createdById, allowedOwners),
          eq(ticketsTable.assignedToId, user.userId),
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

  const parsedStatus = status != null ? parseTicketStatus(status) : null;
  if (status != null && !parsedStatus) {
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
  if (parsedStatus) dbWhereClauses.push(eq(ticketsTable.status, parsedStatus));
  if (parsedType) dbWhereClauses.push(eq(ticketsTable.type, parsedType));
  if (parsedPriority) dbWhereClauses.push(eq(ticketsTable.priority, parsedPriority));
  if (parsedUf) dbWhereClauses.push(eq(ticketsTable.uf, parsedUf));
  if (parsedMunicipality) dbWhereClauses.push(eq(ticketsTable.municipality, parsedMunicipality));

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

router.get("/tickets/resolved", requireAuth, requireActive, requireRoles("ADMIN", "ANALYST", "COORDINATOR"), async (req, res): Promise<void> => {
  const user = req.user!;
  const { status, type, priority, uf, municipality, mine } = req.query as Record<string, string | undefined>;

  const whereClauses = [];
  if (user.role !== "ADMIN" && user.role !== "ANALYST") {
    if (user.role === "COORDINATOR") {
      const managedUserIds = await getManagedUserIdsByCoordinator(user.userId);
      const allowedOwners = [user.userId, ...managedUserIds];
      whereClauses.push(
        or(
          inArray(ticketsTable.createdById, allowedOwners),
          eq(ticketsTable.assignedToId, user.userId),
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
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
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
    rating: ticket.rating ?? null,
    attachments: ticket.attachments.map(a => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      createdAt: a.createdAt,
    })),
  });
});

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

  if (isReopenAction) {
    const allowed = canReopenClosedTicket({
      role: user.role,
      closedAt: existing.updatedAt,
    });
    if (!allowed) {
      res.status(403).json({
        error: `Reabertura permitida apenas para Admin e Analista em até ${REOPEN_WINDOW_HOURS}h após o fechamento.`,
      });
      return;
    }
  }

  const [ticket] = await db.update(ticketsTable)
    .set(parsed.data)
    .where(eq(ticketsTable.id, id))
    .returning();

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

  if (body.type != null && !type) {
    res.status(400).json({ error: "Tipo inválido" });
    return;
  }
  if (body.priority != null && !priority) {
    res.status(400).json({ error: "Prioridade inválida" });
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
    res.status(400).json({ error: "Tickets fechados não podem ser reatribuídos" });
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
    type: "MANUAL_ASSIGN",
    fromAssignedToId: previousAssignedToId,
    toAssignedToId: ticket.assignedToId ?? null,
    detail: parsed.data.reason,
  });

  await db.insert(messagesTable).values({
    ticketId: id,
    senderId: user.userId,
    message: `[NOTIFICAÇÃO] Ticket reatribuído para ${targetUser.name}. Motivo: ${parsed.data.reason}`,
  });

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
