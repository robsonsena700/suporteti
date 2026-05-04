import { Router, type IRouter } from "express";
import { db, usersTable, ticketsTable, ticketRatingsTable } from "@workspace/db";
import { eq, count, avg, sql, desc, inArray, and, asc } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";
import { requireAuth, requireActive } from "../middlewares/auth";
import { getManagedUserIdsByCoordinator } from "../lib/access";

const router: IRouter = Router();

function parseDateQuery(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function buildTicketDateRangeWhere(args: {
  from?: Date | null;
  to?: Date | null;
}): any | null {
  const { from, to } = args;
  if (!from && !to) return null;

  if (from && to) {
    return sql`(
      (${ticketsTable.createdAt} between ${from} and ${to})
      or
      (${ticketsTable.updatedAt} between ${from} and ${to})
    )`;
  }
  if (from) {
    return sql`(
      ${ticketsTable.createdAt} >= ${from}
      or
      ${ticketsTable.updatedAt} >= ${from}
    )`;
  }
  return sql`(
    ${ticketsTable.createdAt} <= ${to}
    or
    ${ticketsTable.updatedAt} <= ${to}
  )`;
}

function parsePositiveIntQuery(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseOptionalTicketStatus(value: unknown): string | null {
  if (value == null) return null;
  if (value === "OPEN" || value === "IN_PROGRESS" || value === "AWAITING_CUSTOMER" || value === "RESOLVED" || value === "CLOSED") {
    return value;
  }
  return null;
}

function parseOptionalTicketType(value: unknown): string | null {
  if (value == null) return null;
  if (value === "SOFTWARE" || value === "HARDWARE") return value;
  return null;
}

function parseOptionalTicketPriority(value: unknown): string | null {
  if (value == null) return null;
  if (value === "LOW" || value === "MEDIUM" || value === "HIGH") return value;
  return null;
}

async function buildReportTicketScopeWhere(user: any): Promise<any> {
  if (!user) return sql`false`;
  if (user.role === "USER") {
    return eq(ticketsTable.createdById, user.userId);
  }
  if (user.role === "COORDINATOR") {
    const managedUserIds = await getManagedUserIdsByCoordinator(user.userId);
    const allowedOwners = [user.userId, ...managedUserIds];
    return allowedOwners.length > 0 ? inArray(ticketsTable.createdById, allowedOwners) : sql`false`;
  }
  return sql`true`;
}

function timestampForFilename(date: Date = new Date()): string {
  const iso = date.toISOString(); // 2026-05-04T12:34:56.789Z
  return iso.replaceAll(":", "").replaceAll("-", "").replaceAll(".", "").replaceAll("T", "_").replaceAll("Z", "");
}

function safeFilename(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]+/g, "_");
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  const normalized = s.replaceAll("\r", " ").replaceAll("\n", " ").replaceAll("\"", "\"\"");
  return `"${normalized}"`;
}

