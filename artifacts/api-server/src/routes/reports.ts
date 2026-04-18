import { Router, type IRouter } from "express";
import { db, usersTable, ticketsTable, messagesTable, ratingsTable } from "@workspace/db";
import { eq, count, avg, sql, desc } from "drizzle-orm";
import { requireAuth, requireActive } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/reports/summary", requireAuth, requireActive, async (req, res): Promise<void> => {
  const [ticketCounts] = await db.select({
    total: count(),
    open: sql<number>`count(*) filter (where status = 'OPEN')`,
    inProgress: sql<number>`count(*) filter (where status = 'IN_PROGRESS')`,
    resolved: sql<number>`count(*) filter (where status = 'RESOLVED')`,
    closed: sql<number>`count(*) filter (where status = 'CLOSED')`,
  }).from(ticketsTable);

  const [userCounts] = await db.select({
    total: count(),
    pending: sql<number>`count(*) filter (where status = 'PENDING')`,
  }).from(usersTable);

  const [resolutionData] = await db.select({
    avg: sql<number>`avg(extract(epoch from (updated_at - created_at)) / 3600)`,
  }).from(ticketsTable).where(
    sql`status IN ('RESOLVED', 'CLOSED')`
  );

  const [ratingData] = await db.select({
    avg: avg(ratingsTable.score),
  }).from(ratingsTable);

  res.json({
    totalTickets: Number(ticketCounts.total),
    openTickets: Number(ticketCounts.open),
    inProgressTickets: Number(ticketCounts.inProgress),
    resolvedTickets: Number(ticketCounts.resolved),
    closedTickets: Number(ticketCounts.closed),
    totalUsers: Number(userCounts.total),
    pendingUsers: Number(userCounts.pending),
    avgResolutionHours: resolutionData.avg != null ? Number(resolutionData.avg) : null,
    avgRating: ratingData.avg != null ? Number(ratingData.avg) : null,
  });
});

router.get("/reports/by-status", requireAuth, requireActive, async (req, res): Promise<void> => {
  const rows = await db.select({
    status: ticketsTable.status,
    count: count(),
  }).from(ticketsTable).groupBy(ticketsTable.status);

  res.json(rows.map(r => ({ status: r.status, count: Number(r.count) })));
});

router.get("/reports/by-region", requireAuth, requireActive, async (req, res): Promise<void> => {
  const rows = await db.select({
    uf: ticketsTable.uf,
    count: count(),
  }).from(ticketsTable).groupBy(ticketsTable.uf).orderBy(desc(count()));

  res.json(rows.map(r => ({ uf: r.uf, count: Number(r.count) })));
});

router.get("/reports/by-type", requireAuth, requireActive, async (req, res): Promise<void> => {
  const rows = await db.select({
    type: ticketsTable.type,
    count: count(),
  }).from(ticketsTable).groupBy(ticketsTable.type);

  res.json(rows.map(r => ({ type: r.type, count: Number(r.count) })));
});

router.get("/reports/recent-activity", requireAuth, requireActive, async (req, res): Promise<void> => {
  const tickets = await db.query.ticketsTable.findMany({
    with: { createdBy: true },
    orderBy: [desc(ticketsTable.updatedAt)],
    limit: 20,
  });

  const activities = tickets.map((t, i) => ({
    id: i + 1,
    action: t.status === "OPEN" ? "Chamado aberto" :
            t.status === "IN_PROGRESS" ? "Chamado em andamento" :
            t.status === "RESOLVED" ? "Chamado resolvido" : "Chamado encerrado",
    ticketId: t.id,
    ticketTitle: t.title,
    userName: t.createdBy?.name ?? "Desconhecido",
    createdAt: t.updatedAt,
  }));

  res.json(activities);
});

export default router;
