import { Router, type IRouter } from "express";
import { db, chatMessagesTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth, requireActive } from "../middlewares/auth";
import {
  auditChatDenied,
  enforceChatModuleAccess,
  getVisibleParticipantIds,
  getVisibleParticipants,
} from "../lib/chat-access";

const router: IRouter = Router();

function requireChatAccess(req: any, res: any, next: any) {
  const user = req.user;
  if (!user || !enforceChatModuleAccess(user, "chat:module")) {
    res.status(403).json({ error: "Acesso restrito a Administradores, Coordenadores e Analistas." });
    return;
  }
  next();
}

router.get("/chat/participants", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const user = req.user!;
  const participants = await getVisibleParticipants(user);
  res.json(participants);
});

router.get("/chat/messages", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const user = req.user!;
  const rawLimit = req.query.limit as string | undefined;
  const limit = Math.min(parseInt(rawLimit || "100", 10) || 100, 200);
  const visibleIds = await getVisibleParticipantIds(user);

  const messages = await db.query.chatMessagesTable.findMany({
    where: visibleIds.length > 0 ? inArray(chatMessagesTable.senderId, visibleIds) : eq(chatMessagesTable.id, -1),
    with: { sender: true },
    orderBy: (m, { asc }) => [asc(m.createdAt)],
    limit,
  });

  res.json(
    messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      message: m.message,
      createdAt: m.createdAt,
      sender: {
        id: m.sender.id,
        name: m.sender.name,
        role: m.sender.role,
      },
    }))
  );
});

router.post("/chat/messages", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const user = req.user!;
  const { message } = req.body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "Mensagem invalida." });
    return;
  }

  if (message.length > 2000) {
    res.status(400).json({ error: "Mensagem muito longa (max 2000 caracteres)." });
    return;
  }

  const visibleIds = await getVisibleParticipantIds(user);
  if (!visibleIds.includes(user.userId)) {
    auditChatDenied(user, "chat:group:create", { reason: "sender_not_in_scope" });
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const [msg] = await db
    .insert(chatMessagesTable)
    .values({ senderId: user.userId, message: message.trim() })
    .returning();

  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, user.userId));

  res.status(201).json({
    id: msg.id,
    senderId: msg.senderId,
    message: msg.message,
    createdAt: msg.createdAt,
    sender: {
      id: sender.id,
      name: sender.name,
      role: sender.role,
    },
  });
});

export default router;
