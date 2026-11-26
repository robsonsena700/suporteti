import { Router, type IRouter } from "express";
import { requireAuth, requireActive } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { createInMemoryRateLimiter } from "../lib/rate-limit";

const router: IRouter = Router();

// Protecao: um cliente com defeito (ou antigo, em cache) nao pode inundar o
// log do servidor. Acima do limite o envio e descartado em silencio (202).
const diagnosticsLimiter = createInMemoryRateLimiter({ windowMs: 60_000, max: 30 });

type ClientAttachmentLogBody = {
  level?: "info" | "warn" | "error";
  event?: string;
  sessionId?: string;
  context?: Record<string, unknown>;
};

router.post("/attachment-diagnostics/logs", requireAuth, requireActive, async (req, res): Promise<void> => {
  if (!diagnosticsLimiter.check(`attachment-diag:${req.user!.userId}`).allowed) {
    res.status(202).json({ ok: true, dropped: true });
    return;
  }
  const body = (req.body ?? {}) as ClientAttachmentLogBody;
  const level = body.level === "warn" || body.level === "error" ? body.level : "info";
  const event = typeof body.event === "string" && body.event.trim() ? body.event.trim() : "attachment.client.unknown";
  const sessionId = typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : null;
  const context = body.context && typeof body.context === "object" ? body.context : {};

  const logPayload = {
    source: "frontend",
    event,
    sessionId,
    actorUserId: req.user?.userId ?? null,
    actorRole: req.user?.role ?? null,
    actorUf: req.user?.uf ?? null,
    actorMunicipality: req.user?.municipality ?? null,
    context,
  };

  if (level === "error") {
    logger.error(logPayload, "Attachment client error reported");
  } else if (level === "warn") {
    logger.warn(logPayload, "Attachment client warning reported");
  } else {
    logger.info(logPayload, "Attachment client log reported");
  }

  res.status(202).json({ ok: true });
});

export default router;
