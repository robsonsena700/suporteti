import { Router, type IRouter } from "express";
import { db, directMessagesTable, usersTable } from "@workspace/db";
import { eq, or, and, asc } from "drizzle-orm";
import { requireAuth, requireActive } from "../middlewares/auth";

const router: IRouter = Router();

const ALLOWED_ROLES = ["ADMIN", "COORDINATOR", "ANALYST"];

function requireChatAccess(req: any, res: any, next: any) {
  const role = req.user?.role;
  if (!ALLOWED_ROLES.includes(role)) {
    res.status(403).json({ error: "Acesso restrito a Administradores, Coordenadores e Analistas." });
    return;
  }
  next();
}

// GET /api/chat/dm/:userId — fetch conversation between logged-in user and :userId
router.get("/chat/dm/:userId", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const me = req.user!.userId;
  const rawOther = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const other = parseInt(rawOther, 10);

  if (isNaN(other) || other === me) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  const messages = await db.query.directMessagesTable.findMany({
    where: or(
      and(eq(directMessagesTable.senderId, me), eq(directMessagesTable.receiverId, other)),
      and(eq(directMessagesTable.senderId, other), eq(directMessagesTable.receiverId, me))
    ),
    with: { sender: true, receiver: true },
    orderBy: [asc(directMessagesTable.createdAt)],
  });

  res.json(
    messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      receiverId: m.receiverId,
      message: m.message,
      createdAt: m.createdAt,
      sender: { id: m.sender.id, name: m.sender.name, role: m.sender.role },
      receiver: { id: m.receiver.id, name: m.receiver.name, role: m.receiver.role },
    }))
  );
});

// POST /api/chat/dm/:userId — send a DM to :userId
router.post("/chat/dm/:userId", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const me = req.user!.userId;
  const rawOther = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const other = parseInt(rawOther, 10);

  if (isNaN(other) || other === me) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  const { message } = req.body;
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "Mensagem inválida." });
    return;
  }
  if (message.length > 2000) {
    res.status(400).json({ error: "Mensagem muito longa (max 2000 caracteres)." });
    return;
  }

  // Verify receiver exists and has access
  const [receiver] = await db.select().from(usersTable).where(eq(usersTable.id, other));
  if (!receiver || !ALLOWED_ROLES.includes(receiver.role)) {
    res.status(404).json({ error: "Usuário não encontrado." });
    return;
  }

  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, me));

  const [msg] = await db
    .insert(directMessagesTable)
    .values({ senderId: me, receiverId: other, message: message.trim() })
    .returning();

  res.status(201).json({
    id: msg.id,
    senderId: msg.senderId,
    receiverId: msg.receiverId,
    message: msg.message,
    createdAt: msg.createdAt,
    sender: { id: sender.id, name: sender.name, role: sender.role },
    receiver: { id: receiver.id, name: receiver.name, role: receiver.role },
  });
});

// GET /api/chat/dm-inbox — get last DM per conversation partner (for preview in sidebar)
router.get("/chat/dm-inbox", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const me = req.user!.userId;

  const allDMs = await db.query.directMessagesTable.findMany({
    where: or(
      eq(directMessagesTable.senderId, me),
      eq(directMessagesTable.receiverId, me)
    ),
    with: { sender: true, receiver: true },
    orderBy: [asc(directMessagesTable.createdAt)],
  });

  // Build map of partnerId -> last message
  const byPartner = new Map<number, (typeof allDMs)[number]>();
  for (const m of allDMs) {
    const partnerId = m.senderId === me ? m.receiverId : m.senderId;
    byPartner.set(partnerId, m);
  }

  const result = Array.from(byPartner.entries()).map(([partnerId, m]) => {
    const partner = m.senderId === me ? m.receiver : m.sender;
    return {
      partnerId,
      partnerName: partner.name,
      partnerRole: partner.role,
      lastMessage: m.message,
      lastMessageAt: m.createdAt,
      lastMessageId: m.id,
      fromMe: m.senderId === me,
    };
  });

  res.json(result);
});

export default router;
