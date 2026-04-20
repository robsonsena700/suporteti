import { Router, type IRouter } from "express";
import { db, chatAttachmentsTable, directMessagesTable, usersTable } from "@workspace/db";
import { eq, or, and, asc, inArray, isNull } from "drizzle-orm";
import { requireAuth, requireActive } from "../middlewares/auth";
import {
  auditChatDenied,
  canInteractWithChatUser,
  enforceChatModuleAccess,
  getVisibleParticipantIds,
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

// GET /api/chat/dm/:userId — fetch conversation between logged-in user and :userId
router.get("/chat/dm/:userId", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const me = req.user!.userId;
  const rawOther = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const other = parseInt(rawOther, 10);

  if (isNaN(other) || other === me) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  const canAccess = await canInteractWithChatUser(req.user!, other);
  if (!canAccess) {
    auditChatDenied(req.user!, "chat:dm:get", { targetUserId: other });
    res.status(403).json({ error: "Acesso negado." });
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

  const messageIds = messages.map((m) => m.id);
  const attachments = messageIds.length
    ? await db
      .select({
        id: chatAttachmentsTable.id,
        directMessageId: chatAttachmentsTable.directMessageId,
        filename: chatAttachmentsTable.filename,
        mimeType: chatAttachmentsTable.mimeType,
        size: chatAttachmentsTable.size,
        uploaderId: chatAttachmentsTable.uploaderId,
        createdAt: chatAttachmentsTable.createdAt,
      })
      .from(chatAttachmentsTable)
      .where(inArray(chatAttachmentsTable.directMessageId, messageIds))
    : [];

  const attachmentsByMessageId = new Map<number, typeof attachments>();
  for (const a of attachments) {
    const mid = a.directMessageId!;
    const list = attachmentsByMessageId.get(mid) ?? [];
    list.push(a);
    attachmentsByMessageId.set(mid, list);
  }

  res.json(
    messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      receiverId: m.receiverId,
      message: m.message,
      createdAt: m.createdAt,
      sender: { id: m.sender.id, name: m.sender.name, role: m.sender.role },
      receiver: { id: m.receiver.id, name: m.receiver.name, role: m.receiver.role },
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

// POST /api/chat/dm/:userId — send a DM to :userId
router.post("/chat/dm/:userId", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const me = req.user!.userId;
  const rawOther = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const other = parseInt(rawOther, 10);

  if (isNaN(other) || other === me) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  const { message, attachmentIds } = req.body as { message?: unknown; attachmentIds?: unknown };
  const ids = Array.isArray(attachmentIds) ? attachmentIds.map((v) => Number(v)).filter((v) => Number.isInteger(v)) : [];
  const text = typeof message === "string" ? message.trim() : "";
  if (!text && ids.length === 0) {
    res.status(400).json({ error: "Mensagem inválida." });
    return;
  }
  if (text && text.length > 2000) {
    res.status(400).json({ error: "Mensagem muito longa (max 2000 caracteres)." });
    return;
  }

  const canInteract = await canInteractWithChatUser(req.user!, other);
  if (!canInteract) {
    auditChatDenied(req.user!, "chat:dm:create", { targetUserId: other });
    res.status(403).json({ error: "Acesso negado." });
    return;
  }

  const [receiver] = await db.select().from(usersTable).where(eq(usersTable.id, other));
  if (!receiver) {
    res.status(404).json({ error: "Usuário não encontrado." });
    return;
  }

  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, me));

  const [msg] = await db
    .insert(directMessagesTable)
    .values({ senderId: me, receiverId: other, message: text })
    .returning();

  res.status(201).json({
    id: msg.id,
    senderId: msg.senderId,
    receiverId: msg.receiverId,
    message: msg.message,
    createdAt: msg.createdAt,
    sender: { id: sender.id, name: sender.name, role: sender.role },
    receiver: { id: receiver.id, name: receiver.name, role: receiver.role },
    attachments: ids.length
      ? await db.update(chatAttachmentsTable)
        .set({ directMessageId: msg.id })
        .where(and(
          inArray(chatAttachmentsTable.id, ids),
          eq(chatAttachmentsTable.uploaderId, me),
          eq(chatAttachmentsTable.scope, "DM"),
          eq(chatAttachmentsTable.dmReceiverId, other),
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
      : [],
  });
});

// GET /api/chat/dm-inbox — get last DM per conversation partner (for preview in sidebar)
router.get("/chat/dm-inbox", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const me = req.user!.userId;
  const visibleIds = await getVisibleParticipantIds(req.user!);

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
    if (!visibleIds.includes(partnerId)) continue;
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
