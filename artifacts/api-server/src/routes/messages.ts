import { Router, type IRouter } from "express";
import { db, messagesTable, ticketAuditLogsTable, ticketsTable, usersTable, ticketMessageAttachmentsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { CreateMessageBody } from "@workspace/api-zod";
import { requireAuth, requireActive } from "../middlewares/auth";
import { enforceTicketAccess } from "../lib/access";
import { autoAssignTicketOnMessageInteraction } from "../lib/ticket-auto-assign";
import { canCreateTicketMessage } from "../lib/ticket-access-policy";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { normalizeFilename, sanitizeTicketMessageHtml, validateTicketMessageAttachmentFile } from "../lib/ticket-message-content";

const router: IRouter = Router();

const MAX_ATTACHMENT_SIZE = 3 * 1024 * 1024; // 3 MB
const MAX_ATTACHMENTS_PER_MESSAGE = 5;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE, files: MAX_ATTACHMENTS_PER_MESSAGE },
});

function extensionOf(filename: string): string {
  return path.extname(filename || "").toLowerCase();
}

async function ensureUploadsDir(ticketId: number, messageId: number): Promise<string> {
  const base = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.resolve(process.cwd(), "uploads");
  const dir = path.resolve(base, "tickets", String(ticketId), "messages", String(messageId));
  if (!dir.startsWith(base)) throw new Error("Caminho inválido.");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function getUploadsBaseDir(): string {
  return process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.resolve(process.cwd(), "uploads");
}

function resolveStoredPath(storagePath: string): string {
  const base = getUploadsBaseDir();
  const abs = path.resolve(base, storagePath);
  if (!abs.startsWith(base)) throw new Error("Caminho inválido.");
  return abs;
}

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
    with: { sender: true, attachments: true },
    orderBy: (m, { asc }) => [asc(m.createdAt)],
  });

  res.json(messages.map(m => ({
    id: m.id,
    ticketId: m.ticketId,
    senderId: m.senderId,
    format: (m as any).format ?? "PLAIN",
    message: m.message,
    createdAt: m.createdAt,
    sender: {
      id: m.sender.id,
      name: m.sender.name,
      email: m.sender.email,
      role: m.sender.role,
    },
    attachments: (m as any).attachments?.map((a: any) => ({
      id: a.id,
      messageId: a.messageId,
      ticketId: a.ticketId,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      createdAt: a.createdAt,
    })) ?? [],
  })));
});

router.post("/tickets/:ticketId/messages", requireAuth, requireActive, upload.array("files", MAX_ATTACHMENTS_PER_MESSAGE), async (req, res): Promise<void> => {
  const user = req.user!;
  const raw = Array.isArray(req.params.ticketId) ? req.params.ticketId[0] : req.params.ticketId;
  const ticketId = parseInt(raw, 10);

  if (isNaN(ticketId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const isMultipart = String(req.headers["content-type"] || "").includes("multipart/form-data");
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    res.status(400).json({ error: `Máximo de ${MAX_ATTACHMENTS_PER_MESSAGE} anexos por mensagem.` });
    return;
  }
  for (const f of files) {
    const v = validateTicketMessageAttachmentFile(f);
    if (!v.ok) {
      res.status(400).json({ error: v.error });
      return;
    }
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
  if (!canCreateTicketMessage({ ticketStatus: ticket.status })) {
    res.status(400).json({ error: "Não é possível adicionar mensagens em chamados resolvidos ou concluídos" });
    return;
  }

  let format: "PLAIN" | "HTML" = "PLAIN";
  let rawMessage = "";
  if (isMultipart) {
    const bodyMsg = typeof (req.body as any)?.message === "string" ? String((req.body as any).message) : "";
    const bodyFormat = typeof (req.body as any)?.format === "string" ? String((req.body as any).format).toUpperCase() : "HTML";
    format = bodyFormat === "PLAIN" ? "PLAIN" : "HTML";
    rawMessage = bodyMsg;
  } else {
    const parsed = CreateMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    format = "PLAIN";
    rawMessage = parsed.data.message;
  }

  const trimmed = rawMessage.trim();
  if (!trimmed && files.length === 0) {
    res.status(400).json({ error: "Mensagem vazia" });
    return;
  }

  const sanitized = format === "HTML" ? sanitizeTicketMessageHtml(trimmed) : trimmed;
  const preview = sanitized.replaceAll(/<[^>]+>/g, "").trim().slice(0, 140);

  const [msg] = await db.insert(messagesTable).values({
    ticketId,
    senderId: user.userId,
    format,
    message: sanitized,
  } as any).returning();

  const insertedAttachments = [];
  if (files.length > 0) {
    const dir = await ensureUploadsDir(ticketId, msg.id);
    for (const f of files) {
      const safeName = normalizeFilename(f.originalname);
      const key = crypto.randomUUID();
      const storedName = `${key}${extensionOf(safeName)}`;
      const abs = path.resolve(dir, storedName);
      await fs.writeFile(abs, f.buffer);
      const rel = path.relative(getUploadsBaseDir(), abs).replaceAll("\\", "/");
      const [att] = await db.insert(ticketMessageAttachmentsTable).values({
        messageId: msg.id,
        ticketId,
        filename: safeName,
        mimeType: f.mimetype,
        size: f.size,
        storagePath: rel,
      } as any).returning({
        id: ticketMessageAttachmentsTable.id,
        messageId: ticketMessageAttachmentsTable.messageId,
        ticketId: ticketMessageAttachmentsTable.ticketId,
        filename: ticketMessageAttachmentsTable.filename,
        mimeType: ticketMessageAttachmentsTable.mimeType,
        size: ticketMessageAttachmentsTable.size,
        createdAt: ticketMessageAttachmentsTable.createdAt,
      });
      insertedAttachments.push(att);
    }
  }

  await db.insert(ticketAuditLogsTable).values({
    ticketId,
    actorUserId: user.userId,
    type: "MESSAGE_SENT",
    messageId: msg.id,
    detail: preview,
  });

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
    format: (msg as any).format ?? format,
    message: msg.message,
    createdAt: msg.createdAt,
    sender: {
      id: sender.id,
      name: sender.name,
      email: sender.email,
      role: sender.role,
    },
    attachments: insertedAttachments,
  });
});