async function buildTicketsPdfBuffer(args: {
  title: string;
  subtitle?: string | null;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontMono = await doc.embedFont(StandardFonts.Courier);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const marginX = 40;
  const marginY = 40;
  const lineHeight = 14;
  const headerFontSize = 16;
  const bodyFontSize = 10;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - marginY;

  const drawLine = (text: string, size: number, mono = false) => {
    page.drawText(text, {
      x: marginX,
      y: y - size,
      size,
      font: mono ? fontMono : font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= size + 8;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < marginY) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - marginY;
    }
  };

  drawLine(args.title, headerFontSize);
  if (args.subtitle) {
    ensureSpace(14);
    page.drawText(String(args.subtitle), {
      x: marginX,
      y: y - bodyFontSize,
      size: bodyFontSize,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    y -= bodyFontSize + 10;
  }

  ensureSpace(20);
  const headerLine = args.headers.join(" | ");
  page.drawText(headerLine, {
    x: marginX,
    y: y - bodyFontSize,
    size: bodyFontSize,
    font: fontMono,
    color: rgb(0, 0, 0),
  });
  y -= bodyFontSize + 8;

  page.drawLine({
    start: { x: marginX, y },
    end: { x: pageWidth - marginX, y },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 10;

  for (const row of args.rows) {
    const line = row.map((v) => String(v ?? "")).join(" | ");
    const maxChars = 140;
    const chunks: string[] = [];
    for (let i = 0; i < line.length; i += maxChars) chunks.push(line.slice(i, i + maxChars));

    for (const chunk of chunks) {
      ensureSpace(lineHeight + 10);
      page.drawText(chunk, {
        x: marginX,
        y: y - bodyFontSize,
        size: bodyFontSize,
        font: fontMono,
        color: rgb(0.15, 0.15, 0.15),
      });
      y -= lineHeight;
    }
    y -= 4;
  }

  return doc.save();
}

function buildXlsxBuffer(sheets: Array<{ name: string; rows: any[] }>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return out;
}

router.get("/reports/summary", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const isScoped = user.role === "USER" || user.role === "COORDINATOR";
  let ticketScopeWhere: any = sql`true`;
  let managedUserIds: number[] = [];

  const from = parseDateQuery(req.query.from);
  const to = parseDateQuery(req.query.to);
  if (req.query.from != null && from == null) {
    res.status(400).json({ error: "Data inicial inválida" });
    return;
  }
  if (req.query.to != null && to == null) {
    res.status(400).json({ error: "Data final inválida" });
    return;
  }
  if (from && to && from.getTime() > to.getTime()) {
    res.status(400).json({ error: "Data final não pode ser anterior à data inicial" });
    return;
  }
  const dateWhere = buildTicketDateRangeWhere({ from, to });

  if (user.role === "USER") {
    ticketScopeWhere = eq(ticketsTable.createdById, user.userId);
  } else if (user.role === "COORDINATOR") {
    managedUserIds = await getManagedUserIdsByCoordinator(user.userId);
    const allowedOwners = [user.userId, ...managedUserIds];
    ticketScopeWhere = allowedOwners.length > 0 ? inArray(ticketsTable.createdById, allowedOwners) : sql`false`;
  }

  const scopedTicketsWhere = dateWhere ? and(ticketScopeWhere, dateWhere) : ticketScopeWhere;

  const [ticketCounts] = await db.select({
    total: count(),
    open: sql<number>`count(*) filter (where status = 'OPEN')`,
    inProgress: sql<number>`count(*) filter (where status IN ('IN_PROGRESS', 'AWAITING_CUSTOMER'))`,
    resolved: sql<number>`count(*) filter (where status = 'RESOLVED')`,
    closed: sql<number>`count(*) filter (where status = 'CLOSED')`,
  }).from(ticketsTable).where(scopedTicketsWhere);

  const [userCounts] = user.role === "COORDINATOR"
    ? [{ total: managedUserIds.length, pending: 0 }]
    : await db.select({
      total: count(),
      pending: sql<number>`count(*) filter (where status = 'PENDING')`,
    }).from(usersTable);

  const [resolutionData] = await db.select({
    avg: sql<number>`avg(extract(epoch from (updated_at - created_at)) / 3600)`,
  }).from(ticketsTable).where(
    isScoped
      ? and(scopedTicketsWhere, sql`status IN ('RESOLVED', 'CLOSED')`)
      : (dateWhere ? and(dateWhere, sql`status IN ('RESOLVED', 'CLOSED')`) : sql`status IN ('RESOLVED', 'CLOSED')`)
  );

  let ratingScopeWhere: any = sql`true`;
  if (user.role === "USER") {
    ratingScopeWhere = eq(ticketsTable.createdById, user.userId);
  } else if (user.role === "ANALYST") {
    ratingScopeWhere = eq(ticketsTable.assignedToId, user.userId);
  } else if (user.role === "COORDINATOR") {
    const allowedTechnicians = [user.userId, ...managedUserIds];
    ratingScopeWhere = allowedTechnicians.length > 0 ? inArray(ticketsTable.assignedToId, allowedTechnicians) : sql`false`;
  }

  const scopedRatingWhere = dateWhere ? and(ratingScopeWhere, dateWhere) : ratingScopeWhere;

  const [ratingData] = await db
    .select({ avg: avg(ticketRatingsTable.rating) })
    .from(ticketRatingsTable)
    .leftJoin(ticketsTable, eq(ticketsTable.id, ticketRatingsTable.ticketId))
    .where(scopedRatingWhere);

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
  const user = req.user!;
  const from = parseDateQuery(req.query.from);
  const to = parseDateQuery(req.query.to);
  if (req.query.from != null && from == null) {
    res.status(400).json({ error: "Data inicial inválida" });
    return;
  }
  if (req.query.to != null && to == null) {
    res.status(400).json({ error: "Data final inválida" });
    return;
  }
  if (from && to && from.getTime() > to.getTime()) {
    res.status(400).json({ error: "Data final não pode ser anterior à data inicial" });
    return;
  }
  const dateWhere = buildTicketDateRangeWhere({ from, to });

  const scopeWhere = await buildReportTicketScopeWhere(user);
  const where = dateWhere ? and(scopeWhere, dateWhere) : scopeWhere;

  const rows = await db.select({
    status: ticketsTable.status,
    count: count(),
  }).from(ticketsTable).where(where).groupBy(ticketsTable.status);

  res.json(rows.map(r => ({ status: r.status, count: Number(r.count) })));
});

router.get("/reports/by-region", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const from = parseDateQuery(req.query.from);
  const to = parseDateQuery(req.query.to);
  if (req.query.from != null && from == null) {
    res.status(400).json({ error: "Data inicial inválida" });
    return;
  }
  if (req.query.to != null && to == null) {
    res.status(400).json({ error: "Data final inválida" });
    return;
  }
  if (from && to && from.getTime() > to.getTime()) {
    res.status(400).json({ error: "Data final não pode ser anterior à data inicial" });
    return;
  }
  const dateWhere = buildTicketDateRangeWhere({ from, to });

  const scopeWhere = await buildReportTicketScopeWhere(user);
  const where = dateWhere ? and(scopeWhere, dateWhere) : scopeWhere;

  const rows = await db.select({
    uf: ticketsTable.uf,
    count: count(),
  }).from(ticketsTable).where(where).groupBy(ticketsTable.uf).orderBy(desc(count()));

  res.json(rows.map(r => ({ uf: r.uf, count: Number(r.count) })));
});

router.get("/reports/by-type", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const from = parseDateQuery(req.query.from);
  const to = parseDateQuery(req.query.to);
  if (req.query.from != null && from == null) {
    res.status(400).json({ error: "Data inicial inválida" });
    return;
  }
  if (req.query.to != null && to == null) {
    res.status(400).json({ error: "Data final inválida" });
    return;
  }
  if (from && to && from.getTime() > to.getTime()) {
    res.status(400).json({ error: "Data final não pode ser anterior à data inicial" });
    return;
  }
  const dateWhere = buildTicketDateRangeWhere({ from, to });

  const scopeWhere = await buildReportTicketScopeWhere(user);
  const where = dateWhere ? and(scopeWhere, dateWhere) : scopeWhere;

  const rows = await db.select({
    type: ticketsTable.type,
    count: count(),
  }).from(ticketsTable).where(where).groupBy(ticketsTable.type);

  res.json(rows.map(r => ({ type: r.type, count: Number(r.count) })));
});

router.get("/reports/recent-activity", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  let ticketScopeWhere: any = sql`true`;

  const from = parseDateQuery(req.query.from);
  const to = parseDateQuery(req.query.to);
  if (req.query.from != null && from == null) {
    res.status(400).json({ error: "Data inicial inválida" });
    return;
  }
  if (req.query.to != null && to == null) {
    res.status(400).json({ error: "Data final inválida" });
    return;
  }
  if (from && to && from.getTime() > to.getTime()) {
    res.status(400).json({ error: "Data final não pode ser anterior à data inicial" });
    return;
  }
  const dateWhere = buildTicketDateRangeWhere({ from, to });

  if (user.role === "USER") {
    ticketScopeWhere = eq(ticketsTable.createdById, user.userId);
  } else if (user.role === "COORDINATOR") {
    const managedUserIds = await getManagedUserIdsByCoordinator(user.userId);
    const allowedOwners = [user.userId, ...managedUserIds];
    ticketScopeWhere = allowedOwners.length > 0 ? inArray(ticketsTable.createdById, allowedOwners) : sql`false`;
  }

  const scopedTicketsWhere = dateWhere ? and(ticketScopeWhere, dateWhere) : ticketScopeWhere;

  const tickets = await db.query.ticketsTable.findMany({
    where: scopedTicketsWhere,
    with: { createdBy: true },
    orderBy: [desc(ticketsTable.updatedAt)],
    limit: 20,
  });

  const activities = tickets.map((t, i) => ({
    id: i + 1,
    action: t.status === "OPEN" ? "Chamado aberto" :
            t.status === "IN_PROGRESS" ? "Chamado em andamento" :
            t.status === "AWAITING_CUSTOMER" ? "Aguardando cliente" :
            t.status === "RESOLVED" ? "Chamado resolvido" : "Chamado cancelado",
    ticketId: t.id,
    ticketTitle: t.title,
    userName: t.createdBy?.name ?? "Desconhecido",
    createdAt: t.updatedAt,
  }));

  res.json(activities);
});

router.get("/reports/users/stats", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const from = parseDateQuery(req.query.from);
  const to = parseDateQuery(req.query.to);
  if (req.query.from != null && from == null) {
    res.status(400).json({ error: "Data inicial inválida" });
    return;
  }
  if (req.query.to != null && to == null) {
    res.status(400).json({ error: "Data final inválida" });
    return;
  }
  if (from && to && from.getTime() > to.getTime()) {
    res.status(400).json({ error: "Data final não pode ser anterior à data inicial" });
    return;
  }
  const dateWhere = buildTicketDateRangeWhere({ from, to });
  const scopeWhere = await buildReportTicketScopeWhere(user);
  const where = dateWhere ? and(scopeWhere, dateWhere) : scopeWhere;

  const rows = await db
    .select({
      userId: ticketsTable.createdById,
      userName: usersTable.name,
      userEmail: usersTable.email,
      userRole: usersTable.role,
      totalTickets: count(),
      openTickets: sql<number>`count(*) filter (where ${ticketsTable.status} = 'OPEN')`,
      inProgressTickets: sql<number>`count(*) filter (where ${ticketsTable.status} IN ('IN_PROGRESS', 'AWAITING_CUSTOMER'))`,
      resolvedTickets: sql<number>`count(*) filter (where ${ticketsTable.status} = 'RESOLVED')`,
      closedTickets: sql<number>`count(*) filter (where ${ticketsTable.status} = 'CLOSED')`,
      highPriorityOpen: sql<number>`count(*) filter (where ${ticketsTable.priority} = 'HIGH' and ${ticketsTable.status} IN ('OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER'))`,
      mediumPriorityOpen: sql<number>`count(*) filter (where ${ticketsTable.priority} = 'MEDIUM' and ${ticketsTable.status} IN ('OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER'))`,
      lowPriorityOpen: sql<number>`count(*) filter (where ${ticketsTable.priority} = 'LOW' and ${ticketsTable.status} IN ('OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER'))`,
      avgResolutionHours: sql<number | null>`avg(extract(epoch from (${ticketsTable.updatedAt} - ${ticketsTable.createdAt})) / 3600) filter (where ${ticketsTable.status} IN ('RESOLVED', 'CLOSED'))`,
      avgRating: avg(ticketRatingsTable.rating),
    })
    .from(ticketsTable)
    .leftJoin(usersTable, eq(usersTable.id, ticketsTable.createdById))
    .leftJoin(ticketRatingsTable, eq(ticketRatingsTable.ticketId, ticketsTable.id))
    .where(where)
    .groupBy(ticketsTable.createdById, usersTable.name, usersTable.email, usersTable.role)
    .orderBy(desc(count()));

  res.json(rows.map((r) => ({
    user: {
      id: r.userId,
      name: r.userName ?? "—",
      email: r.userEmail ?? "—",
      role: r.userRole ?? "USER",
    },
    totalTickets: Number(r.totalTickets),
    openTickets: Number(r.openTickets),
    inProgressTickets: Number(r.inProgressTickets),
    resolvedTickets: Number(r.resolvedTickets),
    closedTickets: Number(r.closedTickets),
    priorityOpen: {
      high: Number(r.highPriorityOpen),
      medium: Number(r.mediumPriorityOpen),
      low: Number(r.lowPriorityOpen),
    },
    avgResolutionHours: r.avgResolutionHours != null ? Number(r.avgResolutionHours) : null,
    avgRating: r.avgRating != null ? Number(r.avgRating) : null,
  })));
});

