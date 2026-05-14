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
import { StatusBadge, PriorityBadge, TypeBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Image as ImageIcon, PlusCircle, Printer, Star } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { canViewResolvedTicketRating, filterAndSortTickets } from "@/lib/tickets-utils";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { TicketImageModal } from "@/components/tickets/ticket-image-modal";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@workspace/api-client-react/custom-fetch";
import { cn } from "@/lib/utils";
import { MunicipalityCombobox } from "@/components/forms/municipality-combobox";
import { UFS, fetchMunicipalitiesByUf, getCachedMunicipalities } from "@/lib/municipalities";

const FILTERS_ACCORDION_KEY = "tickets_filters_accordion_open";
const TYPE_TAB_KEY = "tickets_type_tab";
const TICKETS_LIST_STATE_KEY = "suporte-ti:tickets:list:state:v2";

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
  userFilter: string;
  locationFilter: string;
  responsibleFilter: string;
  sortBy: "createdAt" | "user" | "location" | "responsible";
  sortDir: "asc" | "desc";
  mineOnlyByTab: MineOnlyByTab;
  scrollY: number | null;
  lastActiveTicketId: number | null;
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
  const canSelectUf = user?.role === UserRole.ADMIN || user?.role === UserRole.ANALYST;
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
  const [userFilter, setUserFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [responsibleFilter, setResponsibleFilter] = useState("");
  const [sortBy, setSortBy] = useState<"createdAt" | "user" | "location" | "responsible">("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filtersAccordionOpen, setFiltersAccordionOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(FILTERS_ACCORDION_KEY) === "1";
  });
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [imageModalTicketId, setImageModalTicketId] = useState<number | null>(null);
  const [imageModalTicketTitle, setImageModalTicketTitle] = useState<string>("");
  const [lastActiveTicketId, setLastActiveTicketId] = useState<number | null>(null);
  const pendingScrollYRef = useRef<number | null>(null);
  const restoreInFlightRef = useRef<boolean>(false);
  const municipalityValueRef = useRef<string | undefined>(undefined);
  const [municipalities, setMunicipalities] = useState<string[]>([]);
  const [isLoadingMunicipalities, setIsLoadingMunicipalities] = useState(false);

  const activeMineOnly = mineOnlyByTab[typeTab] ?? true;

  useEffect(() => {
    municipalityValueRef.current = filters.municipality;
  }, [filters.municipality]);

  const municipalityUf = useMemo(() => {
    if (!user) return "";
    if (canSelectUf) return filters.uf ?? "";
    return user.uf ?? "";
  }, [user, canSelectUf, filters.uf]);

  useEffect(() => {
    if (typeTab !== "RESOLVED" && (filters.status === TicketStatus.RESOLVED || filters.status === TicketStatus.CLOSED)) {
      setTypeTab("RESOLVED");
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TYPE_TAB_KEY, "RESOLVED");
      }
      setFilters((f) => ({ ...f, type: undefined }));
    }
    if (typeTab === "RESOLVED" && (filters.status === TicketStatus.OPEN || filters.status === TicketStatus.IN_PROGRESS || filters.status === TicketStatus.AWAITING_CUSTOMER)) {
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

  useEffect(() => {
    if (!municipalityUf) {
      setMunicipalities([]);
      setFilters((f) => (f.municipality ? { ...f, municipality: undefined } : f));
      return;
    }

    const cached = getCachedMunicipalities(municipalityUf);
    if (cached.length > 0) {
      setMunicipalities(cached);
    }

    if (typeof navigator !== "undefined" && !navigator.onLine && cached.length > 0) {
      const current = municipalityValueRef.current;
      if (current && !cached.includes(current)) {
        setFilters((f) => ({ ...f, municipality: undefined }));
      }
      return;
    }

    let cancelled = false;
    setIsLoadingMunicipalities(true);

    fetchMunicipalitiesByUf(municipalityUf)
      .then((data) => {
        if (cancelled) return;
        setMunicipalities(data);
        const current = municipalityValueRef.current;
        if (current && !data.includes(current)) {
          setFilters((f) => ({ ...f, municipality: undefined }));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setMunicipalities([]);
        setFilters((f) => ({ ...f, municipality: undefined }));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingMunicipalities(false);
      });

    return () => {
      cancelled = true;
    };
  }, [municipalityUf]);

  const listTicketsParams: ListTicketsParams = {
    status:
      filters.status === TicketStatus.OPEN
        || filters.status === TicketStatus.IN_PROGRESS
        || filters.status === TicketStatus.AWAITING_CUSTOMER
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
      enabled: typeTab !== "RESOLVED",
      queryKey: getListTicketsQueryKey(listTicketsParams),
    }
  });

  const listResolvedTicketsQuery = useListResolvedTickets(listResolvedTicketsParams, {
    query: {
      enabled: typeTab === "RESOLVED",
      queryKey: getListResolvedTicketsQueryKey(listResolvedTicketsParams),
    }
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

  const visibleTickets = useMemo(() => {
    return filterAndSortTickets(tickets ?? [], {
      userFilter,
      locationFilter,
      responsibleFilter,
      sortBy,
      sortDir,
    });
  }, [tickets, userFilter, locationFilter, responsibleFilter, sortBy, sortDir]);

  const buildPersisted = useCallback((): TicketsListPersistedState | null => {
    if (!user) return null;
    return {
      actorUserId: user.id,
      typeTab,
      filters,
      userFilter,
      locationFilter,
      responsibleFilter,
      sortBy,
      sortDir,
      mineOnlyByTab,
      scrollY: typeof window !== "undefined" ? window.scrollY : null,
      lastActiveTicketId,
      savedAt: Date.now(),
    };
  }, [user, typeTab, filters, userFilter, locationFilter, responsibleFilter, sortBy, sortDir, mineOnlyByTab, lastActiveTicketId]);

  const saveNow = useCallback(() => {
    const next = buildPersisted();
    if (!next) return;
    saveTicketsListState(next);
  }, [buildPersisted]);

  const applyPersisted = useCallback((state: TicketsListPersistedState | null) => {
    if (!state) return;
    setTypeTab(state.typeTab);
    setFilters(state.filters);
    setUserFilter(state.userFilter);
    setLocationFilter(state.locationFilter);
    setResponsibleFilter(state.responsibleFilter);
    setSortBy(state.sortBy);
    setSortDir(state.sortDir);
    setMineOnlyByTab(state.mineOnlyByTab ?? {
      ...buildDefaultMineOnlyByTab(user?.role),
    });
    setLastActiveTicketId(state.lastActiveTicketId);
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
  }, [user, typeTab, filters, userFilter, locationFilter, responsibleFilter, sortBy, sortDir, mineOnlyByTab, lastActiveTicketId, saveNow]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Chamados</h1>
          <p className="text-muted-foreground mt-1">
            Gerencie e acompanhe as solicitações de suporte.
          </p>
        </div>
        <Button asChild>
          <Link href="/chamados/novo">
            <PlusCircle className="mr-2 h-4 w-4" />
            Abrir Chamado
          </Link>
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Tabs
          value={typeTab}
          onValueChange={(v) => {
            const next = v as TicketsMainTab;
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
          }}
        >
          <TabsList className="h-11 p-1">
            <TabsTrigger value={TicketType.SOFTWARE} className="h-9 px-4">
              Software
            </TabsTrigger>
            <TabsTrigger value={TicketType.HARDWARE} className="h-9 px-4">
              Hardware
            </TabsTrigger>
            <TabsTrigger value="RESOLVED" className="h-9 px-4">
              Resolvidos
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="text-xs text-muted-foreground">
          {typeTab === "RESOLVED"
            ? "Exibindo chamados resolvidos"
            : typeTab === TicketType.SOFTWARE
              ? "Exibindo chamados de Software"
              : "Exibindo chamados de Hardware"}
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

      <Card>
        <CardContent className="p-4">
          <Accordion
            type="single"
            collapsible
            value={filtersAccordionOpen ? "filters" : ""}
            onValueChange={(value) => {
              const open = value === "filters";
              setFiltersAccordionOpen(open);
              if (typeof window !== "undefined") {
                window.localStorage.setItem(FILTERS_ACCORDION_KEY, open ? "1" : "0");
              }
            }}
            className="w-full"
          >
            <AccordionItem value="filters" className="border-b-0">
              <AccordionTrigger
                className="py-2 hover:no-underline"
                aria-label={filtersAccordionOpen ? "Recolher filtros" : "Expandir filtros"}
              >
                <div className="text-left">
                  <p className="text-sm font-semibold">Filtros de chamados</p>
                  <p className="text-xs text-muted-foreground">Status, prioridade, UF, município, localização, responsável e ordenação</p>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-2">
                <div className="space-y-4">
                  <div className={cn("grid grid-cols-1 gap-4", canSelectUf ? "md:grid-cols-4" : "md:grid-cols-3")}>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Status</label>
                      <Select
                        value={filters.status || "all"}
                        onValueChange={(v) => {
                          if (v === "all") {
                            setFilters((f) => ({ ...f, status: undefined }));
                            return;
                          }
                          const nextStatus = v as TicketStatus;
                          if ((nextStatus === TicketStatus.RESOLVED || nextStatus === TicketStatus.CLOSED) && typeTab !== "RESOLVED") {
                            setTypeTab("RESOLVED");
                            if (typeof window !== "undefined") {
                              window.localStorage.setItem(TYPE_TAB_KEY, "RESOLVED");
                            }
                            setFilters((f) => ({ ...f, type: undefined, status: nextStatus }));
                            return;
                          }
                          if ((nextStatus === TicketStatus.OPEN || nextStatus === TicketStatus.IN_PROGRESS || nextStatus === TicketStatus.AWAITING_CUSTOMER) && typeTab === "RESOLVED") {
                            setFilters((f) => ({ ...f, status: undefined }));
                            return;
                          }
                          setFilters((f) => ({ ...f, status: nextStatus }));
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={typeTab === "RESOLVED" ? "Todos (resolvidos/cancelados)" : "Abertos e em andamento"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">
                            {typeTab === "RESOLVED" ? "Todos (resolvidos/cancelados)" : "Abertos e em andamento"}
                          </SelectItem>
                          {typeTab !== "RESOLVED" ? (
                            <>
                              <SelectItem value={TicketStatus.OPEN}>Aberto</SelectItem>
                              <SelectItem value={TicketStatus.IN_PROGRESS}>Em Andamento</SelectItem>
                              <SelectItem value={TicketStatus.AWAITING_CUSTOMER}>Aguardando Cliente</SelectItem>
                              <SelectItem value={TicketStatus.RESOLVED}>Resolvido</SelectItem>
                              <SelectItem value={TicketStatus.CLOSED}>Cancelado</SelectItem>
                            </>
                          ) : (
                            <>
                              <SelectItem value={TicketStatus.RESOLVED}>Resolvido</SelectItem>
                              <SelectItem value={TicketStatus.CLOSED}>Cancelado</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Prioridade</label>
                      <Select
                        value={filters.priority || "all"}
                        onValueChange={(v) => setFilters(f => ({ ...f, priority: v === "all" ? undefined : v as TicketPriority }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Todas" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todas</SelectItem>
                          <SelectItem value={TicketPriority.LOW}>Baixa</SelectItem>
                          <SelectItem value={TicketPriority.MEDIUM}>Média</SelectItem>
                          <SelectItem value={TicketPriority.HIGH}>Alta</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {canSelectUf ? (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">UF</label>
                        <Select
                          value={filters.uf || "all"}
                          onValueChange={(v) => setFilters((f) => ({ ...f, uf: v === "all" ? undefined : v, municipality: undefined }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Todas as UFs" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Todas as UFs</SelectItem>
                            {UFS.map(uf => (
                              <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-sm font-medium">Município</label>
                        {filters.municipality ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setFilters((f) => ({ ...f, municipality: undefined }))}
                          >
                            Limpar
                          </Button>
                        ) : null}
                      </div>
                      <MunicipalityCombobox
                        uf={municipalityUf}
                        value={filters.municipality ?? ""}
                        options={municipalities}
                        loading={isLoadingMunicipalities}
                        disabled={!municipalityUf}
                        onChange={(value) => setFilters((f) => ({ ...f, municipality: value }))}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Filtrar por usuário</label>
                      <Input value={userFilter} onChange={(e) => setUserFilter(e.target.value)} placeholder="Nome do solicitante" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Filtrar por localização</label>
                      <Input value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} placeholder="UF ou Município" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Filtrar por responsável</label>
                      <Input value={responsibleFilter} onChange={(e) => setResponsibleFilter(e.target.value)} placeholder="Nome do responsável" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Ordenar por</label>
                      <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="createdAt">Data</SelectItem>
                          <SelectItem value="user">Usuário</SelectItem>
                          <SelectItem value="location">Localização</SelectItem>
                          <SelectItem value="responsible">Responsável</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Ordem</label>
                      <Select value={sortDir} onValueChange={(v) => setSortDir(v as any)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="asc">Crescente</SelectItem>
                          <SelectItem value="desc">Decrescente</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

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
            <div key={typeTab} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 animate-in fade-in-0 duration-200">
              {visibleTickets.map((ticket) => (
                <Link key={ticket.id} href={`/chamados/${ticket.id}`} className="block">
                  {(() => {
                    const noCoordinator = ticket.ownerHasCoordinator === false;
                    return (
                  <div
                    className={cn(
                      "rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors",
                      noCoordinator ? "border-amber-400/70 ring-1 ring-amber-400/20" : null,
                    )}
                    onClick={() => {
                      setLastActiveTicketId(ticket.id);
                      saveNow();
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold truncate">#{ticket.id} — {ticket.title}</p>
                          {noCoordinator ? (
                            <span className="rounded-full border border-amber-400/50 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                              Sem coordenador
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {ticket.createdBy?.name ?? "—"} • {ticket.uf} - {ticket.municipality}
                        </p>
                        {ticket.establishment ? (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {ticket.establishment}
                          </p>
                        ) : null}
                        {ticket.createdBy?.role === UserRole.GESTOR ? (
                          <div className="mt-1">
                            <span className="rounded-full border border-indigo-300/50 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                              Chamado do Gestor associado
                            </span>
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-2 items-end">
                        <StatusBadge status={ticket.status} />
                        <PriorityBadge priority={ticket.priority} />
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <TypeBadge type={ticket.type} />
                      {ticket.status === TicketStatus.OPEN && (ticket.imageAttachmentsCount ?? 0) > 0 ? (
                        <button
                          type="button"
                          aria-label="Visualizar imagem anexada"
                          className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium hover:bg-muted/50 tap-target"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setImageModalTicketId(ticket.id);
                            setImageModalTicketTitle(`#${ticket.id} — ${ticket.title}`);
                            setImageModalOpen(true);
                          }}
                        >
                          <ImageIcon className="h-3.5 w-3.5" />
                          imagem ({ticket.imageAttachmentsCount})
                        </button>
                      ) : (
                        <div className="flex items-center">
                          {ticket.status === TicketStatus.RESOLVED ? (
                            <ResolvedTicketRatingStars ticketId={ticket.id} actorRole={user?.role} />
                          ) : null}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label="Imprimir comprovante"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            window.open(`/chamados/${ticket.id}/comprovante`, "_blank", "noopener,noreferrer");
                          }}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(ticket.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t text-sm">
                      <p className="text-xs text-muted-foreground">Responsável</p>
                      <p className="font-medium truncate">{ticket.assignedTo?.name ?? "Não atribuído"}</p>
                    </div>
                  </div>
                    );
                  })()}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
