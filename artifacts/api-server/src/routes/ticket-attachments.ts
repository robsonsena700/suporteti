import { Router, type IRouter } from "express";
import multer from "multer";
import { db, ticketsTable, ticketAttachmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireActive } from "../middlewares/auth";
import { enforceTicketAccess } from "../lib/access";

const router: IRouter = Router();

const MAX_SIZE = 3 * 1024 * 1024; // 3 MB
const MAX_FILES = 3;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de arquivo não permitido: ${file.mimetype}`));
    }
  },
});

// POST /api/tickets/:id/attachments — upload up to 3 files
router.post(
  "/tickets/:id/attachments",
  requireAuth,
  requireActive,
  upload.array("files", MAX_FILES),
  async (req, res): Promise<void> => {
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

    if (!(await enforceTicketAccess(user, ticket, "attachments:create"))) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: "Nenhum arquivo enviado" });
      return;
    }

    // Check total existing attachments
    const existing = await db.select().from(ticketAttachmentsTable).where(eq(ticketAttachmentsTable.ticketId, ticketId));
    if (existing.length + files.length > MAX_FILES) {
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

  await db.delete(ticketAttachmentsTable).where(eq(ticketAttachmentsTable.id, aid));
  res.status(204).send();
});

export default router;
