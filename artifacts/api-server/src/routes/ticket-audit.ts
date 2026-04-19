import { Router, type IRouter } from "express";
import { db, ticketAuditLogsTable, ticketsTable, usersTable } from "@workspace/db";
import { eq, inArray, asc } from "drizzle-orm";
import { requireAuth, requireActive, requireRoles } from "../middlewares/auth";
import { enforceTicketAccess } from "../lib/access";

const router: IRouter = Router();

router.get(
  "/tickets/:ticketId/audit",
  requireAuth,
  requireActive,
  requireRoles("ADMIN", "ANALYST", "COORDINATOR"),
  async (req, res): Promise<void> => {
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
    if (!(await enforceTicketAccess(user, ticket, "tickets:audit"))) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }

    const logs = await db.select().from(ticketAuditLogsTable).where(eq(ticketAuditLogsTable.ticketId, ticketId)).orderBy(asc(ticketAuditLogsTable.createdAt));

    const userIds = Array.from(
      new Set(
        logs
          .flatMap(l => [l.actorUserId, l.fromAssignedToId, l.toAssignedToId])
          .filter((v): v is number => typeof v === "number"),
      ),
    );

    const userRows = userIds.length > 0
      ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds))
      : [];

    const userById = new Map(userRows.map(u => [u.id, u]));

    res.json(
      logs.map(l => ({
        id: l.id,
        ticketId: l.ticketId,
        type: l.type,
        createdAt: l.createdAt,
        detail: l.detail ?? null,
        actor: userById.get(l.actorUserId) ?? null,
        fromAssignedTo: l.fromAssignedToId ? (userById.get(l.fromAssignedToId) ?? null) : null,
        toAssignedTo: l.toAssignedToId ? (userById.get(l.toAssignedToId) ?? null) : null,
      })),
    );
  },
);

export default router;

