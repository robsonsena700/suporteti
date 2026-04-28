import { Router, type IRouter } from "express";
import { db, ticketRatingsTable, ticketsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { RateTicketBody } from "@workspace/api-zod";
import { requireAuth, requireActive, requireRoles } from "../middlewares/auth";
import { enforceTicketAccess } from "../lib/access";

const router: IRouter = Router();

router.get("/tickets/:ticketId/rating", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  if (user.role !== "ADMIN" && user.role !== "USER") {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
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
  if (!(await enforceTicketAccess(user, ticket, "ratings:get"))) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }

  const [rating] = await db.select().from(ticketRatingsTable).where(eq(ticketRatingsTable.ticketId, ticketId));
  if (!rating) {
    res.status(404).json({ error: "Avaliação não encontrada" });
    return;
  }

  res.json({
    id: rating.id,
    ticketId: rating.ticketId,
    userId: ticket.createdById,
    score: rating.rating,
    feedback: rating.comment ?? null,
    createdAt: rating.createdAt,
  });
});

router.post("/tickets/:ticketId/rating", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  if (user.role !== "ADMIN" && user.role !== "USER") {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
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
  if (ticket.status !== "RESOLVED" && ticket.status !== "CLOSED") {
    res.status(400).json({ error: "Chamado deve estar resolvido para ser avaliado" });
    return;
  }
  if (ticket.createdById !== user.userId) {
    res.status(403).json({ error: "Apenas o criador do chamado pode avaliá-lo" });
    return;
  }

  const [existing] = await db.select({ id: ticketRatingsTable.id }).from(ticketRatingsTable).where(eq(ticketRatingsTable.ticketId, ticketId));
  if (existing) {
    res.status(409).json({ error: "Este chamado já foi avaliado" });
    return;
  }

  const parsed = RateTicketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [rating] = await db
    .insert(ticketRatingsTable)
    .values({
      ticketId,
      rating: parsed.data.score,
      reasonLowRating: null,
      comment: parsed.data.feedback ?? null,
    })
    .returning();

  res.status(201).json({
    id: rating.id,
    ticketId: rating.ticketId,
    userId: user.userId,
    score: rating.rating,
    feedback: rating.comment ?? null,
    createdAt: rating.createdAt,
  });
});

export default router;
