import { Router, type IRouter } from "express";
import { db, ticketRatingsTable, ticketsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireActive, requireRoles } from "../middlewares/auth";
import { enforceTicketAccess } from "../lib/access";

const router: IRouter = Router();

router.get("/tickets/:ticketId/rating", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  if (user.role !== "USER") {
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

// POST /tickets/:ticketId/rating foi removida: era uma segunda
// implementacao de criacao de avaliacao, nunca usada pelo frontend (que
// sempre envia para POST /tickets/:ticketId/rate, em routes/tickets.ts,
// com a validacao completa de CreateRatingSchema). Alem de ser codigo
// morto, tinha um bug proprio: sempre gravava reasonLowRating como null,
// mesmo para notas baixas (1 a 3), perdendo esse dado caso algum dia
// fosse chamada. A criacao de avaliacao agora tem um unico caminho
// (routes/tickets.ts), e esta rota continua existindo so para leitura
// (GET), que e o que o frontend efetivamente usa.

export default router;
