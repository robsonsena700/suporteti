import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { 
  useListTickets, 
  useListResolvedTickets,
  useGetTicketRating,
  getListTicketsQueryKey,
  getListResolvedTicketsQueryKey,
  getGetTicketRatingQueryKey,
  TicketStatus,
  TicketType,
  TicketPriority,
  ListTicketsParams,
  ListResolvedTicketsParams,
  UserRole
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileText, LayoutGrid, PlusCircle, Search, SquareKanban, Star } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PRIORITY_LABELS, buildTicketsCsv, buildTicketsPrintHtml, downloadTextFile, exportTimestamp, printHtml } from "@/lib/tickets-export";
import {
  TICKETS_PAGE_SIZE_OPTIONS,
  buildTicketsPageItems,
  canViewResolvedTicketRating,
  filterAndSortTickets,
  getTicketsPageInfo,
  isWithinTicketsPeriod,
  resolveTicketsPeriodRange,
  TICKETS_PERIOD_LABELS,
  type TicketsPeriod,
  normalizeTicketsPageSize,
  type TicketsPageSize,
} from "@/lib/tickets-utils";
import { TicketImageModal } from "@/components/tickets/ticket-image-modal";
import { TicketsKanban } from "@/components/tickets/tickets-kanban";
import { TicketCard, hasTicketEmailSent, type TicketListItem } from "@/components/tickets/ticket-card";
import { matchesTicketQuickSearch } from "@/lib/tickets-kanban";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@workspace/api-client-react/custom-fetch";
import { cn } from "@/lib/utils";

const TYPE_TAB_KEY = "tickets_type_tab";
const TICKETS_LIST_STATE_KEY = "suporte-ti:tickets:list:state:v2";
const PAGE_SIZE_KEY = "suporte-ti:tickets:page-size";
const VIEW_MODE_KEY = "suporte-ti:tickets:view-mode";

type TicketsViewMode = "cards" | "kanban";
type KanbanCategory = "ALL" | TicketType;

function getInitialViewMode(): TicketsViewMode {
  if (typeof window === "undefined") return "cards";
  try {
    return window.localStorage.getItem(VIEW_MODE_KEY) === "kanban" ? "kanban" : "cards";
  } catch {
    return "cards";
  }
}

const TAB_LABELS: Record<TicketsMainTab, string> = {
  [TicketType.SOFTWARE]: "Sistema",
  [TicketType.HARDWARE]: "Equipamentos",
  RESOLVED: "Resolvidos",
};

type TicketsPageState = { sig: string; page: number };

function formatCount(n: number): string {
  return n.toLocaleString("pt-BR");
}

function getInitialPageSize(): TicketsPageSize {
  if (typeof window === "undefined") return normalizeTicketsPageSize(undefined);
  try {
    return normalizeTicketsPageSize(window.localStorage.getItem(PAGE_SIZE_KEY));
  } catch {
    return normalizeTicketsPageSize(undefined);
  }
}

type TicketsMainTab = TicketType | "RESOLVED";

type MineOnlyByTab = Record<TicketsMainTab, boolean>;

type TicketsFilters = {
  status?: TicketStatus;
  type?: TicketType;
  priority?: TicketPriority;
  uf?: string;
  municipality?: string;
  mine?: boolean;
  noCoordinator?: boolean;
};

type TicketsListPersistedState = {
  actorUserId: number;
  typeTab: TicketsMainTab;
  filters: TicketsFilters;
  // Campos dos antigos "Filtros de chamados" (removidos): mantidos opcionais só para ler estados salvos.
  userFilter?: string;
  locationFilter?: string;
  responsibleFilter?: string;
  sortBy?: "createdAt" | "user" | "location" | "responsible";
  sortDir?: "asc" | "desc";
  mineOnlyByTab: MineOnlyByTab;
  scrollY: number | null;
  lastActiveTicketId: number | null;
  pageState?: TicketsPageState;
  savedAt: number;
};

function buildDefaultMineOnlyByTab(forRole?: UserRole | null): MineOnlyByTab {
  const mineDefault = forRole === UserRole.ADMIN
    || forRole === UserRole.ANALYST
    || forRole === UserRole.COORDINATOR
    || forRole === UserRole.GESTOR
    ? false
    : true;
  return {
    [TicketType.SOFTWARE]: mineDefault,
    [TicketType.HARDWARE]: mineDefault,
    RESOLVED: mineDefault,
  };
}

