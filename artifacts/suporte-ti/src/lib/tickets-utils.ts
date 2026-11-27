export type TicketLikeBase = {
  id: number;
  uf: string;
  municipality: string;
  createdAt: string;
  createdBy?: { name?: string | null } | null;
  assignedTo?: { name?: string | null } | null;
};

export type TicketsSortBy = "createdAt" | "user" | "location" | "responsible";
export type TicketsSortDir = "asc" | "desc";

export function canViewResolvedTicketRating(opts: {
  isAuthenticated: boolean;
  role?: string | null;
  status?: string | null;
}): boolean {
  if (!opts.isAuthenticated) return false;
  if (opts.role !== "USER") return false;
  if (opts.status !== "RESOLVED" && opts.status !== "CLOSED") return false;
  return true;
}

export function canCreateTicketMessage(opts: {
  canInteract: boolean;
  status?: string | null;
}): boolean {
  if (!opts.canInteract) return false;
  return opts.status !== "CLOSED" && opts.status !== "RESOLVED";
}

export function formatUfMunicipality(uf: string, municipality: string): string {
  return `${uf} - ${municipality}`;
}

export function filterAndSortTickets<T extends TicketLikeBase>(
  tickets: T[],
  opts: {
    userFilter?: string;
    locationFilter?: string;
    responsibleFilter?: string;
    sortBy?: TicketsSortBy;
    sortDir?: TicketsSortDir;
  } = {},
): T[] {
  const userQuery = (opts.userFilter ?? "").trim().toLowerCase();
  const locationQuery = (opts.locationFilter ?? "").trim().toLowerCase();
  const responsibleQuery = (opts.responsibleFilter ?? "").trim().toLowerCase();
  const sortBy = opts.sortBy ?? "createdAt";
  const sortDir = opts.sortDir ?? "desc";

  const filtered = tickets.filter(t => {
    const createdByName = (t.createdBy?.name ?? "").toLowerCase();
    const responsibleName = (t.assignedTo?.name ?? "").toLowerCase();
    const locationText = formatUfMunicipality(t.uf, t.municipality).toLowerCase();

    if (userQuery && !createdByName.includes(userQuery)) return false;
    if (responsibleQuery && !responsibleName.includes(responsibleQuery)) return false;
    if (locationQuery && !locationText.includes(locationQuery)) return false;
    return true;
  });

  const factor = sortDir === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => {
    const aUser = a.createdBy?.name ?? "";
    const bUser = b.createdBy?.name ?? "";
    const aLoc = formatUfMunicipality(a.uf, a.municipality);
    const bLoc = formatUfMunicipality(b.uf, b.municipality);
    const aResp = a.assignedTo?.name ?? "";
    const bResp = b.assignedTo?.name ?? "";

    if (sortBy === "user") return aUser.localeCompare(bUser, "pt-BR") * factor;
    if (sortBy === "location") return aLoc.localeCompare(bLoc, "pt-BR") * factor;
    if (sortBy === "responsible") return aResp.localeCompare(bResp, "pt-BR") * factor;
    return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * factor;
  });
}

export const TICKETS_PAGE_SIZE_OPTIONS = [15, 18, 20] as const;
export type TicketsPageSize = (typeof TICKETS_PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_TICKETS_PAGE_SIZE: TicketsPageSize = 18;

export function normalizeTicketsPageSize(value: unknown): TicketsPageSize {
  const n = typeof value === "string" ? Number(value) : value;
  return (TICKETS_PAGE_SIZE_OPTIONS as readonly unknown[]).includes(n)
    ? (n as TicketsPageSize)
    : DEFAULT_TICKETS_PAGE_SIZE;
}

export type TicketsPageInfo = {
  page: number;
  totalPages: number;
  start: number;
  end: number;
  total: number;
};

/** Calcula a página efetiva (limitada ao intervalo válido) e o intervalo 1-based exibido. */
export function getTicketsPageInfo(total: number, requestedPage: number, pageSize: number): TicketsPageInfo {
  const safeTotal = Math.max(0, Math.floor(total));
  const size = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(safeTotal / size));
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), totalPages);
  if (safeTotal === 0) return { page: 1, totalPages: 1, start: 0, end: 0, total: 0 };
  const start = (page - 1) * size + 1;
  const end = Math.min(safeTotal, page * size);
  return { page, totalPages, start, end, total: safeTotal };
}

export type TicketsPageItem = number | "ellipsis-start" | "ellipsis-end";

/**
 * Itens da barra de paginação: sempre a primeira e a última página, a atual e suas vizinhas.
 * Lacunas de uma única página mostram a página; lacunas maiores viram reticências.
 * Ex.: (1, 5) => [1, 2, "ellipsis-end", 5]; (5, 10) => [1, "ellipsis-start", 4, 5, 6, "ellipsis-end", 10].
 */
export function buildTicketsPageItems(current: number, totalPages: number): TicketsPageItem[] {
  const total = Math.max(1, Math.floor(totalPages));
  const page = Math.min(Math.max(1, Math.floor(current) || 1), total);
  const wanted = new Set<number>([1, total, page - 1, page, page + 1]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const items: TicketsPageItem[] = [];
  for (let i = 0; i < pages.length; i += 1) {
    const p = pages[i];
    const prev = pages[i - 1];
    if (prev !== undefined) {
      if (p - prev === 2) items.push(prev + 1);
      else if (p - prev > 2) items.push(p > page ? "ellipsis-end" : "ellipsis-start");
    }
    items.push(p);
  }
  return items;
}

export type TicketsPeriod = "all" | "today" | "7d" | "30d" | "90d" | "custom";

export const TICKETS_PERIOD_LABELS: Record<TicketsPeriod, string> = {
  all: "Todo o período",
  today: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  custom: "Personalizado",
};

export type TicketsPeriodRange = { start: number | null; end: number | null };

function parseLocalDate(value: string | undefined | null, endOfDay: boolean): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const d = endOfDay
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999)
    : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** Intervalo (horário local) do filtro de período, aplicado sobre a data de abertura do chamado. */
export function resolveTicketsPeriodRange(
  period: TicketsPeriod,
  customFrom?: string | null,
  customTo?: string | null,
  now: Date = new Date(),
): TicketsPeriodRange {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const daysBack = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1)).getTime();
  switch (period) {
    case "today":
      return { start: startOfToday, end: null };
    case "7d":
      return { start: daysBack(7), end: null };
    case "30d":
      return { start: daysBack(30), end: null };
    case "90d":
      return { start: daysBack(90), end: null };
    case "custom": {
      let start = parseLocalDate(customFrom, false);
      let end = parseLocalDate(customTo, true);
      if (start != null && end != null && start > end) {
        // Datas invertidas: troca para não esconder tudo por engano.
        const s0 = parseLocalDate(customTo, false);
        const e0 = parseLocalDate(customFrom, true);
        start = s0;
        end = e0;
      }
      return { start, end };
    }
    default:
      return { start: null, end: null };
  }
}

export function isWithinTicketsPeriod(createdAt: string | Date | null | undefined, range: TicketsPeriodRange): boolean {
  if (range.start == null && range.end == null) return true;
  const t = createdAt ? new Date(createdAt).getTime() : NaN;
  if (!Number.isFinite(t)) return false;
  if (range.start != null && t < range.start) return false;
  if (range.end != null && t > range.end) return false;
  return true;
}