router.get("/reports/users/ranking", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const from = parseDateQuery(req.query.from);
  const to = parseDateQuery(req.query.to);
  if (req.query.from != null && from == null) {
    res.status(400).json({ error: "Data inicial inválida" });
    return;
  }
  if (req.query.to != null && to == null) {
    res.status(400).json({ error: "Data final inválida" });
    return;
  }
  if (from && to && from.getTime() > to.getTime()) {
    res.status(400).json({ error: "Data final não pode ser anterior à data inicial" });
    return;
  }
  const order = typeof req.query.order === "string" ? req.query.order : "volume";
  const dateWhere = buildTicketDateRangeWhere({ from, to });
  const scopeWhere = await buildReportTicketScopeWhere(user);
  const where = dateWhere ? and(scopeWhere, dateWhere) : scopeWhere;

  const rows = await db
    .select({
      userId: ticketsTable.createdById,
      userName: usersTable.name,
      userEmail: usersTable.email,
      userRole: usersTable.role,
      totalTickets: count(),
      avgResolutionHours: sql<number | null>`avg(extract(epoch from (${ticketsTable.updatedAt} - ${ticketsTable.createdAt})) / 3600) filter (where ${ticketsTable.status} IN ('RESOLVED', 'CLOSED'))`,
      avgRating: avg(ticketRatingsTable.rating),
    })
    .from(ticketsTable)
    .leftJoin(usersTable, eq(usersTable.id, ticketsTable.createdById))
    .leftJoin(ticketRatingsTable, eq(ticketRatingsTable.ticketId, ticketsTable.id))
    .where(where)
    .groupBy(ticketsTable.createdById, usersTable.name, usersTable.email, usersTable.role);

  const normalized = rows.map((r) => ({
    user: {
      id: r.userId,
      name: r.userName ?? "—",
      email: r.userEmail ?? "—",
      role: r.userRole ?? "USER",
    },
    totalTickets: Number(r.totalTickets),
    avgResolutionHours: r.avgResolutionHours != null ? Number(r.avgResolutionHours) : null,
    avgRating: r.avgRating != null ? Number(r.avgRating) : null,
  }));

  const sorted = normalized.sort((a, b) => {
    if (order === "resolution") {
      const av = a.avgResolutionHours;
      const bv = b.avgResolutionHours;
      if (av == null && bv == null) return b.totalTickets - a.totalTickets;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av !== bv) return av - bv;
      return b.totalTickets - a.totalTickets;
    }
    if (order === "satisfaction") {
      const av = a.avgRating;
      const bv = b.avgRating;
      if (av == null && bv == null) return b.totalTickets - a.totalTickets;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av !== bv) return bv - av;
      return b.totalTickets - a.totalTickets;
    }
    if (b.totalTickets !== a.totalTickets) return b.totalTickets - a.totalTickets;
    const ar = a.avgResolutionHours ?? Number.POSITIVE_INFINITY;
    const br = b.avgResolutionHours ?? Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    const as = a.avgRating ?? -1;
    const bs = b.avgRating ?? -1;
    return bs - as;
  });

  const maxTotal = sorted.reduce((acc, r) => Math.max(acc, r.totalTickets), 0);
  const minResolution = sorted.reduce((acc, r) => {
    if (r.avgResolutionHours == null) return acc;
    return Math.min(acc, r.avgResolutionHours);
  }, Number.POSITIVE_INFINITY);
  const maxRating = sorted.reduce((acc, r) => Math.max(acc, r.avgRating ?? 0), 0);

  res.json(sorted.map((r) => {
    const badges: string[] = [];
    if (maxTotal > 0 && r.totalTickets === maxTotal) badges.push("TOP_VOLUME");
    if (Number.isFinite(minResolution) && r.avgResolutionHours != null && r.avgResolutionHours === minResolution) badges.push("MAIS_RAPIDO");
    if (maxRating > 0 && r.avgRating != null && r.avgRating === maxRating) badges.push("MELHOR_SATISFACAO");
    if ((r.avgRating ?? 0) >= 4.5) badges.push("ALTA_SATISFACAO");
    if (r.avgResolutionHours != null && r.avgResolutionHours <= 24) badges.push("RESOLUCAO_RAPIDA");

    return { ...r, badges };
  }));
});