function loadTicketsListState(actorUserId: number | null | undefined): TicketsListPersistedState | null {
  if (typeof window === "undefined") return null;
  if (!actorUserId) return null;
  try {
    const raw = window.localStorage.getItem(TICKETS_LIST_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TicketsListPersistedState;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.actorUserId !== actorUserId) return null;
    if (!parsed.filters || typeof parsed.filters !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveTicketsListState(next: TicketsListPersistedState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TICKETS_LIST_STATE_KEY, JSON.stringify(next));
  } catch {
  }
}

function getInitialTicketTypeTab(): TicketsMainTab {
  if (typeof window === "undefined") return TicketType.SOFTWARE;
  const raw = window.localStorage.getItem(TYPE_TAB_KEY);
  if (raw === TicketType.SOFTWARE || raw === TicketType.HARDWARE || raw === "RESOLVED") return raw as any;
  return TicketType.SOFTWARE;
}

function ResolvedTicketRatingStars({ ticketId, actorRole }: { ticketId: number; actorRole: string | null | undefined }) {
  const { toast } = useToast();
  const canSee = canViewResolvedTicketRating({
    isAuthenticated: true,
    role: actorRole,
    status: "RESOLVED",
  });

  const { data: rating, error } = useGetTicketRating(ticketId, {
    query: { enabled: canSee, retry: false, queryKey: getGetTicketRatingQueryKey(ticketId) },
  });

  const hasRating = Boolean(rating);
  const score = rating?.score ?? 0;
  const isNotFound = error instanceof ApiError && error.status === 404;
  const isOtherError = Boolean(error) && !isNotFound;

  if (!canSee) return null;

  return (
    <div className="inline-flex items-center gap-1" aria-label="Avaliação do chamado">
      {Array.from({ length: 5 }).map((_, idx) => {
        const starValue = idx + 1;
        const filled = hasRating && starValue <= score;
        return (
          <button
            key={starValue}
            type="button"
            className="inline-flex"
            aria-label={
              hasRating
                ? `Avaliação ${score} de 5`
                : isNotFound
                  ? "Sem avaliação"
                  : isOtherError
                    ? "Erro ao carregar avaliação"
                    : "Carregando avaliação"
            }
            title={
              hasRating
                ? `Avaliação: ${score}/5`
                : isNotFound
                  ? "Sem avaliação"
                  : isOtherError
                    ? "Erro ao carregar avaliação"
                    : "Carregando..."
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (hasRating) {
                toast({
                  title: "Avaliação do atendimento",
                  description: `${score}/5`,
                });
                return;
              }
              if (isNotFound) {
                toast({
                  title: "Avaliação do atendimento",
                  description: "Sem avaliação",
                });
                return;
              }
              if (isOtherError) {
                toast({
                  title: "Avaliação do atendimento",
                  description: "Erro ao carregar a avaliação",
                });
              }
            }}
          >
            <Star
              className={cn(
                "h-4 w-4 ring-2 ring-[#87CEEB] transition-colors",
                filled ? "fill-amber-400 text-amber-400" : "text-muted-foreground",
                !hasRating ? "opacity-60" : "",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

export default function Tickets() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManageRole = user?.role === UserRole.ADMIN || user?.role === UserRole.ANALYST || user?.role === UserRole.COORDINATOR || user?.role === UserRole.GESTOR;
  const canSeeNoCoordinatorFilter = user?.role === UserRole.ADMIN || user?.role === UserRole.ANALYST;
  const initialTypeTab = getInitialTicketTypeTab();
  const [typeTab, setTypeTab] = useState<TicketsMainTab>(initialTypeTab as any);
  const [mineOnlyByTab, setMineOnlyByTab] = useState<MineOnlyByTab>(() => buildDefaultMineOnlyByTab());
  const [noCoordinatorOnly, setNoCoordinatorOnly] = useState(false);
  const [filters, setFilters] = useState<TicketsFilters>(() => {
    const type = initialTypeTab === "RESOLVED" ? undefined : (initialTypeTab as TicketType);
    return { type };
  });
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [imageModalTicketId, setImageModalTicketId] = useState<number | null>(null);
  const [imageModalTicketTitle, setImageModalTicketTitle] = useState<string>("");
  const [lastActiveTicketId, setLastActiveTicketId] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState<TicketsPageSize>(() => getInitialPageSize());
  const [viewMode, setViewMode] = useState<TicketsViewMode>(() => getInitialViewMode());
  const [kanbanCategory, setKanbanCategory] = useState<KanbanCategory>(() =>
    initialTypeTab === "RESOLVED" ? "ALL" : (initialTypeTab as TicketType),
  );
  const [quickSearch, setQuickSearch] = useState("");
  const [emailFilter, setEmailFilter] = useState<"all" | "sent" | "not_sent">("all");
  const [period, setPeriod] = useState<TicketsPeriod>("all");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [kanbanVisibleTickets, setKanbanVisibleTickets] = useState<TicketListItem[]>([]);
  const [pageState, setPageState] = useState<TicketsPageState>({ sig: "", page: 1 });
  const listTopRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollYRef = useRef<number | null>(null);
  const restoreInFlightRef = useRef<boolean>(false);

  const activeMineOnly = mineOnlyByTab[typeTab] ?? true;

  useEffect(() => {
    if (typeTab !== "RESOLVED" && (filters.status === TicketStatus.RESOLVED || filters.status === TicketStatus.CLOSED)) {
      setTypeTab("RESOLVED");
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TYPE_TAB_KEY, "RESOLVED");
      }
      setFilters((f) => ({ ...f, type: undefined }));
    }
    if (typeTab === "RESOLVED" && (filters.status === TicketStatus.OPEN || filters.status === TicketStatus.IN_PROGRESS || filters.status === TicketStatus.AWAITING_CUSTOMER || filters.status === TicketStatus.IN_DEVELOPMENT)) {
      setFilters((f) => ({ ...f, status: undefined }));
    }
  }, [typeTab, filters.status]);

  useEffect(() => {
    setFilters((f) => {
      const next: TicketsFilters = { ...f };
      next.mine = canManageRole ? (activeMineOnly ? true : undefined) : undefined;
      next.noCoordinator = canSeeNoCoordinatorFilter ? (noCoordinatorOnly ? true : undefined) : undefined;
      return next;
    });
  }, [canManageRole, activeMineOnly, canSeeNoCoordinatorFilter, noCoordinatorOnly]);

  const listTicketsParams: ListTicketsParams = {
    status:
      filters.status === TicketStatus.OPEN
        || filters.status === TicketStatus.IN_PROGRESS
        || filters.status === TicketStatus.AWAITING_CUSTOMER
        || filters.status === TicketStatus.IN_DEVELOPMENT
        ? filters.status
        : undefined,
    type: typeTab === "RESOLVED" ? undefined : (filters.type as any),
    priority: filters.priority as any,
    uf: filters.uf,
    municipality: filters.municipality,
    mine: filters.mine,
    noCoordinator: filters.noCoordinator,
  };

  const listResolvedTicketsParams: ListResolvedTicketsParams = {
    status:
      filters.status === TicketStatus.RESOLVED
        || filters.status === TicketStatus.CLOSED
        ? filters.status
        : undefined,
    type: typeTab === "RESOLVED" ? (filters.type as any) : undefined,
    priority: filters.priority as any,
    uf: filters.uf,
    municipality: filters.municipality,
    mine: filters.mine,
    noCoordinator: filters.noCoordinator,
  };

  const listTicketsQuery = useListTickets(listTicketsParams, {
    query: {
      enabled: viewMode === "cards" && typeTab !== "RESOLVED",
      queryKey: getListTicketsQueryKey(listTicketsParams),
    }
  });

  const listResolvedTicketsQuery = useListResolvedTickets(listResolvedTicketsParams, {
    query: {
      enabled: viewMode === "cards" && typeTab === "RESOLVED",
      queryKey: getListResolvedTicketsQueryKey(listResolvedTicketsParams),
    }
  });

  // Contagens das abas abertas: mesma consulta da listagem (com o "Meus chamados" de cada aba),
  // então a aba ativa reaproveita o cache e as demais ficam sempre atualizadas.
  const buildOpenTabParams = (tab: TicketType): ListTicketsParams => ({
    ...listTicketsParams,
    type: tab,
    mine: canManageRole ? (mineOnlyByTab[tab] ? true : undefined) : undefined,
  });
  const softwareCountParams = buildOpenTabParams(TicketType.SOFTWARE);
  const hardwareCountParams = buildOpenTabParams(TicketType.HARDWARE);
  const softwareCountQuery = useListTickets(softwareCountParams, {
    query: { enabled: !!user, queryKey: getListTicketsQueryKey(softwareCountParams) },
  });
  const hardwareCountQuery = useListTickets(hardwareCountParams, {
    query: { enabled: !!user, queryKey: getListTicketsQueryKey(hardwareCountParams) },
  });

  const activeQuery = typeTab === "RESOLVED" ? listResolvedTicketsQuery : listTicketsQuery;
  const tickets = activeQuery.data;
  const isLoading = activeQuery.isLoading;
  const isError = activeQuery.isError;
  const error = activeQuery.error as unknown;
  const refetchTickets = activeQuery.refetch;

  const ticketsLoadErrorMessage = useMemo(() => {
    if (!isError) return null;
    const err = error;
    if (err instanceof ApiError) {
      const detail = (err.data as any)?.error;
      return detail ? `${detail} (${err.status})` : `${err.message} (${err.status})`;
    }
    return (err as any)?.message || "Não foi possível carregar os chamados.";
  }, [error, isError]);

  // Período calculado uma vez por mudança (e não a cada card).
  const periodRange = useMemo(
    () => resolveTicketsPeriodRange(period, periodFrom, periodTo),
    [period, periodFrom, periodTo],
  );

  // Filtros locais compartilhados pelas visões Normal (Cards) e Kanban.
  const applyClientFilters = useCallback(
    <T extends Parameters<typeof filterAndSortTickets>[0][number]>(list: T[]): T[] =>
      filterAndSortTickets(list, { sortBy: "createdAt", sortDir: "desc" })
        .filter((t) => matchesTicketQuickSearch(t as any, quickSearch))
        .filter((t) => emailFilter === "all" || hasTicketEmailSent(t as any) === (emailFilter === "sent"))
        .filter((t) => isWithinTicketsPeriod((t as any).createdAt, periodRange)),
    [quickSearch, emailFilter, periodRange],
  );

  const visibleTickets = useMemo(() => applyClientFilters(tickets ?? []), [tickets, applyClientFilters]);

  const tabCounts = useMemo(() => {
    const count = (data: Parameters<typeof filterAndSortTickets>[0] | undefined) =>
      data ? applyClientFilters(data).length : undefined;
    const counts: Record<TicketsMainTab, number | undefined> = {
      [TicketType.SOFTWARE]: count(softwareCountQuery.data),
      [TicketType.HARDWARE]: count(hardwareCountQuery.data),
      // Resolvidos só carrega ao abrir a aba (volume alto); fora dela usa o cache, se houver.
      RESOLVED: count(listResolvedTicketsQuery.data),
    };
    if (tickets) counts[typeTab] = visibleTickets.length;
    return counts;
  }, [
    softwareCountQuery.data,
    hardwareCountQuery.data,
    listResolvedTicketsQuery.data,
    tickets,
    typeTab,
    visibleTickets.length,
    applyClientFilters,
  ]);

  // A página pertence a uma combinação de aba/filtros/ordem/tamanho: qualquer mudança volta para a página 1.
  const pageSig = useMemo(
    () => JSON.stringify([typeTab, filters, pageSize, quickSearch.trim(), emailFilter, periodRange]),
    [typeTab, filters, pageSize, quickSearch, emailFilter, periodRange],
  );
  const pageInfo = getTicketsPageInfo(
    visibleTickets.length,
    pageState.sig === pageSig ? pageState.page : 1,
    pageSize,
  );
  const pagedTickets = useMemo(
    () => visibleTickets.slice((pageInfo.page - 1) * pageSize, pageInfo.page * pageSize),
    [visibleTickets, pageInfo.page, pageSize],
  );
  const pageItems = buildTicketsPageItems(pageInfo.page, pageInfo.totalPages);

  const goToPage = (next: number) => {
    const target = Math.min(Math.max(1, next), pageInfo.totalPages);
    if (target === pageInfo.page) return;
    setPageState({ sig: pageSig, page: target });
    listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openImageModal = (t: { id: number; title: string }) => {
    setImageModalTicketId(t.id);
    setImageModalTicketTitle(`#${t.id} — ${t.title}`);
    setImageModalOpen(true);
  };

  const changeTypeTab = (next: TicketsMainTab) => {
    setTypeTab(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TYPE_TAB_KEY, next);
    }
    setFilters((f) => {
      if (next === "RESOLVED") {
        const nextStatus = f.status === TicketStatus.OPEN || f.status === TicketStatus.IN_PROGRESS ? undefined : f.status;
        return { ...f, type: undefined, status: nextStatus };
      }
      const nextStatus = f.status === TicketStatus.RESOLVED || f.status === TicketStatus.CLOSED ? undefined : f.status;
      return { ...f, type: next, status: nextStatus };
    });
  };

  const changeViewMode = (next: TicketsViewMode) => {
    if (next === viewMode) return;
    setViewMode(next);
    if (next === "kanban") setKanbanCategory(typeTab === "RESOLVED" ? "ALL" : (typeTab as TicketType));
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, next);
    } catch {
    }
  };

  const changeKanbanCategory = (next: KanbanCategory) => {
    setKanbanCategory(next);
    if (next !== "ALL") changeTypeTab(next);
  };

  const kanbanBaseParams = useMemo(
    () => ({
      type: kanbanCategory === "ALL" ? undefined : kanbanCategory,
      priority: filters.priority,
      uf: filters.uf,
      municipality: filters.municipality,
      mine: filters.mine,
      noCoordinator: filters.noCoordinator,
    }),
    [kanbanCategory, filters.priority, filters.uf, filters.municipality, filters.mine, filters.noCoordinator],
  );

  const kanbanActor = useMemo(() => (user ? { id: user.id, role: String(user.role) } : null), [user]);

  const describeActiveFilters = (): string[] => {
    const parts: string[] = [];
    if (viewMode === "kanban") {
      parts.push(`Categoria: ${kanbanCategory === "ALL" ? "Todas" : TAB_LABELS[kanbanCategory]}`);
    } else {
      parts.push(`Aba: ${TAB_LABELS[typeTab]}`);
    }
    if (filters.priority) parts.push(`Prioridade: ${PRIORITY_LABELS[filters.priority] ?? filters.priority}`);
    if (emailFilter !== "all") parts.push(`E-mail: ${emailFilter === "sent" ? "Enviado" : "Não enviado"}`);
    if (period !== "all") {
      parts.push(
        period === "custom"
          ? `Período: ${periodFrom ? periodFrom.split("-").reverse().join("/") : "início"} a ${periodTo ? periodTo.split("-").reverse().join("/") : "hoje"}`
          : `Período: ${TICKETS_PERIOD_LABELS[period]}`,
      );
    }
    if (quickSearch.trim()) parts.push(`Busca: "${quickSearch.trim()}"`);
    if (filters.mine) parts.push("Meus chamados");
    if (filters.noCoordinator) parts.push("Sem coordenador");
    return parts;
  };

  // Exporta exatamente o que está filtrado na tela (todas as páginas), sem nova consulta ao servidor.
  const exportRows = (): TicketListItem[] =>
    viewMode === "kanban" ? kanbanVisibleTickets : (visibleTickets as TicketListItem[]);

  const exportCsv = () => {
    const rows = exportRows();
    downloadTextFile(buildTicketsCsv(rows), `chamados_${exportTimestamp()}.csv`, "text/csv;charset=utf-8");
  };

  const exportPdf = () => {
    const rows = exportRows();
    const html = buildTicketsPrintHtml(rows, {
      title: `Chamados — ${viewMode === "kanban" ? "Kanban" : "Visão Normal"}`,
      filters: describeActiveFilters(),
      generatedAt: new Date(),
    });
    if (!printHtml(html)) {
      toast({ title: "Não foi possível abrir a impressão do navegador.", variant: "destructive" });
    }
  };

  const changePageSize = (value: string) => {
    const next = normalizeTicketsPageSize(value);
    setPageSize(next);
    try {
      window.localStorage.setItem(PAGE_SIZE_KEY, String(next));
    } catch {
    }
  };

  const summaryCounts = useMemo(() => {
    let openCount = 0;
    let inProgressCount = 0;
    let resolvedCount = 0;
    let closedCount = 0;
    let noCoordinatorCount = 0;
    let emailSentCount = 0;

    for (const t of visibleTickets) {
      if (t.status === TicketStatus.OPEN) openCount += 1;
      if (t.status === TicketStatus.IN_PROGRESS || t.status === TicketStatus.AWAITING_CUSTOMER || t.status === TicketStatus.IN_DEVELOPMENT) inProgressCount += 1;
      if (t.status === TicketStatus.RESOLVED) resolvedCount += 1;
      if (t.status === TicketStatus.CLOSED) closedCount += 1;
      if (t.ownerHasCoordinator === false) noCoordinatorCount += 1;
      if (hasTicketEmailSent(t as TicketListItem)) emailSentCount += 1;
    }

    return { openCount, inProgressCount, resolvedCount, closedCount, noCoordinatorCount, emailSentCount };
  }, [visibleTickets]);

  const buildPersisted = useCallback((): TicketsListPersistedState | null => {
    if (!user) return null;
    return {
      actorUserId: user.id,
      typeTab,
      filters,
      mineOnlyByTab,
      scrollY: typeof window !== "undefined" ? window.scrollY : null,
      lastActiveTicketId,
      pageState: pageState.sig === pageSig ? pageState : undefined,
      savedAt: Date.now(),
    };
  }, [user, typeTab, filters, mineOnlyByTab, lastActiveTicketId, pageState, pageSig]);

  const saveNow = useCallback(() => {
    const next = buildPersisted();
    if (!next) return;
    saveTicketsListState(next);
  }, [buildPersisted]);

  const applyPersisted = useCallback((state: TicketsListPersistedState | null) => {
    if (!state) return;
    setTypeTab(state.typeTab);
    // Só restaura filtros que ainda têm controle na tela (status/UF/município saíram com o painel de filtros).
    setFilters({
      type: state.filters.type,
      priority: state.filters.priority,
      mine: state.filters.mine,
      noCoordinator: state.filters.noCoordinator,
    });
    setMineOnlyByTab(state.mineOnlyByTab ?? {
      ...buildDefaultMineOnlyByTab(user?.role),
    });
    setLastActiveTicketId(state.lastActiveTicketId);
    setPageState(state.pageState ?? { sig: "", page: 1 });
    pendingScrollYRef.current = state.scrollY;
  }, []);

  const attemptRestoreScroll = useCallback(() => {
    const start = performance.now();
    const run = () => {
      const targetY = pendingScrollYRef.current;
      if (targetY == null) {
        restoreInFlightRef.current = false;
        return;
      }
      window.scrollTo({ top: targetY, behavior: "auto" });
      const elapsed = performance.now() - start;
      if (Math.abs(window.scrollY - targetY) <= 2 || elapsed >= 500) {
        restoreInFlightRef.current = false;
        return;
      }
      requestAnimationFrame(run);
    };
    restoreInFlightRef.current = true;
    requestAnimationFrame(run);
  }, []);

  useEffect(() => {
    if (!user) return;
    const state = loadTicketsListState(user.id);
    if (!state) {
      setMineOnlyByTab(buildDefaultMineOnlyByTab(user.role));
      return;
    }
    const normalized = user.role === UserRole.GESTOR
      && state.mineOnlyByTab
      && state.mineOnlyByTab[TicketType.SOFTWARE]
      && state.mineOnlyByTab[TicketType.HARDWARE]
      && state.mineOnlyByTab.RESOLVED
      ? { ...state, mineOnlyByTab: buildDefaultMineOnlyByTab(user.role) }
      : state;
    applyPersisted(normalized);
    attemptRestoreScroll();
  }, [user, applyPersisted, attemptRestoreScroll]);

  useEffect(() => {
    if (!user) return;
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.ANALYST) return;
    setMineOnlyByTab((prev) => {
      if (!prev[TicketType.SOFTWARE] && !prev[TicketType.HARDWARE] && !prev.RESOLVED) return prev;
      return buildDefaultMineOnlyByTab(user.role);
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        saveNow();
        return;
      }
      if (document.visibilityState !== "visible") return;
      const state = loadTicketsListState(user.id);
      if (!state) return;
      applyPersisted(state);
      attemptRestoreScroll();
    };
    window.addEventListener("beforeunload", saveNow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", saveNow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user, saveNow, applyPersisted, attemptRestoreScroll]);

  useEffect(() => {
    if (!user) return;
    const id = setTimeout(() => saveNow(), 200);
    return () => clearTimeout(id);
  }, [user, typeTab, filters, mineOnlyByTab, lastActiveTicketId, pageState, saveNow]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">
            Chamados
            <span className="text-muted-foreground font-semibold"> · {viewMode === "kanban" ? "Kanban" : "Visão Normal"}</span>
          </h1>
          <p className="text-muted-foreground mt-1">
            {viewMode === "kanban"
              ? "Arraste os cards entre as colunas para atualizar o status do atendimento."
              : "Visualização em grade de cards com todos os informativos e indicador de e-mail enviado."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Modo de visualização" className="inline-flex h-10 items-center rounded-lg border bg-muted/50 p-1">
            {([
              { id: "cards", label: "Normal (Cards)", Icon: LayoutGrid },
              { id: "kanban", label: "Kanban", Icon: SquareKanban },
            ] as const).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={viewMode === id}
                onClick={() => changeViewMode(id)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
                  viewMode === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <Button asChild>
            <Link href="/chamados/novo">
              <PlusCircle className="mr-2 h-4 w-4" />
              Abrir Chamado
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {viewMode === "kanban" ? (
        <Tabs
          className="min-w-0 max-w-full overflow-x-auto"
          value={kanbanCategory}
          onValueChange={(v) => changeKanbanCategory(v as KanbanCategory)}
        >
          <TabsList className="h-11 w-max p-1">
            <TabsTrigger value="ALL" className="h-9 px-3 sm:px-4">Todos</TabsTrigger>
            <TabsTrigger value={TicketType.SOFTWARE} className="h-9 gap-1.5 px-3 sm:px-4">
              <span className="h-2 w-2 rounded-full bg-[var(--series-software)]" aria-hidden="true" />
              Sistema
            </TabsTrigger>
            <TabsTrigger value={TicketType.HARDWARE} className="h-9 gap-1.5 px-3 sm:px-4">
              <span className="h-2 w-2 rounded-full bg-[var(--series-hardware)]" aria-hidden="true" />
              Equipamentos
            </TabsTrigger>
          </TabsList>
        </Tabs>
        ) : (
        <Tabs
          className="min-w-0 max-w-full overflow-x-auto"
          value={typeTab}
          onValueChange={(v) => changeTypeTab(v as TicketsMainTab)}
        >
          <TabsList className="h-11 w-max p-1">
            <TabsTrigger value={TicketType.SOFTWARE} className="h-9 px-3 sm:px-4">
              Sistema
              {tabCounts[TicketType.SOFTWARE] !== undefined ? (
                <span className="ml-1 tabular-nums text-muted-foreground">({formatCount(tabCounts[TicketType.SOFTWARE] ?? 0)})</span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value={TicketType.HARDWARE} className="h-9 px-3 sm:px-4">
              Equipamentos
              {tabCounts[TicketType.HARDWARE] !== undefined ? (
                <span className="ml-1 tabular-nums text-muted-foreground">({formatCount(tabCounts[TicketType.HARDWARE] ?? 0)})</span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="RESOLVED" className="h-9 px-3 sm:px-4">
              Resolvidos
              {tabCounts["RESOLVED"] !== undefined ? (
                <span className="ml-1 tabular-nums text-muted-foreground">({formatCount(tabCounts["RESOLVED"] ?? 0)})</span>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="h-9 self-start lg:self-auto" aria-label="Exportar chamados filtrados">
              <Download className="mr-2 h-4 w-4" />
              Exportar
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Exporta os chamados filtrados na tela
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={exportPdf}>
              <FileText className="mr-2 h-4 w-4" />
              Imprimir / salvar em PDF
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={exportCsv}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Baixar planilha CSV
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
          <Select
            value={filters.priority || "all"}
            onValueChange={(v) => setFilters((f) => ({ ...f, priority: v === "all" ? undefined : (v as TicketPriority) }))}
          >
            <SelectTrigger className="h-9 md:w-[170px]" aria-label="Filtrar por prioridade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Prioridade: Todas</SelectItem>
              <SelectItem value={TicketPriority.HIGH}>Prioridade: Alta</SelectItem>
              <SelectItem value={TicketPriority.MEDIUM}>Prioridade: Média</SelectItem>
              <SelectItem value={TicketPriority.LOW}>Prioridade: Baixa</SelectItem>
            </SelectContent>
          </Select>
          <Select value={emailFilter} onValueChange={(v) => setEmailFilter(v as typeof emailFilter)}>
            <SelectTrigger className="h-9 md:w-[160px]" aria-label="Filtrar por e-mail enviado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">E-mail: Todos</SelectItem>
              <SelectItem value="sent">E-mail: Enviado</SelectItem>
              <SelectItem value="not_sent">E-mail: Não enviado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={(v) => setPeriod(v as TicketsPeriod)}>
            <SelectTrigger className="h-9 md:w-[220px]" aria-label="Filtrar por período de abertura">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TICKETS_PERIOD_LABELS) as TicketsPeriod[]).map((key) => (
                <SelectItem key={key} value={key}>
                  Período: {TICKETS_PERIOD_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {period === "custom" ? (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={periodFrom}
                max={periodTo || undefined}
                onChange={(e) => setPeriodFrom(e.target.value)}
                aria-label="Data inicial de abertura"
                className="h-9 w-[150px]"
              />
              <span className="text-sm text-muted-foreground">até</span>
              <Input
                type="date"
                value={periodTo}
                min={periodFrom || undefined}
                onChange={(e) => setPeriodTo(e.target.value)}
                aria-label="Data final de abertura"
                className="h-9 w-[150px]"
              />
            </div>
          ) : null}
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={quickSearch}
              onChange={(e) => setQuickSearch(e.target.value.slice(0, 120))}
              placeholder="Buscar por #ID, título, solicitante, responsável ou unidade, UF..."
              aria-label="Buscar chamados"
              className="h-9 pl-8"
            />
          </div>
      </div>

      {canManageRole ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <Switch
              id={`tickets_mine_only_${typeTab}`}
              checked={activeMineOnly}
              onCheckedChange={(checked) => {
                const next = Boolean(checked);
                setMineOnlyByTab((p) => ({ ...p, [typeTab]: next }));
              }}
            />
            <Label htmlFor={`tickets_mine_only_${typeTab}`}>Meus chamados</Label>

            {canSeeNoCoordinatorFilter ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="tickets_no_coordinator"
                  checked={noCoordinatorOnly}
                  onCheckedChange={(checked) => setNoCoordinatorOnly(Boolean(checked))}
                />
                <Label htmlFor="tickets_no_coordinator">Sem coordenador</Label>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {viewMode === "cards" ? (
      <div className="flex flex-wrap items-center gap-2">
        {typeTab === "RESOLVED" ? (
          <>
            <div className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-600" />
              <span className="font-medium">Resolvidos:</span>
              <span className="font-semibold tabular-nums">{formatCount(summaryCounts.resolvedCount)}</span>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-sm">
              <span className="h-2 w-2 rounded-full bg-slate-600" />
              <span className="font-medium">Cancelados:</span>
              <span className="font-semibold tabular-nums">{formatCount(summaryCounts.closedCount)}</span>
            </div>
          </>
        ) : (
          <>
            <div className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-sm">
              <span className="h-2 w-2 rounded-full bg-slate-900" />
              <span className="font-medium">Abertos:</span>
              <span className="font-semibold tabular-nums">{formatCount(summaryCounts.openCount)}</span>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-sm">
              <span className="h-2 w-2 rounded-full bg-orange-500" />
              <span className="font-medium">Em Andamento:</span>
              <span className="font-semibold tabular-nums">{formatCount(summaryCounts.inProgressCount)}</span>
            </div>
          </>
        )}
        {canSeeNoCoordinatorFilter ? (
          <div className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-sm">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="font-medium">Sem Coordenador:</span>
            <span className="font-semibold tabular-nums">{formatCount(summaryCounts.noCoordinatorCount)}</span>
          </div>
        ) : null}
        <div className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-sm">
          <span className="h-2 w-2 rounded-full bg-emerald-600" />
          <span className="font-medium">E-mail Enviado:</span>
          <span className="font-semibold tabular-nums">{formatCount(summaryCounts.emailSentCount)}</span>
        </div>
      </div>
      ) : null}

      {viewMode === "kanban" ? (
        <TicketsKanban
          actor={kanbanActor}
          baseParams={kanbanBaseParams}
          applyClientFilters={applyClientFilters}
          onOpenImage={openImageModal}
          onVisibleTicketsChange={setKanbanVisibleTickets}
          onShowAllFinished={() => {
            changeViewMode("cards");
            changeTypeTab("RESOLVED");
          }}
        />
      ) : (
      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : isError ? (
            <div className="py-12 text-center">
              <p className="text-muted-foreground">{ticketsLoadErrorMessage}</p>
              <p className="text-xs text-muted-foreground mt-2">
                Possíveis causas: API fora do ar, falta de permissão, token expirado, ou banco desatualizado (migrations pendentes).
              </p>
              <div className="mt-4 flex justify-center">
                <Button type="button" variant="outline" onClick={() => { void refetchTickets(); }}>
                  Tentar novamente
                </Button>
              </div>
            </div>
          ) : tickets === undefined ? (
            <div className="py-12 text-center">
              <p className="text-muted-foreground">
                Não foi possível carregar os chamados.
              </p>
              <div className="mt-4 flex justify-center">
                <Button type="button" variant="outline" onClick={() => { void refetchTickets(); }}>
                  Tentar novamente
                </Button>
              </div>
            </div>
          ) : visibleTickets.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              Nenhum chamado encontrado com os filtros atuais.
            </div>
          ) : (
            <>
            <div ref={listTopRef} className="mb-4 flex flex-col gap-3 scroll-mt-24 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                Exibindo{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {formatCount(pageInfo.start)}–{formatCount(pageInfo.end)}
                </span>{" "}
                de <span className="font-semibold text-foreground tabular-nums">{formatCount(pageInfo.total)}</span>{" "}
                {pageInfo.total === 1 ? "chamado" : "chamados"}
              </p>
              <div className="flex items-center gap-2">
                <Label htmlFor="tickets_page_size" className="text-sm text-muted-foreground whitespace-nowrap">
                  Cards por tela
                </Label>
                <Select value={String(pageSize)} onValueChange={changePageSize}>
                  <SelectTrigger id="tickets_page_size" className="h-9 w-[84px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TICKETS_PAGE_SIZE_OPTIONS.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div key={`${typeTab}-${pageInfo.page}-${pageSize}`} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 animate-in fade-in-0 duration-200">
              {pagedTickets.map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket as TicketListItem}
                  onOpen={() => {
                    setLastActiveTicketId(ticket.id);
                    saveNow();
                  }}
                  onOpenImage={openImageModal}
                  footerExtra={
                    ticket.status === TicketStatus.RESOLVED ? (
                      <ResolvedTicketRatingStars ticketId={ticket.id} actorRole={user?.role} />
                    ) : null
                  }
                />
              ))}
            </div>
            <nav
              aria-label="Paginação de chamados"
              className="mt-6 flex flex-col-reverse items-center justify-between gap-3 border-t pt-4 sm:flex-row"
            >
              <p className="text-xs text-muted-foreground">
                Página {formatCount(pageInfo.page)} de {formatCount(pageInfo.totalPages)} · {pageSize} cards por tela ({TAB_LABELS[typeTab]})
              </p>
              <ul className="flex flex-wrap items-center justify-center gap-1">
                <li>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pageInfo.page <= 1}
                    onClick={() => goToPage(pageInfo.page - 1)}
                    aria-label="Página anterior"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span className="hidden sm:inline">Anterior</span>
                  </Button>
                </li>
                {pageItems.map((item) =>
                  typeof item === "number" ? (
                    <li key={item}>
                      <Button
                        type="button"
                        variant={item === pageInfo.page ? "default" : "ghost"}
                        size="sm"
                        className="min-w-9 tabular-nums"
                        aria-label={`Página ${item}`}
                        aria-current={item === pageInfo.page ? "page" : undefined}
                        onClick={() => goToPage(item)}
                      >
                        {formatCount(item)}
                      </Button>
                    </li>
                  ) : (
                    <li key={item} aria-hidden="true" className="px-1.5 text-sm text-muted-foreground select-none">
                      …
                    </li>
                  ),
                )}
                <li>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pageInfo.page >= pageInfo.totalPages}
                    onClick={() => goToPage(pageInfo.page + 1)}
                    aria-label="Próxima página"
                  >
                    <span className="hidden sm:inline">Próxima</span>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </li>
              </ul>
            </nav>
            </>
          )}
        </CardContent>
      </Card>
      )}

      {imageModalTicketId != null ? (
        <TicketImageModal
          open={imageModalOpen}
          onOpenChange={setImageModalOpen}
          ticketId={imageModalTicketId}
          ticketTitle={imageModalTicketTitle}
        />
      ) : null}
    </div>
  );
}
