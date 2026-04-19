import { Router, type IRouter } from "express";
import { db, messagesTable, ticketsTable, usersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { CreateMessageBody } from "@workspace/api-zod";
import { requireAuth, requireActive } from "../middlewares/auth";
import { enforceTicketAccess } from "../lib/access";
import { autoAssignTicketOnMessageInteraction } from "../lib/ticket-auto-assign";

const router: IRouter = Router();

router.get("/tickets/:ticketId/messages", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const raw = Array.isArray(req.params.ticketId) ? req.params.ticketId[0] : req.params.ticketId;
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
  if (!(await enforceTicketAccess(user, ticket, "messages:list"))) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const messages = await db.query.messagesTable.findMany({
    where: eq(messagesTable.ticketId, ticketId),
    with: { sender: true },
    orderBy: (m, { asc }) => [asc(m.createdAt)],
  });

  res.json(messages.map(m => ({
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
  })));
});

router.post("/tickets/:ticketId/messages", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const raw = Array.isArray(req.params.ticketId) ? req.params.ticketId[0] : req.params.ticketId;
  const ticketId = parseInt(raw, 10);

  if (isNaN(ticketId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const parsed = CreateMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId));
  if (!ticket) {
    res.status(404).json({ error: "Chamado não encontrado" });
    return;
  }
  if (!(await enforceTicketAccess(user, ticket, "messages:create"))) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const preview = parsed.data.message.trim().slice(0, 140);
  const [msg] = await db.insert(messagesTable).values({
    ticketId,
    senderId: user.userId,
    message: parsed.data.message,
  }).returning();

  await autoAssignTicketOnMessageInteraction({
    actor: user,
    ticketId,
    messageId: msg.id,
    messagePreview: preview,
  });

  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, user.userId));

  res.status(201).json({
    id: msg.id,
    ticketId: msg.ticketId,
    senderId: msg.senderId,
    message: msg.message,
    createdAt: msg.createdAt,
    sender: {
      id: sender.id,
      name: sender.name,
      email: sender.email,
      role: sender.role,
    },
  });
});

export default router;
