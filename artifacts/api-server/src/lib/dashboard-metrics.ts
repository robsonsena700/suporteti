// Calculo das metricas do Painel de Controle (dashboard).
//
// Funcao PURA: recebe as linhas de chamados ja filtradas pela regra de
// visibilidade do perfil (lib/ticket-visibility.ts) e devolve os agregados.
// Mantida separada da rota para poder ser testada sem banco
// (scripts/src/test-dashboard-metrics-unit.ts).

export type TicketType = "SOFTWARE" | "HARDWARE";
export type Segment = "ALL" | TicketType;

export type DashboardTicketRow = {
  id: number;
  title: string;
  type: TicketType;
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: string;
  createdAt: Date;
  updatedAt: Date;
  createdById: number;
  createdByName: string | null;
  assignedToId: number | null;
  assignedToName: string | null;
  /** Primeira mensagem de alguem da equipe (ADMIN/ANALYST/COORDINATOR) que nao seja quem abriu. */
  firstResponseAt: Date | null;
  /** Ultima vez que o status passou para RESOLVED (auditoria). */
  resolvedAt: Date | null;
  /** Saiu de RESOLVED/CLOSED e voltou para um status ativo ao menos uma vez. */
  reopened: boolean;
  rating: number | null;
  ratedAt: Date | null;
};

export type DashboardOptions = {
  now: Date;
  days: number;
  role: string;
  userId: number;
  timeZone?: string;
};

export type StatusCounts = { total: number; open: number; inProgress: number; resolved: number; cancelled: number };

export type SegmentKpis = {
  createdInPeriod: number;
  resolvedInPeriod: number;
  activeNow: number;
  firstResponse: { avgMinutes: number | null; medianMinutes: number | null; sample: number };
  resolution: { avgHours: number | null; medianHours: number | null; sample: number };
  reopen: { rate: number | null; reopened: number; resolved: number };
};

export type SegmentRatings = {
  avg: number | null;
  count: number;
  /** quantidade de notas 1, 2, 3, 4 e 5 (indice 0 = nota 1) */
  distribution: [number, number, number, number, number];
  /** avaliados / resolvidos no periodo (0..1) */
  coverage: number | null;
};

export type DashboardMetrics = {
  generatedAt: string;
  period: { days: number; from: string; to: string };
  visibility: {
    role: string;
    showRequesters: boolean;
    showAssignees: boolean;
    showRatings: boolean;
  };
  statusCounts: Record<Segment, StatusCounts>;
  kpis: Record<Segment, SegmentKpis>;
  daily: Array<{
    date: string;
    createdSoftware: number;
    createdHardware: number;
    resolvedSoftware: number;
    resolvedHardware: number;
  }>;
  priorityActive: Array<{ priority: "HIGH" | "MEDIUM" | "LOW"; software: number; hardware: number }>;
  topRequesters: Array<{ userId: number; name: string; software: number; hardware: number; total: number }> | null;
  assignees: Array<{
    userId: number;
    name: string;
    resolvedSoftware: number;
    resolvedHardware: number;
    resolvedTotal: number;
    avgResolutionHours: number | null;
    activeNow: number;
  }> | null;
  ratings: Record<Segment, SegmentRatings> | null;
  recent: Array<{
    ticketId: number;
    title: string;
    type: TicketType;
    priority: "LOW" | "MEDIUM" | "HIGH";
    status: string;
    requesterName: string | null;
    assigneeName: string | null;
    createdAt: string;
    updatedAt: string;
    firstResponseMinutes: number | null;
    resolutionHours: number | null;
  }>;
};

export const ACTIVE_STATUSES = new Set(["OPEN", "IN_PROGRESS", "AWAITING_CUSTOMER", "IN_DEVELOPMENT"]);
const SEGMENTS: Segment[] = ["ALL", "SOFTWARE", "HARDWARE"];

const MS_MINUTE = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

/** Quem enxerga cada bloco do painel. */
export function dashboardVisibility(role: string) {
  return {
    role,
    // USER so ve os proprios chamados: ranking de solicitantes nao faz sentido.
    showRequesters: role !== "USER",
    // Desempenho por responsavel: equipe de atendimento e coordenacao.
    showAssignees: role === "ADMIN" || role === "ANALYST" || role === "COORDINATOR",
    // Regra mantida do painel anterior: GESTOR nao ve avaliacoes.
    showRatings: role !== "GESTOR",
  };
}

/**
 * Regra mantida do painel anterior para avaliacoes:
 * - USER: avaliacoes dos proprios chamados
 * - ANALYST: avaliacoes dos chamados atribuidos a ele
 * - GESTOR: nenhuma
 * - COORDINATOR / ADMIN: avaliacoes dos chamados que enxerga
 */
export function canCountRating(row: DashboardTicketRow, role: string, userId: number): boolean {
  if (role === "GESTOR") return false;
  if (role === "USER") return row.createdById === userId;
  if (role === "ANALYST") return row.assignedToId === userId;
  return true;
}