router.get("/tickets/:ticketId/messages/:messageId/attachments", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const rawTicket = Array.isArray(req.params.ticketId) ? req.params.ticketId[0] : req.params.ticketId;
  const rawMessage = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const ticketId = parseInt(rawTicket, 10);
  const messageId = parseInt(rawMessage, 10);
  if (isNaN(ticketId) || isNaN(messageId)) {
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

  const rows = await db.select({
    id: ticketMessageAttachmentsTable.id,
    messageId: ticketMessageAttachmentsTable.messageId,
    ticketId: ticketMessageAttachmentsTable.ticketId,
    filename: ticketMessageAttachmentsTable.filename,
    mimeType: ticketMessageAttachmentsTable.mimeType,
    size: ticketMessageAttachmentsTable.size,
    createdAt: ticketMessageAttachmentsTable.createdAt,
  }).from(ticketMessageAttachmentsTable).where(eq(ticketMessageAttachmentsTable.messageId, messageId));

  res.json(rows);
});

router.get("/tickets/:ticketId/messages/:messageId/attachments/:aid", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const rawTicket = Array.isArray(req.params.ticketId) ? req.params.ticketId[0] : req.params.ticketId;
  const rawMessage = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const rawAid = Array.isArray(req.params.aid) ? req.params.aid[0] : req.params.aid;
  const ticketId = parseInt(rawTicket, 10);
  const messageId = parseInt(rawMessage, 10);
  const aid = parseInt(rawAid, 10);
  if (isNaN(ticketId) || isNaN(messageId) || isNaN(aid)) {
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

  const [att] = await db.select().from(ticketMessageAttachmentsTable).where(eq(ticketMessageAttachmentsTable.id, aid));
  if (!att || att.ticketId !== ticketId || att.messageId !== messageId) {
    res.status(404).json({ error: "Anexo não encontrado" });
    return;
  }

  const abs = resolveStoredPath((att as any).storagePath);
  const buf = await fs.readFile(abs);
  const wantsDownload = req.query.download === "1" || req.query.download === "true";
  const canInline = att.mimeType.startsWith("image/") || att.mimeType === "application/pdf";

  res.setHeader("Content-Type", att.mimeType);
  res.setHeader(
    "Content-Disposition",
    `${!wantsDownload && canInline ? "inline" : "attachment"}; filename="${encodeURIComponent(att.filename)}"`,
  );
  res.setHeader("Content-Length", String(buf.length));
  res.send(buf);
});

export default router;
