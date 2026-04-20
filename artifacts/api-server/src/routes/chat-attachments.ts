import { Router, type IRouter } from "express";
import multer from "multer";
import { and, eq, inArray } from "drizzle-orm";
import { db, chatAttachmentsTable, chatMessagesTable, directMessagesTable } from "@workspace/db";
import { requireAuth, requireActive } from "../middlewares/auth";
import { auditChatDenied, canInteractWithChatUser, enforceChatModuleAccess, getVisibleParticipantIds } from "../lib/chat-access";
import { isAllowedAttachment, sniffMimeType } from "../lib/file-sniff";

const router: IRouter = Router();

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function requireChatAccess(req: any, res: any, next: any) {
  const user = req.user;
  if (!user || !enforceChatModuleAccess(user, "chat:module")) {
    res.status(403).json({ error: "Acesso restrito a Administradores, Coordenadores e Analistas." });
    return;
  }
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: 10,
  },
});

function toDownloadName(filename: string): string {
  const safe = filename.replace(/[^\w.\- ()\[\]]+/g, "_").slice(0, 180);
  return safe.length > 0 ? safe : "anexo";
}

router.post("/chat/attachments/upload", requireAuth, requireActive, requireChatAccess, upload.array("files", 10), async (req, res): Promise<void> => {
  const user = req.user!;
  const scope = String((req.query.scope ?? "")).toUpperCase();
  const receiverIdRaw = req.query.receiverId != null ? String(req.query.receiverId) : "";
  const receiverId = receiverIdRaw ? parseInt(receiverIdRaw, 10) : null;

  if (scope !== "GROUP" && scope !== "DM") {
    res.status(400).json({ error: "Escopo inválido" });
    return;
  }
  if (scope === "DM") {
    if (!receiverId || isNaN(receiverId)) {
      res.status(400).json({ error: "receiverId é obrigatório" });
      return;
    }
    if (!(await canInteractWithChatUser(user, receiverId))) {
      auditChatDenied(user, "chat:attachments:upload", { targetUserId: receiverId });
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
  }

  const files = (req.files ?? []) as Express.Multer.File[];
  if (!files.length) {
    res.status(400).json({ error: "Nenhum arquivo enviado" });
    return;
  }

  const created = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      res.status(400).json({ error: `Arquivo excede 5MB: ${file.originalname}` });
      return;
    }

    const sniffed = sniffMimeType(file.buffer);
    const allowed = isAllowedAttachment({
      filename: file.originalname,
      declaredMimeType: file.mimetype,
      sniffedMimeType: sniffed,
    });
    if (!allowed.ok) {
      res.status(400).json({ error: `${allowed.error}: ${file.originalname}` });
      return;
    }

    const [row] = await db.insert(chatAttachmentsTable).values({
      scope: scope as "GROUP" | "DM",
      uploaderId: user.userId,
      dmReceiverId: scope === "DM" ? receiverId : null,
      chatMessageId: null,
      directMessageId: null,
      filename: file.originalname,
      mimeType: allowed.canonicalMimeType,
      size: file.size,
      data: file.buffer.toString("base64"),
    }).returning({
      id: chatAttachmentsTable.id,
      scope: chatAttachmentsTable.scope,
      dmReceiverId: chatAttachmentsTable.dmReceiverId,
      uploaderId: chatAttachmentsTable.uploaderId,
      filename: chatAttachmentsTable.filename,
      mimeType: chatAttachmentsTable.mimeType,
      size: chatAttachmentsTable.size,
      createdAt: chatAttachmentsTable.createdAt,
    });
    created.push(row);
  }

  res.json({ attachments: created });
});

router.get("/chat/attachments/:id/download", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const user = req.user!;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [att] = await db.select().from(chatAttachmentsTable).where(eq(chatAttachmentsTable.id, id));
  if (!att) {
    res.status(404).json({ error: "Anexo não encontrado" });
    return;
  }

  const isOwner = att.uploaderId === user.userId;

  if (!isOwner) {
    if (att.scope === "GROUP") {
      if (!att.chatMessageId) {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      const visible = await getVisibleParticipantIds(user);
      const [msg] = await db.select({ senderId: chatMessagesTable.senderId }).from(chatMessagesTable).where(eq(chatMessagesTable.id, att.chatMessageId));
      if (!msg || !visible.includes(msg.senderId)) {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
    } else {
      if (!att.directMessageId) {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      const [dm] = await db
        .select({ senderId: directMessagesTable.senderId, receiverId: directMessagesTable.receiverId })
        .from(directMessagesTable)
        .where(eq(directMessagesTable.id, att.directMessageId));
      if (!dm || (dm.senderId !== user.userId && dm.receiverId !== user.userId)) {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
    }
  }

  const buffer = Buffer.from(att.data, "base64");
  res.setHeader("Content-Type", att.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${toDownloadName(att.filename)}"`);
  res.send(buffer);
});

router.delete("/chat/attachments/:id", requireAuth, requireActive, requireChatAccess, async (req, res): Promise<void> => {
  const user = req.user!;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [att] = await db.select().from(chatAttachmentsTable).where(eq(chatAttachmentsTable.id, id));
  if (!att) {
    res.status(404).json({ error: "Anexo não encontrado" });
    return;
  }

  const isOwner = att.uploaderId === user.userId;
  const canModerate = user.role === "ADMIN";

  if (!isOwner && !canModerate) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  if (att.scope === "DM" && att.dmReceiverId) {
    if (!(await canInteractWithChatUser(user, att.dmReceiverId))) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
  }

  await db.delete(chatAttachmentsTable).where(eq(chatAttachmentsTable.id, id));
  res.json({ ok: true });
});

export default router;