function round(value: number | null, digits = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function dayKey(date: Date, timeZone: string): string {
  // en-CA formata como AAAA-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function inSegment(row: DashboardTicketRow, seg: Segment): boolean {
  return seg === "ALL" || row.type === seg;
}

function emptyCounts(): StatusCounts {
  return { total: 0, open: 0, inProgress: 0, resolved: 0, cancelled: 0 };
}

export function computeDashboardMetrics(rows: DashboardTicketRow[], opts: DashboardOptions): DashboardMetrics {
  const timeZone = opts.timeZone ?? "America/Sao_Paulo";
  const days = Math.max(1, Math.floor(opts.days));
  const to = opts.now;
  // Periodo = hoje + (days - 1) dias anteriores, por dia do calendario local.
  const todayKey = dayKey(to, timeZone);
  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dayKeys.push(dayKey(new Date(to.getTime() - i * MS_DAY), timeZone));
  }
  const firstKey = dayKeys[0];
  const inPeriod = (d: Date | null) => {
    if (!d) return false;
    const k = dayKey(d, timeZone);
    return k >= firstKey && k <= todayKey && d.getTime() <= to.getTime();
  };

  const vis = dashboardVisibility(opts.role);

  // ---- contagens atuais por status (todo o historico visivel) ----
  const statusCounts = {} as Record<Segment, StatusCounts>;
  for (const seg of SEGMENTS) statusCounts[seg] = emptyCounts();
  for (const r of rows) {
    for (const seg of SEGMENTS) {
      if (!inSegment(r, seg)) continue;
      const c = statusCounts[seg];
      c.total++;
      if (r.status === "OPEN") c.open++;
      else if (r.status === "RESOLVED") c.resolved++;
      else if (r.status === "CLOSED") c.cancelled++;
      else if (ACTIVE_STATUSES.has(r.status)) c.inProgress++;
    }
  }

  // ---- KPIs do periodo ----
  const resolvedInPeriodRow = (r: DashboardTicketRow) => r.status === "RESOLVED" && inPeriod(r.resolvedAt);
  const kpis = {} as Record<Segment, SegmentKpis>;
  for (const seg of SEGMENTS) {
    const segRows = rows.filter((r) => inSegment(r, seg));
    const created = segRows.filter((r) => inPeriod(r.createdAt));

    const firstResp = created
      .filter((r) => r.firstResponseAt && r.firstResponseAt.getTime() >= r.createdAt.getTime())
      .map((r) => (r.firstResponseAt!.getTime() - r.createdAt.getTime()) / MS_MINUTE);

    const resolved = segRows.filter(resolvedInPeriodRow);
    const resHours = resolved
      .filter((r) => r.resolvedAt!.getTime() >= r.createdAt.getTime())
      .map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / MS_HOUR);

    // Reabertura: dos chamados abertos no periodo que chegaram a ser
    // resolvidos/cancelados alguma vez, quantos voltaram a ficar ativos.
    const everFinished = created.filter((r) => r.resolvedAt != null || r.reopened || r.status === "RESOLVED" || r.status === "CLOSED");
    const reopened = everFinished.filter((r) => r.reopened).length;

    kpis[seg] = {
      createdInPeriod: created.length,
      resolvedInPeriod: resolved.length,
      activeNow: segRows.filter((r) => ACTIVE_STATUSES.has(r.status)).length,
      firstResponse: {
        avgMinutes: round(mean(firstResp), 0),
        medianMinutes: round(median(firstResp), 0),
        sample: firstResp.length,
      },
      resolution: {
        avgHours: round(mean(resHours)),
        medianHours: round(median(resHours)),
        sample: resHours.length,
      },
      reopen: {
        rate: everFinished.length > 0 ? round(reopened / everFinished.length, 4) : null,
        reopened,
        resolved: everFinished.length,
      },
    };
  }

  // ---- abertura x resolucao por dia ----
  const dailyMap = new Map(dayKeys.map((k) => [k, { date: k, createdSoftware: 0, createdHardware: 0, resolvedSoftware: 0, resolvedHardware: 0 }]));
  for (const r of rows) {
    if (inPeriod(r.createdAt)) {
      const d = dailyMap.get(dayKey(r.createdAt, timeZone));
      if (d) {
        if (r.type === "SOFTWARE") d.createdSoftware++;
        else d.createdHardware++;
      }
    }
    if (resolvedInPeriodRow(r)) {
      const d = dailyMap.get(dayKey(r.resolvedAt!, timeZone));
      if (d) {
        if (r.type === "SOFTWARE") d.resolvedSoftware++;
        else d.resolvedHardware++;
      }
    }
  }

  // ---- criticidade dos chamados ativos (agora) ----
  const priorityActive = (["HIGH", "MEDIUM", "LOW"] as const).map((priority) => {
    const act = rows.filter((r) => ACTIVE_STATUSES.has(r.status) && r.priority === priority);
    return {
      priority,
      software: act.filter((r) => r.type === "SOFTWARE").length,
      hardware: act.filter((r) => r.type === "HARDWARE").length,
    };
  });

  // ---- solicitantes que mais abriram chamados no periodo ----
  let topRequesters: DashboardMetrics["topRequesters"] = null;
  if (vis.showRequesters) {
    const map = new Map<number, { userId: number; name: string; software: number; hardware: number; total: number }>();
    for (const r of rows) {
      if (!inPeriod(r.createdAt)) continue;
      const e = map.get(r.createdById) ?? { userId: r.createdById, name: r.createdByName ?? "Desconhecido", software: 0, hardware: 0, total: 0 };
      if (r.type === "SOFTWARE") e.software++;
      else e.hardware++;
      e.total++;
      map.set(r.createdById, e);
    }
    topRequesters = [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, 10);
  }

  // ---- desempenho por responsavel ----
  let assignees: DashboardMetrics["assignees"] = null;
  if (vis.showAssignees) {
    type Acc = { userId: number; name: string; resolvedSoftware: number; resolvedHardware: number; hours: number[]; activeNow: number };
    const map = new Map<number, Acc>();
    const get = (r: DashboardTicketRow) => {
      const id = r.assignedToId!;
      const e = map.get(id) ?? { userId: id, name: r.assignedToName ?? "Desconhecido", resolvedSoftware: 0, resolvedHardware: 0, hours: [], activeNow: 0 };
      map.set(id, e);
      return e;
    };
    for (const r of rows) {
      if (r.assignedToId == null) continue;
      if (ACTIVE_STATUSES.has(r.status)) get(r).activeNow++;
      if (resolvedInPeriodRow(r)) {
        const e = get(r);
        if (r.type === "SOFTWARE") e.resolvedSoftware++;
        else e.resolvedHardware++;
        if (r.resolvedAt!.getTime() >= r.createdAt.getTime()) e.hours.push((r.resolvedAt!.getTime() - r.createdAt.getTime()) / MS_HOUR);
      }
    }
    assignees = [...map.values()]
      .map((e) => ({
        userId: e.userId,
        name: e.name,
        resolvedSoftware: e.resolvedSoftware,
        resolvedHardware: e.resolvedHardware,
        resolvedTotal: e.resolvedSoftware + e.resolvedHardware,
        avgResolutionHours: round(mean(e.hours)),
        activeNow: e.activeNow,
      }))
      .filter((e) => e.resolvedTotal > 0 || e.activeNow > 0)
      .sort((a, b) => b.resolvedTotal - a.resolvedTotal || b.activeNow - a.activeNow || a.name.localeCompare(b.name))
      .slice(0, 10);
  }

  // ---- avaliacoes (CSAT) ----
  let ratings: DashboardMetrics["ratings"] = null;
  if (vis.showRatings) {
    const out = {} as Record<Segment, SegmentRatings>;
    for (const seg of SEGMENTS) {
      const eligible = rows.filter((r) => inSegment(r, seg) && canCountRating(r, opts.role, opts.userId));
      const rated = eligible.filter((r) => r.rating != null && inPeriod(r.ratedAt));
      const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
      for (const r of rated) {
        const n = Math.min(5, Math.max(1, Math.round(r.rating!)));
        distribution[n - 1]++;
      }
      const resolvedP = eligible.filter(resolvedInPeriodRow);
      const ratedOfResolved = resolvedP.filter((r) => r.rating != null).length;
      out[seg] = {
        avg: round(mean(rated.map((r) => r.rating!)), 2),
        count: rated.length,
        distribution,
        coverage: resolvedP.length > 0 ? round(ratedOfResolved / resolvedP.length, 4) : null,
      };
    }
    ratings = out;
  }

  // ---- atividade recente ----
  const recent = [...rows]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    // 20 itens: o front filtra por tipo e mostra os 6 primeiros.
    .slice(0, 20)
    .map((r) => ({
      ticketId: r.id,
      title: r.title,
      type: r.type,
      priority: r.priority,
      status: r.status,
      requesterName: r.createdByName,
      assigneeName: r.assignedToName,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      firstResponseMinutes: r.firstResponseAt && r.firstResponseAt.getTime() >= r.createdAt.getTime()
        ? round((r.firstResponseAt.getTime() - r.createdAt.getTime()) / MS_MINUTE, 0)
        : null,
      resolutionHours: r.status === "RESOLVED" && r.resolvedAt && r.resolvedAt.getTime() >= r.createdAt.getTime()
        ? round((r.resolvedAt.getTime() - r.createdAt.getTime()) / MS_HOUR)
        : null,
    }));

  return {
    generatedAt: to.toISOString(),
    period: { days, from: firstKey, to: todayKey },
    visibility: vis,
    statusCounts,
    kpis,
    daily: [...dailyMap.values()],
    priorityActive,
    topRequesters,
    assignees,
    ratings,
    recent,
  };
}
