import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { db, ticketAuditLogsTable, ticketsTable, ticketAttachmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireActive } from "../middlewares/auth";
import { enforceTicketAccess } from "../lib/access";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const MAX_SIZE = 8 * 1024 * 1024; // 8 MB (fotos de câmera de celular costumam passar de 3 MB)
const MAX_FILES = 3;
const ALLOWED_MIME = [
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp",
  "image/heic", "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
];
const ALLOWED_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt",
];

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : "";
}

function isAllowedUpload(file: Express.Multer.File): boolean {
  if (ALLOWED_MIME.includes(file.mimetype)) return true;
  if (!file.mimetype || file.mimetype === "application/octet-stream") {
    return ALLOWED_EXTENSIONS.includes(getFileExtension(file.originalname));
  }
  return ALLOWED_EXTENSIONS.includes(getFileExtension(file.originalname));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (isAllowedUpload(file)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de arquivo não permitido: ${file.mimetype || getFileExtension(file.originalname) || "desconhecido"}`));
    }
  },
});

function uploadTicketAttachments(req: Request, res: Response, next: NextFunction) {
  upload.array("files", MAX_FILES)(req, res, (err?: unknown) => {
    if (err) {
      logger.error({
        source: "backend",
        event: "attachment.upload.middleware_error",
        actorUserId: req.user?.userId ?? null,
        ticketId: req.params?.id ?? null,
        errorMessage: err instanceof Error ? err.message : String(err),
        files: Array.isArray(req.files)
          ? (req.files as Express.Multer.File[]).map((file) => ({
              filename: file.originalname,
              mimeType: file.mimetype,
              size: file.size,
            }))
          : [],
      }, "Ticket attachment upload middleware failed");

      // Traduz os erros conhecidos (tamanho, quantidade, tipo não permitido) em uma
      // resposta clara em vez de deixar cair no handler genérico ("Erro interno do
      // servidor"), que não ajuda o usuário a entender o que precisa mudar no anexo.
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(400).json({ error: `Arquivo muito grande. Máximo permitido: ${MAX_SIZE / (1024 * 1024)} MB por arquivo.` });
          return;
        }
        if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
          res.status(400).json({ error: `Máximo de ${MAX_FILES} arquivo(s) por envio.` });
          return;
        }
        res.status(400).json({ error: "Não foi possível enviar o(s) arquivo(s). Tente novamente." });
        return;
      }
      if (err instanceof Error && err.message.startsWith("Tipo de arquivo não permitido")) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
      return;
    }
    next();
  });
}

// POST /api/tickets/:id/attachments — upload up to 3 files
router.post(
  "/tickets/:id/attachments",
  requireAuth,
  requireActive,
  uploadTicketAttachments,
  async (req, res): Promise<void> => {
    const user = req.user!;
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ticketId = parseInt(raw, 10);

    logger.info({
      source: "backend",
      event: "attachment.upload.request_received",
      actorUserId: user.userId,
      ticketId: raw,
      files: Array.isArray(req.files)
        ? (req.files as Express.Multer.File[]).map((file) => ({
            filename: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
          }))
        : [],
    }, "Ticket attachment upload request received");

    if (isNaN(ticketId)) {
      logger.warn({ source: "backend", event: "attachment.upload.invalid_ticket_id", actorUserId: user.userId, rawTicketId: raw }, "Ticket attachment upload rejected due to invalid ticket id");
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId));
    if (!ticket) {
      logger.warn({ source: "backend", event: "attachment.upload.ticket_not_found", actorUserId: user.userId, ticketId }, "Ticket attachment upload rejected because ticket was not found");
      res.status(404).json({ error: "Chamado não encontrado" });
      return;
    }

    if (!(await enforceTicketAccess(user, ticket, "attachments:create"))) {
      logger.warn({ source: "backend", event: "attachment.upload.access_denied", actorUserId: user.userId, ticketId }, "Ticket attachment upload rejected due to access policy");
      res.status(403).json({ error: "Acesso negado" });
      return;
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      logger.warn({ source: "backend", event: "attachment.upload.empty_request", actorUserId: user.userId, ticketId }, "Ticket attachment upload received without files");
      res.status(400).json({ error: "Nenhum arquivo enviado" });
      return;
    }

    // Check total existing attachments
    const existing = await db.select().from(ticketAttachmentsTable).where(eq(ticketAttachmentsTable.ticketId, ticketId));
    if (existing.length + files.length > MAX_FILES) {
      logger.warn({
        source: "backend",
        event: "attachment.upload.limit_exceeded",
        actorUserId: user.userId,
        ticketId,
        existingCount: existing.length,
        incomingCount: files.length,
      }, "Ticket attachment upload rejected due to file count limit");
      res.status(400).json({ error: `O chamado já possui ${existing.length} anexo(s). Máximo permitido: ${MAX_FILES}.` });
      return;
    }

    const inserted = await db.insert(ticketAttachmentsTable).values(
      files.map((f) => ({
        ticketId,
        filename: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
        data: f.buffer.toString("base64"),
      }))
    ).returning({ id: ticketAttachmentsTable.id, filename: ticketAttachmentsTable.filename, mimeType: ticketAttachmentsTable.mimeType, size: ticketAttachmentsTable.size, createdAt: ticketAttachmentsTable.createdAt });

    await db.insert(ticketAuditLogsTable).values({
      ticketId,
      actorUserId: user.userId,
      type: "ATTACHMENT_ADDED",
      detail: JSON.stringify({
        attachments: inserted.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
        })),
      }),
    });

    logger.info({
      source: "backend",
      event: "attachment.upload.success",
      actorUserId: user.userId,
      ticketId,
      uploadedCount: inserted.length,
      files: inserted.map((file) => ({
        id: file.id,
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size,
      })),
    }, "Ticket attachment upload succeeded");

    res.status(201).json(inserted);
  }
);

// GET /api/tickets/:id/attachments — list metadata (no data)
router.get("/tickets/:id/attachments", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
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

  if (!(await enforceTicketAccess(user, ticket, "attachments:list"))) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const attachments = await db.select({
    id: ticketAttachmentsTable.id,
    filename: ticketAttachmentsTable.filename,
    mimeType: ticketAttachmentsTable.mimeType,
    size: ticketAttachmentsTable.size,
    createdAt: ticketAttachmentsTable.createdAt,
  }).from(ticketAttachmentsTable).where(eq(ticketAttachmentsTable.ticketId, ticketId));

  res.json(attachments);
});

// GET /api/tickets/:id/attachments/:aid — download file
router.get("/tickets/:id/attachments/:aid", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const rawTicket = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawAid = Array.isArray(req.params.aid) ? req.params.aid[0] : req.params.aid;
  const ticketId = parseInt(rawTicket, 10);
  const aid = parseInt(rawAid, 10);

  if (isNaN(ticketId) || isNaN(aid)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId));
  if (!ticket) {
    res.status(404).json({ error: "Chamado não encontrado" });
    return;
  }

  if (!(await enforceTicketAccess(user, ticket, "attachments:get"))) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const [att] = await db.select().from(ticketAttachmentsTable).where(eq(ticketAttachmentsTable.id, aid));
  if (!att || att.ticketId !== ticketId) {
    res.status(404).json({ error: "Anexo não encontrado" });
    return;
  }

  const buf = Buffer.from(att.data, "base64");
  const wantsDownload = req.query.download === "1" || req.query.download === "true";
  const canInline = att.mimeType.startsWith("image/")
    || att.mimeType === "application/pdf"
    || att.mimeType === "text/plain";

  res.setHeader("Content-Type", att.mimeType);
  res.setHeader(
    "Content-Disposition",
    `${!wantsDownload && canInline ? "inline" : "attachment"}; filename="${encodeURIComponent(att.filename)}"`,
  );
  res.setHeader("Content-Length", String(buf.length));
  res.send(buf);
});

// DELETE /api/tickets/:id/attachments/:aid
router.delete("/tickets/:id/attachments/:aid", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const rawTicket = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawAid = Array.isArray(req.params.aid) ? req.params.aid[0] : req.params.aid;
  const ticketId = parseInt(rawTicket, 10);
  const aid = parseInt(rawAid, 10);

  if (isNaN(ticketId) || isNaN(aid)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId));
  if (!ticket) {
    res.status(404).json({ error: "Chamado não encontrado" });
    return;
  }

  if (!(await enforceTicketAccess(user, ticket, "attachments:delete"))) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const [att] = await db.select().from(ticketAttachmentsTable).where(eq(ticketAttachmentsTable.id, aid));
  if (!att || att.ticketId !== ticketId) {
    res.status(404).json({ error: "Anexo não encontrado" });
    return;
  }

  await db.insert(ticketAuditLogsTable).values({
    ticketId,
    actorUserId: user.userId,
    type: "ATTACHMENT_REMOVED",
    detail: JSON.stringify({ id: att.id, filename: att.filename, mimeType: att.mimeType, size: att.size }),
  });

  await db.delete(ticketAttachmentsTable).where(eq(ticketAttachmentsTable.id, aid));
  res.status(204).send();
});

export default router;