router.get("/reports/tickets", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const from = parseDateQuery(req.query.from);
  const to = parseDateQuery(req.query.to);
  if (req.query.from != null && from == null) {
    res.status(400).json({ error: "Data inicial inválida" });
    return;
  }
  if (req.query.to != null && to == null) {
    res.status(400).json({ error: "Data final inválida" });
    return;
  }
  if (from && to && from.getTime() > to.getTime()) {
    res.status(400).json({ error: "Data final não pode ser anterior à data inicial" });
    return;
  }

  const status = parseOptionalTicketStatus(req.query.status);
  if (req.query.status != null && !status) {
    res.status(400).json({ error: "Status inválido" });
    return;
  }
  const type = parseOptionalTicketType(req.query.type);
  if (req.query.type != null && !type) {
    res.status(400).json({ error: "Categoria inválida" });
    return;
  }
  const priority = parseOptionalTicketPriority(req.query.priority);
  if (req.query.priority != null && !priority) {
    res.status(400).json({ error: "Prioridade inválida" });
    return;
  }

  const page = parsePositiveIntQuery(req.query.page) ?? 1;
  const pageSizeRaw = parsePositiveIntQuery(req.query.pageSize) ?? 10;
  const pageSize = Math.min(Math.max(pageSizeRaw, 5), 50);

  const whereClauses: any[] = [];
  whereClauses.push(await buildReportTicketScopeWhere(user));
  const dateWhere = buildTicketDateRangeWhere({ from, to });
  if (dateWhere) whereClauses.push(dateWhere);
  if (status) whereClauses.push(eq(ticketsTable.status, status as any));
  if (type) whereClauses.push(eq(ticketsTable.type, type as any));
  if (priority) whereClauses.push(eq(ticketsTable.priority, priority as any));
  const where = and(...whereClauses);

  const [countRow] = await db.select({ total: count() }).from(ticketsTable).where(where);
  const total = Number(countRow?.total ?? 0);
  const offset = (page - 1) * pageSize;

  const items = await db.query.ticketsTable.findMany({
    where,
    with: {
      createdBy: true,
      assignedTo: true,
    },
    orderBy: [desc(ticketsTable.updatedAt)],
    limit: pageSize,
    offset,
  });

  res.json({
    page,
    pageSize,
    total,
    items: items.map((t) => ({
      id: t.id,
      title: t.title,
      type: t.type,
      status: t.status,
      priority: t.priority,
      uf: t.uf,
      municipality: t.municipality,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      createdBy: t.createdBy ? {
        id: t.createdBy.id,
        name: t.createdBy.name,
        email: t.createdBy.email,
        role: t.createdBy.role,
      } : null,
      assignedTo: t.assignedTo ? {
        id: t.assignedTo.id,
        name: t.assignedTo.name,
        email: t.assignedTo.email,
        role: t.assignedTo.role,
      } : null,
    })),
  });
});

router.get("/reports/tickets/trends", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const from = parseDateQuery(req.query.from);
  const to = parseDateQuery(req.query.to);
  if (req.query.from != null && from == null) {
    res.status(400).json({ error: "Data inicial inválida" });
    return;
  }
  if (req.query.to != null && to == null) {
    res.status(400).json({ error: "Data final inválida" });
    return;
  }
  if (from && to && from.getTime() > to.getTime()) {
    res.status(400).json({ error: "Data final não pode ser anterior à data inicial" });
    return;
  }
  if (!from || !to) {
    res.json({ created: [], updated: [] });
    return;
  }

  const status = parseOptionalTicketStatus(req.query.status);
  if (req.query.status != null && !status) {
    res.status(400).json({ error: "Status inválido" });
    return;
  }
  const type = parseOptionalTicketType(req.query.type);
  if (req.query.type != null && !type) {
    res.status(400).json({ error: "Categoria inválida" });
    return;
  }
  const priority = parseOptionalTicketPriority(req.query.priority);
  if (req.query.priority != null && !priority) {
    res.status(400).json({ error: "Prioridade inválida" });
    return;
  }

  const baseWhereClauses: any[] = [];
  baseWhereClauses.push(await buildReportTicketScopeWhere(user));
  if (status) baseWhereClauses.push(eq(ticketsTable.status, status as any));
  if (type) baseWhereClauses.push(eq(ticketsTable.type, type as any));
  if (priority) baseWhereClauses.push(eq(ticketsTable.priority, priority as any));
  const baseWhere = and(...baseWhereClauses);

  const createdRows = await db.select({
    day: sql<string>`to_char(date_trunc('day', ${ticketsTable.createdAt}), 'YYYY-MM-DD')`,
    count: count(),
  }).from(ticketsTable).where(and(baseWhere, sql`${ticketsTable.createdAt} between ${from} and ${to}`)).groupBy(sql`date_trunc('day', ${ticketsTable.createdAt})`).orderBy(asc(sql`date_trunc('day', ${ticketsTable.createdAt})`));

  const updatedRows = await db.select({
    day: sql<string>`to_char(date_trunc('day', ${ticketsTable.updatedAt}), 'YYYY-MM-DD')`,
    count: count(),
  }).from(ticketsTable).where(and(baseWhere, sql`${ticketsTable.updatedAt} between ${from} and ${to}`)).groupBy(sql`date_trunc('day', ${ticketsTable.updatedAt})`).orderBy(asc(sql`date_trunc('day', ${ticketsTable.updatedAt})`));

  res.json({
    created: createdRows.map((r) => ({ day: r.day, count: Number(r.count) })),
    updated: updatedRows.map((r) => ({ day: r.day, count: Number(r.count) })),
  });
});

