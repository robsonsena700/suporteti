import { Router, type IRouter } from "express";
import { db, chatAttachmentsTable, chatMessagesTable, usersTable } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
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

  const messageIds = messages.map((m) => m.id);
  const attachments = messageIds.length
    ? await db
      .select({
        id: chatAttachmentsTable.id,
        chatMessageId: chatAttachmentsTable.chatMessageId,
        filename: chatAttachmentsTable.filename,
        mimeType: chatAttachmentsTable.mimeType,
        size: chatAttachmentsTable.size,
        uploaderId: chatAttachmentsTable.uploaderId,
        createdAt: chatAttachmentsTable.createdAt,
      })
      .from(chatAttachmentsTable)
      .where(inArray(chatAttachmentsTable.chatMessageId, messageIds))
    : [];

  const attachmentsByMessageId = new Map<number, typeof attachments>();
  for (const a of attachments) {
    const mid = a.chatMessageId!;
    const list = attachmentsByMessageId.get(mid) ?? [];
    list.push(a);
    attachmentsByMessageId.set(mid, list);
  }

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
      attachments: (attachmentsByMessageId.get(m.id) ?? []).map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        uploaderId: a.uploaderId,
        createdAt: a.createdAt,
      })),
    }))
  );
});

router.post("/chat/messages", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const user = req.user!;
  const { message, attachmentIds } = req.body as { message?: unknown; attachmentIds?: unknown };
  const ids = Array.isArray(attachmentIds) ? attachmentIds.map((v) => Number(v)).filter((v) => Number.isInteger(v)) : [];

  const text = typeof message === "string" ? message.trim() : "";
  if (!text && ids.length === 0) {
    res.status(400).json({ error: "Mensagem invalida." });
    return;
  }
  if (text && text.length > 2000) {
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
    .values({ senderId: user.userId, message: text })
    .returning();

  const linked = ids.length
    ? await db.update(chatAttachmentsTable)
      .set({ chatMessageId: msg.id })
      .where(and(
        inArray(chatAttachmentsTable.id, ids),
        eq(chatAttachmentsTable.uploaderId, user.userId),
        eq(chatAttachmentsTable.scope, "GROUP"),
        isNull(chatAttachmentsTable.chatMessageId),
        isNull(chatAttachmentsTable.directMessageId),
      ))
      .returning({
        id: chatAttachmentsTable.id,
        filename: chatAttachmentsTable.filename,
        mimeType: chatAttachmentsTable.mimeType,
        size: chatAttachmentsTable.size,
        uploaderId: chatAttachmentsTable.uploaderId,
        createdAt: chatAttachmentsTable.createdAt,
      })
    : [];

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
    attachments: linked,
  });
});

export default router;
