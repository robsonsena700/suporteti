import { Router, type IRouter } from "express";
import { db, chatAttachmentsTable, directMessagesTable, usersTable } from "@workspace/db";
import { eq, or, and, asc, desc, inArray, isNull, gt } from "drizzle-orm";
import { requireAuth, requireActive } from "../middlewares/auth";
import {
  auditChatDenied,
  canInteractWithChatUser,
  enforceChatModuleAccess,
  getVisibleParticipantIds,
} from "../lib/chat-access";
import { appendEditHistory, getEditWindow } from "../lib/chat-message-rules";
import { emitDirectMessage, emitDirectMessageEdited } from "../lib/chat-realtime";

const router: IRouter = Router();

const DM_INBOX_CACHE_TTL_MS = 1000;
const dmInboxCache = new Map<number, { value: any; expiresAt: number }>();
function invalidateDmInboxCache(userId: number) {
  dmInboxCache.delete(userId);
}

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

// GET /api/chat/dm/:userId — fetch conversation between logged-in user and :userId
router.get("/chat/dm/:userId", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const me = req.user!.userId;
  const rawOther = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const other = parseInt(rawOther, 10);
  const rawAfterId = req.query.afterId as string | undefined;
  const afterId = rawAfterId ? parseInt(rawAfterId, 10) : null;

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

  const baseWhere = or(
    and(eq(directMessagesTable.senderId, me), eq(directMessagesTable.receiverId, other)),
    and(eq(directMessagesTable.senderId, other), eq(directMessagesTable.receiverId, me))
  );
  const whereClause = afterId && !isNaN(afterId) ? and(baseWhere, gt(directMessagesTable.id, afterId)) : baseWhere;

  const messages = await db.query.directMessagesTable.findMany({
    where: whereClause,
    with: { sender: true, receiver: true },
    orderBy: (m, { asc, desc }) => [afterId && !isNaN(afterId) ? asc(m.createdAt) : desc(m.createdAt)],
  });
  if (!afterId || isNaN(afterId)) {
    messages.reverse();
  }

  const replyIds = messages.map((m) => m.replyToId).filter((v): v is number => typeof v === "number");
  const replyMessages = replyIds.length
    ? await db.query.directMessagesTable.findMany({
      where: inArray(directMessagesTable.id, replyIds),
      with: { sender: true, receiver: true },
    })
    : [];
  const replyById = new Map(replyMessages.map((m) => [m.id, m]));

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
      replyTo: m.replyToId
        ? (() => {
          const r = replyById.get(m.replyToId);
          if (!r) return null;
          const sender = r.sender;
          return {
            id: r.id,
            senderId: r.senderId,
            receiverId: r.receiverId,
            message: r.message,
            createdAt: r.createdAt,
            sender: { id: sender.id, name: sender.name, role: sender.role },
          };
        })()
        : null,
      editedAt: m.editedAt,
      editHistory: (req.user!.role === "ADMIN" || m.senderId === me) && m.editHistory
        ? (() => {
          try { return JSON.parse(m.editHistory); } catch { return []; }
        })()
        : undefined,
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

  if (isNaN(other)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }
  if (other === me) {
    res.status(400).json({ error: "Não é possível enviar mensagem para si mesmo." });
    return;
  }

  const { message, attachmentIds, replyToId } = req.body as { message?: unknown; attachmentIds?: unknown; replyToId?: unknown };
  const ids = Array.isArray(attachmentIds) ? attachmentIds.map((v) => Number(v)).filter((v) => Number.isInteger(v)) : [];
  const text = typeof message === "string" ? message.trim() : "";
  const replyId = parseOptionalPositiveInt(replyToId);
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

  if (replyId != null) {
    const [reply] = await db
      .select({ id: directMessagesTable.id, senderId: directMessagesTable.senderId, receiverId: directMessagesTable.receiverId })
      .from(directMessagesTable)
      .where(eq(directMessagesTable.id, replyId));
    const ok = reply && (
      (reply.senderId === me && reply.receiverId === other) || (reply.senderId === other && reply.receiverId === me)
    );
    if (!ok) {
      res.status(400).json({ error: "Mensagem de resposta inválida" });
      return;
    }
  }

  const [msg] = await db
    .insert(directMessagesTable)
    .values({ senderId: me, receiverId: other, message: text, replyToId: replyId })
    .returning();

  invalidateDmInboxCache(me);
  invalidateDmInboxCache(other);

  const reply = replyId != null
    ? await db.query.directMessagesTable.findFirst({ where: eq(directMessagesTable.id, replyId), with: { sender: true, receiver: true } })
    : null;

  emitDirectMessage({
    messageId: msg.id,
    message: msg.message,
    createdAt: msg.createdAt,
    senderId: sender.id,
    senderName: sender.name,
    senderRole: sender.role,
    receiverId: receiver.id,
    receiverName: receiver.name,
    receiverRole: receiver.role,
  });

  res.status(201).json({
    id: msg.id,
    senderId: msg.senderId,
    receiverId: msg.receiverId,
    message: msg.message,
    replyTo: reply
      ? {
        id: reply.id,
        senderId: reply.senderId,
        receiverId: reply.receiverId,
        message: reply.message,
        createdAt: reply.createdAt,
        sender: { id: reply.sender.id, name: reply.sender.name, role: reply.sender.role },
      }
      : null,
    editedAt: msg.editedAt,
    editHistory: (req.user!.role === "ADMIN" || msg.senderId === me) && msg.editHistory
      ? (() => {
        try { return JSON.parse(msg.editHistory); } catch { return []; }
      })()
      : undefined,
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

router.patch("/chat/dm/message/:id", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const user = req.user!;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }
  const { message } = req.body as { message?: unknown };
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) {
    res.status(400).json({ error: "Mensagem inválida." });
    return;
  }
  if (text.length > 2000) {
    res.status(400).json({ error: "Mensagem muito longa (max 2000 caracteres)." });
    return;
  }

  const existing = await db.query.directMessagesTable.findFirst({
    where: eq(directMessagesTable.id, id),
    with: { sender: true, receiver: true },
  });
  if (!existing) {
    res.status(404).json({ error: "Mensagem não encontrada." });
    return;
  }
  if (existing.senderId !== user.userId) {
    res.status(403).json({ error: "Acesso negado." });
    return;
  }
  const canAccess = await canInteractWithChatUser(user, existing.receiverId);
  if (!canAccess) {
    res.status(403).json({ error: "Acesso negado." });
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

  const [updated] = await db.update(directMessagesTable)
    .set({ message: text, editedAt: now, editHistory: historyResult.json })
    .where(eq(directMessagesTable.id, id))
    .returning();

  invalidateDmInboxCache(updated.senderId);
  invalidateDmInboxCache(updated.receiverId);

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
    .where(eq(chatAttachmentsTable.directMessageId, updated.id));

  const reply = existing.replyToId
    ? await db.query.directMessagesTable.findFirst({ where: eq(directMessagesTable.id, existing.replyToId), with: { sender: true, receiver: true } })
    : null;

  emitDirectMessageEdited({
    messageId: updated.id,
    senderId: updated.senderId,
    receiverId: updated.receiverId,
    editedAt: now,
  });

  res.json({
    id: updated.id,
    senderId: updated.senderId,
    receiverId: updated.receiverId,
    message: updated.message,
    replyTo: reply
      ? {
        id: reply.id,
        senderId: reply.senderId,
        receiverId: reply.receiverId,
        message: reply.message,
        createdAt: reply.createdAt,
        sender: { id: reply.sender.id, name: reply.sender.name, role: reply.sender.role },
      }
      : null,
    editedAt: updated.editedAt,
    editHistory: historyResult.history,
    createdAt: updated.createdAt,
    sender: { id: existing.sender.id, name: existing.sender.name, role: existing.sender.role },
    receiver: { id: existing.receiver.id, name: existing.receiver.name, role: existing.receiver.role },
    attachments,
  });
});

// GET /api/chat/dm-inbox — get last DM per conversation partner (for preview in sidebar)
router.get("/chat/dm-inbox", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const me = req.user!.userId;
  const visibleIds = await getVisibleParticipantIds(req.user!);

  const cached = dmInboxCache.get(me);
  if (cached && cached.expiresAt > Date.now()) {
    res.json(cached.value);
    return;
  }

  const partnerCandidates = visibleIds.filter((id) => id !== me);
  const partnerSet = new Set<number>(partnerCandidates);
  if (partnerCandidates.length === 0) {
    const empty: any[] = [];
    dmInboxCache.set(me, { value: empty, expiresAt: Date.now() + DM_INBOX_CACHE_TTL_MS });
    res.json(empty);
    return;
  }

  const limit = Math.min(2000, Math.max(200, partnerCandidates.length * 25));
  const recent = await db.query.directMessagesTable.findMany({
    where: or(
      eq(directMessagesTable.senderId, me),
      eq(directMessagesTable.receiverId, me)
    ),
    with: { sender: true, receiver: true },
    orderBy: [desc(directMessagesTable.createdAt)],
    limit,
  });

  const byPartner = new Map<number, (typeof recent)[number]>();
  for (const m of recent) {
    const partnerId = m.senderId === me ? m.receiverId : m.senderId;
    if (!partnerSet.has(partnerId)) continue;
    if (!byPartner.has(partnerId)) byPartner.set(partnerId, m);
    if (byPartner.size >= partnerCandidates.length) break;
  }

  const result = Array.from(byPartner.entries())
    .map(([partnerId, m]) => {
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
    })
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

  dmInboxCache.set(me, { value: result, expiresAt: Date.now() + DM_INBOX_CACHE_TTL_MS });
  res.json(result);
});

export default router;
