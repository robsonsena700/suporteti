import { Router, type IRouter } from "express";
import { db, usersTable, ticketsTable, ticketAttachmentsTable, ticketAuditLogsTable, messagesTable } from "@workspace/db";
import { eq, and, desc, inArray, or } from "drizzle-orm";
import { CreateTicketBody, UpdateTicketBody, AssignTicketBody } from "@workspace/api-zod";
import { requireAuth, requireActive, requireRoles } from "../middlewares/auth";
import { enforceTicketAccess, getManagedUserIdsByCoordinator } from "../lib/access";
import { canReopenClosedTicket, REOPEN_WINDOW_HOURS } from "../lib/ticket-reopen-policy";
import { canReceiveReassign } from "../lib/ticket-reassign-policy";

const router: IRouter = Router();

const userRefSelect = {
  id: usersTable.id,
  name: usersTable.name,
  email: usersTable.email,
  role: usersTable.role,
};

router.get("/tickets", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const { status, type, priority, uf, municipality } = req.query as Record<string, string | undefined>;

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

  const baseWhere = whereClauses.length > 0 ? and(...whereClauses) : undefined;
  const allTickets = await db.query.ticketsTable.findMany({
    where: baseWhere,
    with: {
      createdBy: true,
      assignedTo: true,
      attachments: {
        columns: { id: true, mimeType: true },
      },
    },
    orderBy: [desc(ticketsTable.createdAt)],
  });

  let filtered = allTickets;

  if (status) filtered = filtered.filter(t => t.status === status);
  if (type) filtered = filtered.filter(t => t.type === type);
  if (priority) filtered = filtered.filter(t => t.priority === priority);
  if (uf) filtered = filtered.filter(t => t.uf === uf);
  if (municipality) filtered = filtered.filter(t => t.municipality === municipality);

  const result = filtered.map(t => ({
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