router.get("/reports/export", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const from = parseDateQuery(req.query.from);
  const to = parseDateQuery(req.query.to);
  if (req.query.from != null && from == null) {
    res.status(400).json({ error: "Data inicial inválida" });
    return;
  }
  if (req.query.to != null && to == null) {
    res.status(400).json({ error: "Data final inválida" });
    return;
  }
  if (from && to && from.getTime() > to.getTime()) {
    res.status(400).json({ error: "Data final não pode ser anterior à data inicial" });
    return;
  }

  const order = typeof req.query.order === "string" ? req.query.order : "volume";
  const status = parseOptionalTicketStatus(req.query.status);
  if (req.query.status != null && !status) {
    res.status(400).json({ error: "Status inválido" });
    return;
  }
  const type = parseOptionalTicketType(req.query.type);
  if (req.query.type != null && !type) {
    res.status(400).json({ error: "Categoria inválida" });
    return;
  }
  const priority = parseOptionalTicketPriority(req.query.priority);
  if (req.query.priority != null && !priority) {
    res.status(400).json({ error: "Prioridade inválida" });
    return;
  }

  const dateWhere = buildTicketDateRangeWhere({ from, to });
  const scopeWhere = await buildReportTicketScopeWhere(user);
  const ticketsBaseWhere = dateWhere ? and(scopeWhere, dateWhere) : scopeWhere;

  const [summaryCounts] = await db.select({
    total: count(),
    open: sql<number>`count(*) filter (where status = 'OPEN')`,
    inProgress: sql<number>`count(*) filter (where status IN ('IN_PROGRESS', 'AWAITING_CUSTOMER'))`,
    resolved: sql<number>`count(*) filter (where status = 'RESOLVED')`,
    closed: sql<number>`count(*) filter (where status = 'CLOSED')`,
  }).from(ticketsTable).where(ticketsBaseWhere);

  const [resolutionData] = await db.select({
    avg: sql<number>`avg(extract(epoch from (updated_at - created_at)) / 3600)`,
  }).from(ticketsTable).where(and(ticketsBaseWhere, sql`status IN ('RESOLVED', 'CLOSED')`));

  const [ratingData] = await db
    .select({ avg: avg(ticketRatingsTable.rating) })
    .from(ticketRatingsTable)
    .leftJoin(ticketsTable, eq(ticketsTable.id, ticketRatingsTable.ticketId))
    .where(ticketsBaseWhere);

  const statusCounts = await db.select({
    status: ticketsTable.status,
    count: count(),
  }).from(ticketsTable).where(ticketsBaseWhere).groupBy(ticketsTable.status);

  const typeCounts = await db.select({
    type: ticketsTable.type,
    count: count(),
  }).from(ticketsTable).where(ticketsBaseWhere).groupBy(ticketsTable.type);

  const regionCounts = await db.select({
    uf: ticketsTable.uf,
    count: count(),
  }).from(ticketsTable).where(ticketsBaseWhere).groupBy(ticketsTable.uf).orderBy(desc(count()));

  const userStatsRows = await db
    .select({
      userId: ticketsTable.createdById,
      userName: usersTable.name,
      userEmail: usersTable.email,
      userRole: usersTable.role,
      totalTickets: count(),
      openTickets: sql<number>`count(*) filter (where ${ticketsTable.status} = 'OPEN')`,
      inProgressTickets: sql<number>`count(*) filter (where ${ticketsTable.status} IN ('IN_PROGRESS', 'AWAITING_CUSTOMER'))`,
      resolvedTickets: sql<number>`count(*) filter (where ${ticketsTable.status} = 'RESOLVED')`,
      closedTickets: sql<number>`count(*) filter (where ${ticketsTable.status} = 'CLOSED')`,
      avgResolutionHours: sql<number | null>`avg(extract(epoch from (${ticketsTable.updatedAt} - ${ticketsTable.createdAt})) / 3600) filter (where ${ticketsTable.status} IN ('RESOLVED', 'CLOSED'))`,
      avgRating: avg(ticketRatingsTable.rating),
    })
    .from(ticketsTable)
    .leftJoin(usersTable, eq(usersTable.id, ticketsTable.createdById))
    .leftJoin(ticketRatingsTable, eq(ticketRatingsTable.ticketId, ticketsTable.id))
    .where(ticketsBaseWhere)
    .groupBy(ticketsTable.createdById, usersTable.name, usersTable.email, usersTable.role);

  const ranking = userStatsRows.map((r) => ({
    userId: r.userId,
    userName: r.userName ?? "—",
    userEmail: r.userEmail ?? "—",
    userRole: r.userRole ?? "USER",
    totalTickets: Number(r.totalTickets),
    avgResolutionHours: r.avgResolutionHours != null ? Number(r.avgResolutionHours) : null,
    avgRating: r.avgRating != null ? Number(r.avgRating) : null,
  })).sort((a, b) => {
    if (order === "resolution") {
      const av = a.avgResolutionHours;
      const bv = b.avgResolutionHours;
      if (av == null && bv == null) return b.totalTickets - a.totalTickets;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av !== bv) return av - bv;
      return b.totalTickets - a.totalTickets;
    }
    if (order === "satisfaction") {
      const av = a.avgRating;
      const bv = b.avgRating;
      if (av == null && bv == null) return b.totalTickets - a.totalTickets;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av !== bv) return bv - av;
      return b.totalTickets - a.totalTickets;
    }
    if (b.totalTickets !== a.totalTickets) return b.totalTickets - a.totalTickets;
    const ar = a.avgResolutionHours ?? Number.POSITIVE_INFINITY;
    const br = b.avgResolutionHours ?? Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    const as = a.avgRating ?? -1;
    const bs = b.avgRating ?? -1;
    return bs - as;
  });

  const ticketsWhereClauses: any[] = [ticketsBaseWhere];
  if (status) ticketsWhereClauses.push(eq(ticketsTable.status, status as any));
  if (type) ticketsWhereClauses.push(eq(ticketsTable.type, type as any));
  if (priority) ticketsWhereClauses.push(eq(ticketsTable.priority, priority as any));
  const ticketsWhere = and(...ticketsWhereClauses);

  const exportLimit = 5000;
  const tickets = await db.query.ticketsTable.findMany({
    where: ticketsWhere,
    with: { createdBy: true, assignedTo: true },
    orderBy: [desc(ticketsTable.updatedAt)],
    limit: exportLimit,
  });

  let trendsCreated: Array<{ day: string; count: number }> = [];
  let trendsUpdated: Array<{ day: string; count: number }> = [];
  if (from && to) {
    const trendWhereClauses: any[] = [await buildReportTicketScopeWhere(user)];
    if (status) trendWhereClauses.push(eq(ticketsTable.status, status as any));
    if (type) trendWhereClauses.push(eq(ticketsTable.type, type as any));
    if (priority) trendWhereClauses.push(eq(ticketsTable.priority, priority as any));
    const trendBaseWhere = and(...trendWhereClauses);

    const createdRows = await db.select({
      day: sql<string>`to_char(date_trunc('day', ${ticketsTable.createdAt}), 'YYYY-MM-DD')`,
      count: count(),
    }).from(ticketsTable).where(and(trendBaseWhere, sql`${ticketsTable.createdAt} between ${from} and ${to}`)).groupBy(sql`date_trunc('day', ${ticketsTable.createdAt})`).orderBy(asc(sql`date_trunc('day', ${ticketsTable.createdAt})`));

    const updatedRows = await db.select({
      day: sql<string>`to_char(date_trunc('day', ${ticketsTable.updatedAt}), 'YYYY-MM-DD')`,
      count: count(),
    }).from(ticketsTable).where(and(trendBaseWhere, sql`${ticketsTable.updatedAt} between ${from} and ${to}`)).groupBy(sql`date_trunc('day', ${ticketsTable.updatedAt})`).orderBy(asc(sql`date_trunc('day', ${ticketsTable.updatedAt})`));

    trendsCreated = createdRows.map((r) => ({ day: r.day, count: Number(r.count) }));
    trendsUpdated = updatedRows.map((r) => ({ day: r.day, count: Number(r.count) }));
  }

  const format = typeof req.query.format === "string" ? req.query.format : "pdf";
  const ts = timestampForFilename();

  const periodLabel =
    from && to ? `${from.toISOString()} até ${to.toISOString()}` :
    from ? `A partir de ${from.toISOString()}` :
    to ? `Até ${to.toISOString()}` :
    "Sem filtro de período";

  const filterLabel = [
    `Período: ${periodLabel}`,
    status ? `Status: ${status}` : null,
    type ? `Categoria: ${type}` : null,
    priority ? `Prioridade: ${priority}` : null,
    `Ranking: ${order}`,
  ].filter(Boolean).join(" | ");

  if (format === "print") {
    const escapeHtml = (value: unknown) => {
      const s = String(value ?? "");
      return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
    };

    const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Relatórios</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
    h1 { font-size: 18px; margin: 0 0 10px; }
    h2 { font-size: 14px; margin: 18px 0 8px; }
    .muted { color: #555; font-size: 12px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; }
    th, td { border: 1px solid #ddd; padding: 8px; font-size: 11px; text-align: left; vertical-align: top; }
    th { background: #f6f6f6; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>Relatórios</h1>
  <div class="muted">${escapeHtml(filterLabel)}</div>

  <h2>Resumo</h2>
  <table>
    <tbody>
      <tr><th>Total</th><td>${escapeHtml(Number(summaryCounts.total))}</td></tr>
      <tr><th>Abertos</th><td>${escapeHtml(Number(summaryCounts.open))}</td></tr>
      <tr><th>Em andamento</th><td>${escapeHtml(Number(summaryCounts.inProgress))}</td></tr>
      <tr><th>Resolvidos</th><td>${escapeHtml(Number(summaryCounts.resolved))}</td></tr>
      <tr><th>Cancelados</th><td>${escapeHtml(Number(summaryCounts.closed))}</td></tr>
      <tr><th>Média de resolução (h)</th><td>${escapeHtml(resolutionData.avg != null ? Number(resolutionData.avg).toFixed(2) : "—")}</td></tr>
      <tr><th>Média de avaliação</th><td>${escapeHtml(ratingData.avg != null ? Number(ratingData.avg).toFixed(2) : "—")}</td></tr>
    </tbody>
  </table>

  <h2>Chamados por status</h2>
  <table>
    <thead><tr><th>Status</th><th>Quantidade</th></tr></thead>
    <tbody>${statusCounts.map((r) => `<tr><td>${escapeHtml(r.status)}</td><td>${escapeHtml(Number(r.count))}</td></tr>`).join("")}</tbody>
  </table>

  <h2>Chamados por tipo</h2>
  <table>
    <thead><tr><th>Tipo</th><th>Quantidade</th></tr></thead>
    <tbody>${typeCounts.map((r) => `<tr><td>${escapeHtml(r.type)}</td><td>${escapeHtml(Number(r.count))}</td></tr>`).join("")}</tbody>
  </table>

  <h2>Chamados por UF</h2>
  <table>
    <thead><tr><th>UF</th><th>Quantidade</th></tr></thead>
    <tbody>${regionCounts.map((r) => `<tr><td>${escapeHtml(r.uf)}</td><td>${escapeHtml(Number(r.count))}</td></tr>`).join("")}</tbody>
  </table>

  <h2>Ranking (Top 10)</h2>
  <table>
    <thead><tr><th>Usuário</th><th>Chamados</th><th>Resolução (h)</th><th>Satisfação</th></tr></thead>
    <tbody>${ranking.slice(0, 10).map((r) => `<tr><td>${escapeHtml(r.userName)}</td><td>${escapeHtml(r.totalTickets)}</td><td>${escapeHtml(r.avgResolutionHours == null ? "—" : r.avgResolutionHours.toFixed(1))}</td><td>${escapeHtml(r.avgRating == null ? "—" : r.avgRating.toFixed(2))}</td></tr>`).join("")}</tbody>
  </table>

  <h2>Tendências</h2>
  <table>
    <thead><tr><th>Dia</th><th>Criados</th><th>Atualizados</th></tr></thead>
    <tbody>
      ${Array.from(new Set([...trendsCreated.map((p) => p.day), ...trendsUpdated.map((p) => p.day)]))
        .sort()
        .map((d) => {
          const c = trendsCreated.find((p) => p.day === d)?.count ?? 0;
          const u = trendsUpdated.find((p) => p.day === d)?.count ?? 0;
          return `<tr><td>${escapeHtml(d)}</td><td>${escapeHtml(c)}</td><td>${escapeHtml(u)}</td></tr>`;
        }).join("")}
    </tbody>
  </table>

  <h2>Chamados (limitado a ${exportLimit})</h2>
  <table>
    <thead><tr><th>ID</th><th>Título</th><th>Status</th><th>Prioridade</th><th>Tipo</th><th>Solicitante</th><th>Responsável</th><th>Atualizado</th></tr></thead>
    <tbody>
      ${tickets.map((t) => `<tr><td>${escapeHtml(t.id)}</td><td>${escapeHtml(t.title)}</td><td>${escapeHtml(t.status)}</td><td>${escapeHtml(t.priority)}</td><td>${escapeHtml(t.type)}</td><td>${escapeHtml(t.createdBy?.name ?? "")}</td><td>${escapeHtml(t.assignedTo?.name ?? "")}</td><td>${escapeHtml(t.updatedAt.toISOString())}</td></tr>`).join("")}
    </tbody>
  </table>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
    return;
  }

  if (format === "csv") {
    const sep = ";";
    const lines: string[] = [];
    lines.push([csvEscape("Relatórios"), csvEscape(filterLabel)].join(sep));
    lines.push("");

    lines.push(csvEscape("Resumo"));
    lines.push([csvEscape("Campo"), csvEscape("Valor")].join(sep));
    lines.push([csvEscape("Total"), csvEscape(Number(summaryCounts.total))].join(sep));
    lines.push([csvEscape("Abertos"), csvEscape(Number(summaryCounts.open))].join(sep));
    lines.push([csvEscape("Em andamento"), csvEscape(Number(summaryCounts.inProgress))].join(sep));
    lines.push([csvEscape("Resolvidos"), csvEscape(Number(summaryCounts.resolved))].join(sep));
    lines.push([csvEscape("Cancelados"), csvEscape(Number(summaryCounts.closed))].join(sep));
    lines.push([csvEscape("Média de resolução (h)"), csvEscape(resolutionData.avg != null ? Number(resolutionData.avg).toFixed(2) : "")].join(sep));
    lines.push([csvEscape("Média de avaliação"), csvEscape(ratingData.avg != null ? Number(ratingData.avg).toFixed(2) : "")].join(sep));

    lines.push("");
    lines.push(csvEscape("Chamados por status"));
    lines.push([csvEscape("Status"), csvEscape("Quantidade")].join(sep));
    statusCounts.forEach((r) => lines.push([csvEscape(r.status), csvEscape(Number(r.count))].join(sep)));

    lines.push("");
    lines.push(csvEscape("Chamados por tipo"));
    lines.push([csvEscape("Tipo"), csvEscape("Quantidade")].join(sep));
    typeCounts.forEach((r) => lines.push([csvEscape(r.type), csvEscape(Number(r.count))].join(sep)));

    lines.push("");
    lines.push(csvEscape("Chamados por UF"));
    lines.push([csvEscape("UF"), csvEscape("Quantidade")].join(sep));
    regionCounts.forEach((r) => lines.push([csvEscape(r.uf), csvEscape(Number(r.count))].join(sep)));

    lines.push("");
    lines.push(csvEscape("Ranking"));
    lines.push([csvEscape("Usuário"), csvEscape("Chamados"), csvEscape("Resolução (h)"), csvEscape("Satisfação")].join(sep));
    ranking.forEach((r) => lines.push([csvEscape(r.userName), csvEscape(r.totalTickets), csvEscape(r.avgResolutionHours ?? ""), csvEscape(r.avgRating ?? "")].join(sep)));

    lines.push("");
    lines.push(csvEscape("Tendências"));
    lines.push([csvEscape("Dia"), csvEscape("Criados"), csvEscape("Atualizados")].join(sep));
    Array.from(new Set([...trendsCreated.map((p) => p.day), ...trendsUpdated.map((p) => p.day)]))
      .sort()
      .forEach((d) => {
        const c = trendsCreated.find((p) => p.day === d)?.count ?? 0;
        const u = trendsUpdated.find((p) => p.day === d)?.count ?? 0;
        lines.push([csvEscape(d), csvEscape(c), csvEscape(u)].join(sep));
      });

    lines.push("");
    lines.push(csvEscape(`Chamados (limitado a ${exportLimit})`));
    lines.push([csvEscape("ID"), csvEscape("Título"), csvEscape("Status"), csvEscape("Prioridade"), csvEscape("Tipo"), csvEscape("Solicitante"), csvEscape("Responsável"), csvEscape("Atualizado em")].join(sep));
    tickets.forEach((t) => {
      lines.push([
        csvEscape(t.id),
        csvEscape(t.title),
        csvEscape(t.status),
        csvEscape(t.priority),
        csvEscape(t.type),
        csvEscape(t.createdBy?.name ?? ""),
        csvEscape(t.assignedTo?.name ?? ""),
        csvEscape(t.updatedAt.toISOString()),
      ].join(sep));
    });

    const csv = `\uFEFF${lines.join("\r\n")}`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(`relatorios_${ts}.csv`)}"`);
    res.status(200).send(csv);
    return;
  }

  if (format === "xlsx") {
    const xlsx = buildXlsxBuffer([
      {
        name: "Resumo",
        rows: [
          { Campo: "Total", Valor: Number(summaryCounts.total) },
          { Campo: "Abertos", Valor: Number(summaryCounts.open) },
          { Campo: "Em andamento", Valor: Number(summaryCounts.inProgress) },
          { Campo: "Resolvidos", Valor: Number(summaryCounts.resolved) },
          { Campo: "Cancelados", Valor: Number(summaryCounts.closed) },
          { Campo: "Média de resolução (h)", Valor: resolutionData.avg != null ? Number(resolutionData.avg) : null },
          { Campo: "Média de avaliação", Valor: ratingData.avg != null ? Number(ratingData.avg) : null },
        ],
      },
      {
        name: "Por status",
        rows: statusCounts.map((r) => ({ Status: r.status, Quantidade: Number(r.count) })),
      },
      {
        name: "Por tipo",
        rows: typeCounts.map((r) => ({ Tipo: r.type, Quantidade: Number(r.count) })),
      },
      {
        name: "Por UF",
        rows: regionCounts.map((r) => ({ UF: r.uf, Quantidade: Number(r.count) })),
      },
      {
        name: "Usuários",
        rows: userStatsRows.map((r) => ({
          Usuario: r.userName ?? "—",
          Email: r.userEmail ?? "—",
          Role: r.userRole ?? "USER",
          Chamados: Number(r.totalTickets),
          Abertos: Number(r.openTickets),
          EmAndamento: Number(r.inProgressTickets),
          Resolvidos: Number(r.resolvedTickets),
          Cancelados: Number(r.closedTickets),
          ResolucaoMediaHoras: r.avgResolutionHours != null ? Number(r.avgResolutionHours) : null,
          SatisfacaoMedia: r.avgRating != null ? Number(r.avgRating) : null,
        })),
      },
      {
        name: "Ranking",
        rows: ranking.map((r) => ({
          Usuario: r.userName,
          Chamados: r.totalTickets,
          ResolucaoMediaHoras: r.avgResolutionHours,
          SatisfacaoMedia: r.avgRating,
        })),
      },
      {
        name: "Tendências",
        rows: Array.from(new Set([...trendsCreated.map((p) => p.day), ...trendsUpdated.map((p) => p.day)]))
          .sort()
          .map((d) => ({
            Dia: d,
            Criados: trendsCreated.find((p) => p.day === d)?.count ?? 0,
            Atualizados: trendsUpdated.find((p) => p.day === d)?.count ?? 0,
          })),
      },
      {
        name: "Chamados",
        rows: tickets.map((t) => ({
          ID: t.id,
          Titulo: t.title,
          Status: t.status,
          Prioridade: t.priority,
          Tipo: t.type,
          UF: t.uf,
          Municipio: t.municipality,
          Solicitante: t.createdBy?.name ?? "",
          Responsavel: t.assignedTo?.name ?? "",
          CriadoEm: t.createdAt.toISOString(),
          AtualizadoEm: t.updatedAt.toISOString(),
        })),
      },
    ]);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(`relatorios_${ts}.xlsx`)}"`);
    res.status(200).send(xlsx);
    return;
  }

  const tableHeaders = ["Campo", "Valor"];
  const tableRows: Array<Array<string | number | null | undefined>> = [
    ["Período", periodLabel],
    ["Total", Number(summaryCounts.total)],
    ["Abertos", Number(summaryCounts.open)],
    ["Em andamento", Number(summaryCounts.inProgress)],
    ["Resolvidos", Number(summaryCounts.resolved)],
    ["Cancelados", Number(summaryCounts.closed)],
    ["Média de resolução (h)", resolutionData.avg != null ? Number(resolutionData.avg).toFixed(2) : "—"],
    ["Média de avaliação", ratingData.avg != null ? Number(ratingData.avg).toFixed(2) : "—"],
    ["", ""],
    ["Status", "Quantidade"],
    ...statusCounts.map((r) => [String(r.status), Number(r.count)]),
    ["", ""],
    ["Tipo", "Quantidade"],
    ...typeCounts.map((r) => [String(r.type), Number(r.count)]),
    ["", ""],
    ["UF", "Quantidade"],
    ...regionCounts.map((r) => [String(r.uf), Number(r.count)]),
    ["", ""],
    ["Ranking (Top 10)", ""],
    ...ranking.slice(0, 10).map((r) => [`${r.userName} (${r.userEmail})`, `Chamados: ${r.totalTickets} | Res.: ${r.avgResolutionHours ?? "—"}h | Sat.: ${r.avgRating ?? "—"}`]),
  ];

  const pdf = await buildTicketsPdfBuffer({
    title: "Relatórios",
    subtitle: filterLabel,
    headers: tableHeaders,
    rows: tableRows,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(`relatorios_${ts}.pdf`)}"`);
  res.status(200).send(Buffer.from(pdf));
});

