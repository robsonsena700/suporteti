import { Router, type IRouter } from "express";
import { db, chatAttachmentsTable, chatMessagesTable, usersTable } from "@workspace/db";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { requireAuth, requireActive } from "../middlewares/auth";
import {
  auditChatDenied,
  enforceChatModuleAccess,
  getVisibleParticipantIds,
  getVisibleParticipants,
} from "../lib/chat-access";
import { appendEditHistory, getEditWindow } from "../lib/chat-message-rules";
import { emitGroupMessage, emitGroupMessageEdited, subscribeToChatStream } from "../lib/chat-realtime";

const router: IRouter = Router();

function parseOptionalPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

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

router.get("/chat/stream", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const user = req.user!;
  const cleanup = subscribeToChatStream({ userId: user.userId, role: user.role, res });
  req.on("close", cleanup);
});

router.get("/chat/messages", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const user = req.user!;
  const rawLimit = req.query.limit as string | undefined;
  const limit = Math.min(parseInt(rawLimit || "100", 10) || 100, 200);
  const rawAfterId = req.query.afterId as string | undefined;
  const afterId = rawAfterId ? parseInt(rawAfterId, 10) : null;
  const visibleIds = await getVisibleParticipantIds(user);

  const whereClause = visibleIds.length > 0
    ? (afterId && !isNaN(afterId)
      ? and(inArray(chatMessagesTable.senderId, visibleIds), gt(chatMessagesTable.id, afterId))
      : inArray(chatMessagesTable.senderId, visibleIds))
    : eq(chatMessagesTable.id, -1);

  const messages = await db.query.chatMessagesTable.findMany({
    where: whereClause,
    with: { sender: true },
    orderBy: (m, { asc, desc }) => [afterId && !isNaN(afterId) ? asc(m.createdAt) : desc(m.createdAt)],
    limit,
  });
  if (!afterId || isNaN(afterId)) {
    messages.reverse();
  }

  const replyIds = messages.map((m) => m.replyToId).filter((v): v is number => typeof v === "number");
  const replyMessages = replyIds.length
    ? await db.query.chatMessagesTable.findMany({
      where: inArray(chatMessagesTable.id, replyIds),
      with: { sender: true },
    })
    : [];
  const replyById = new Map(replyMessages.map((m) => [m.id, m]));

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
      replyTo: m.replyToId
        ? (() => {
          const r = replyById.get(m.replyToId);
          if (!r) return null;
          return {
            id: r.id,
            senderId: r.senderId,
            message: r.message,
            createdAt: r.createdAt,
            sender: { id: r.sender.id, name: r.sender.name, role: r.sender.role },
          };
        })()
        : null,
      editedAt: m.editedAt,
      editHistory: (user.role === "ADMIN" || m.senderId === user.userId) && m.editHistory
        ? (() => {
          try { return JSON.parse(m.editHistory); } catch { return []; }
        })()
        : undefined,
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
  const { message, attachmentIds, replyToId } = req.body as { message?: unknown; attachmentIds?: unknown; replyToId?: unknown };
  const ids = Array.isArray(attachmentIds) ? attachmentIds.map((v) => Number(v)).filter((v) => Number.isInteger(v)) : [];
  const replyId = parseOptionalPositiveInt(replyToId);

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

  if (replyId != null) {
    const [reply] = await db.select({ id: chatMessagesTable.id, senderId: chatMessagesTable.senderId }).from(chatMessagesTable).where(eq(chatMessagesTable.id, replyId));
    if (!reply || !visibleIds.includes(reply.senderId)) {
      res.status(400).json({ error: "Mensagem de resposta inválida" });
      return;
    }
  }

  const [msg] = await db
    .insert(chatMessagesTable)
    .values({ senderId: user.userId, message: text, replyToId: replyId })
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
  const reply = replyId != null
    ? await db.query.chatMessagesTable.findFirst({ where: eq(chatMessagesTable.id, replyId), with: { sender: true } })
    : null;

  emitGroupMessage({
    senderId: sender.id,
    senderName: sender.name,
    senderRole: sender.role,
    messageId: msg.id,
    message: msg.message,
    createdAt: msg.createdAt,
  });

  res.status(201).json({
    id: msg.id,
    senderId: msg.senderId,
    message: msg.message,
    replyTo: reply
      ? {
        id: reply.id,
        senderId: reply.senderId,
        message: reply.message,
        createdAt: reply.createdAt,
        sender: { id: reply.sender.id, name: reply.sender.name, role: reply.sender.role },
      }
      : null,
    editedAt: msg.editedAt,
    editHistory: (user.role === "ADMIN" || msg.senderId === user.userId) && msg.editHistory
      ? (() => {
        try { return JSON.parse(msg.editHistory); } catch { return []; }
      })()
      : undefined,
    createdAt: msg.createdAt,
    sender: {
      id: sender.id,
      name: sender.name,
      role: sender.role,
    },
    attachments: linked,
  });
});

router.patch("/chat/messages/:id", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const user = req.user!;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const { message } = req.body as { message?: unknown };
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) {
    res.status(400).json({ error: "Mensagem inválida" });
    return;
  }
  if (text.length > 2000) {
    res.status(400).json({ error: "Mensagem muito longa (max 2000 caracteres)." });
    return;
  }

  const visibleIds = await getVisibleParticipantIds(user);
  if (!visibleIds.includes(user.userId)) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const existing = await db.query.chatMessagesTable.findFirst({
    where: eq(chatMessagesTable.id, id),
    with: { sender: true },
  });
  if (!existing || !visibleIds.includes(existing.senderId)) {
    res.status(404).json({ error: "Mensagem não encontrada" });
    return;
  }
  if (existing.senderId !== user.userId) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const now = new Date();
  const createdAt = new Date(existing.createdAt);
  const win = getEditWindow({ createdAt, now });
  if (!win.canEdit) {
    res.status(400).json({ error: "Tempo de edição expirado" });
    return;
  }

  const historyResult = appendEditHistory({ existingJson: existing.editHistory, previousMessage: existing.message, now });

  const [updated] = await db.update(chatMessagesTable)
    .set({ message: text, editedAt: now, editHistory: historyResult.json })
    .where(eq(chatMessagesTable.id, id))
    .returning();

  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, updated.senderId));
  const reply = existing.replyToId
    ? await db.query.chatMessagesTable.findFirst({ where: eq(chatMessagesTable.id, existing.replyToId), with: { sender: true } })
    : null;
  const attachments = await db
    .select({
      id: chatAttachmentsTable.id,
      filename: chatAttachmentsTable.filename,
      mimeType: chatAttachmentsTable.mimeType,
      size: chatAttachmentsTable.size,
      uploaderId: chatAttachmentsTable.uploaderId,
      createdAt: chatAttachmentsTable.createdAt,
    })
    .from(chatAttachmentsTable)
    .where(eq(chatAttachmentsTable.chatMessageId, updated.id));

  emitGroupMessageEdited({
    senderId: updated.senderId,
    senderRole: sender.role,
    messageId: updated.id,
    editedAt: now,
  });

  res.json({
    id: updated.id,
    senderId: updated.senderId,
    message: updated.message,
    replyTo: reply
      ? {
        id: reply.id,
        senderId: reply.senderId,
        message: reply.message,
        createdAt: reply.createdAt,
        sender: { id: reply.sender.id, name: reply.sender.name, role: reply.sender.role },
      }
      : null,
    editedAt: updated.editedAt,
    editHistory: historyResult.history,
    createdAt: updated.createdAt,
    sender: { id: sender.id, name: sender.name, role: sender.role },
    attachments,
  });
});

export default router;