router.get("/reports/tickets/export", requireAuth, requireActive, async (req, res): Promise<void> => {
  const user = req.user!;
  const from = parseDateQuery(req.query.from);
  const to = parseDateQuery(req.query.to);
  if (req.query.from != null && from == null) {
    res.status(400).json({ error: "Data inicial inválida" });
    return;
  }
  if (req.query.to != null && to == null) {
    res.status(400).json({ error: "Data final inválida" });
    return;
  }
  if (from && to && from.getTime() > to.getTime()) {
    res.status(400).json({ error: "Data final não pode ser anterior à data inicial" });
    return;
  }

  const status = parseOptionalTicketStatus(req.query.status);
  if (req.query.status != null && !status) {
    res.status(400).json({ error: "Status inválido" });
    return;
  }
  const type = parseOptionalTicketType(req.query.type);
  if (req.query.type != null && !type) {
    res.status(400).json({ error: "Categoria inválida" });
    return;
  }
  const priority = parseOptionalTicketPriority(req.query.priority);
  if (req.query.priority != null && !priority) {
    res.status(400).json({ error: "Prioridade inválida" });
    return;
  }

  const whereClauses: any[] = [];
  whereClauses.push(await buildReportTicketScopeWhere(user));
  const dateWhere = buildTicketDateRangeWhere({ from, to });
  if (dateWhere) whereClauses.push(dateWhere);
  if (status) whereClauses.push(eq(ticketsTable.status, status as any));
  if (type) whereClauses.push(eq(ticketsTable.type, type as any));
  if (priority) whereClauses.push(eq(ticketsTable.priority, priority as any));
  const where = and(...whereClauses);

  const limit = 5000;
  const rows = await db.query.ticketsTable.findMany({
    where,
    with: { createdBy: true, assignedTo: true },
    orderBy: [desc(ticketsTable.updatedAt)],
    limit,
  });

  const format = typeof req.query.format === "string" ? req.query.format : "csv";
  const ts = timestampForFilename();
  const periodLabel =
    from && to ? `${from.toISOString()} até ${to.toISOString()}` :
    from ? `A partir de ${from.toISOString()}` :
    to ? `Até ${to.toISOString()}` :
    "Sem filtro de período";
  const filterLabel = [
    `Período: ${periodLabel}`,
    status ? `Status: ${status}` : null,
    type ? `Categoria: ${type}` : null,
    priority ? `Prioridade: ${priority}` : null,
  ].filter(Boolean).join(" | ");

  if (format === "print") {
    const escapeHtml = (value: unknown) => {
      const s = String(value ?? "");
      return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
    };

    const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Relatórios - Chamados</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
    h1 { font-size: 18px; margin: 0 0 10px; }
    .muted { color: #555; font-size: 12px; margin-bottom: 14px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 8px; font-size: 11px; text-align: left; vertical-align: top; }
    th { background: #f6f6f6; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>Relatórios - Chamados</h1>
  <div class="muted">${escapeHtml(filterLabel)}</div>
  <div class="muted">Total: ${rows.length}${rows.length === limit ? " (limitado)" : ""}</div>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Título</th>
        <th>Status</th>
        <th>Prioridade</th>
        <th>Tipo</th>
        <th>UF</th>
        <th>Município</th>
        <th>Solicitante</th>
        <th>Responsável</th>
        <th>Criado em</th>
        <th>Atualizado em</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((t) => `
        <tr>
          <td>${escapeHtml(t.id)}</td>
          <td>${escapeHtml(t.title)}</td>
          <td>${escapeHtml(t.status)}</td>
          <td>${escapeHtml(t.priority)}</td>
          <td>${escapeHtml(t.type)}</td>
          <td>${escapeHtml(t.uf)}</td>
          <td>${escapeHtml(t.municipality)}</td>
          <td>${escapeHtml(t.createdBy?.name ?? "")}</td>
          <td>${escapeHtml(t.assignedTo?.name ?? "")}</td>
          <td>${escapeHtml(t.createdAt.toISOString())}</td>
          <td>${escapeHtml(t.updatedAt.toISOString())}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
    return;
  }

  if (format === "pdf") {
    const headers = ["ID", "Título", "Status", "Prior.", "Tipo", "UF", "Mun.", "Solicitante", "Resp.", "Atualizado"];
    const pdfRows = rows.map((t) => ([
      t.id,
      t.title,
      t.status,
      t.priority,
      t.type,
      t.uf,
      t.municipality,
      t.createdBy?.name ?? "",
      t.assignedTo?.name ?? "",
      t.updatedAt.toISOString(),
    ]));
    const buffer = await buildTicketsPdfBuffer({
      title: "Relatórios - Chamados",
      subtitle: filterLabel,
      headers,
      rows: pdfRows,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(`relatorios_chamados_${ts}.pdf`)}"`);
    res.status(200).send(Buffer.from(buffer));
    return;
  }

  if (format === "xlsx") {
    const xlsx = buildXlsxBuffer([
      {
        name: "Chamados",
        rows: rows.map((t) => ({
          ID: t.id,
          Titulo: t.title,
          Status: t.status,
          Prioridade: t.priority,
          Tipo: t.type,
          UF: t.uf,
          Municipio: t.municipality,
          Solicitante: t.createdBy?.name ?? "",
          Responsavel: t.assignedTo?.name ?? "",
          CriadoEm: t.createdAt.toISOString(),
          AtualizadoEm: t.updatedAt.toISOString(),
        })),
      },
    ]);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(`relatorios_chamados_${ts}.xlsx`)}"`);
    res.status(200).send(xlsx);
    return;
  }

  const sep = ";";
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    const normalized = s.replaceAll("\r", " ").replaceAll("\n", " ").replaceAll("\"", "\"\"");
    return `"${normalized}"`;
  };
  const header = [
    "ID",
    "Título",
    "Status",
    "Prioridade",
    "Tipo",
    "UF",
    "Município",
    "Solicitante",
    "Responsável",
    "Criado em",
    "Atualizado em",
  ].map(escape).join(sep);

  const lines = rows.map((t) => ([
    t.id,
    t.title,
    t.status,
    t.priority,
    t.type,
    t.uf,
    t.municipality,
    t.createdBy?.name ?? "",
    t.assignedTo?.name ?? "",
    t.createdAt.toISOString(),
    t.updatedAt.toISOString(),
  ]).map(escape).join(sep));

  const csv = `\uFEFF${[header, ...lines].join("\r\n")}`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(`relatorios_chamados_${ts}.csv`)}"`);
  res.status(200).send(csv);
});

export default router;
