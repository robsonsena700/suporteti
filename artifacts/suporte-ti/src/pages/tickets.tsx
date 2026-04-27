import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { 
  useListTickets, 
  useListResolvedTickets,
  getListTicketsQueryKey,
  getListResolvedTicketsQueryKey,
  TicketStatus,
  TicketType,
  TicketPriority,
  ListTicketsParams,
  UserRole
} from "@workspace/api-client-react";
import { StatusBadge, PriorityBadge, TypeBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Image as ImageIcon, PlusCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { filterAndSortTickets } from "@/lib/tickets-utils";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { TicketImageModal } from "@/components/tickets/ticket-image-modal";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", 
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];
const FILTERS_ACCORDION_KEY = "tickets_filters_accordion_open";
const TYPE_TAB_KEY = "tickets_type_tab";
const TICKETS_LIST_STATE_KEY = "suporte-ti:tickets:list:state:v2";

type TicketsMainTab = TicketType | "RESOLVED";

type MineOnlyByTab = Record<TicketsMainTab, boolean>;

type TicketsListPersistedState = {
  actorUserId: number;
  typeTab: TicketsMainTab;
  filters: ListTicketsParams;
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

export default function Tickets() {
  const { user } = useAuth();
  const canManageRole = user?.role === UserRole.ADMIN || user?.role === UserRole.ANALYST || user?.role === UserRole.COORDINATOR;
  const initialTypeTab = getInitialTicketTypeTab();
  const [typeTab, setTypeTab] = useState<TicketsMainTab>(initialTypeTab as any);
  const [mineOnlyByTab, setMineOnlyByTab] = useState<MineOnlyByTab>({
    [TicketType.SOFTWARE]: true,
    [TicketType.HARDWARE]: true,
    RESOLVED: true,
  });
  const [filters, setFilters] = useState<ListTicketsParams>(() => {
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

  const activeMineOnly = mineOnlyByTab[typeTab] ?? true;

  useEffect(() => {
    if (!user) return;
    if (!canManageRole && typeTab === "RESOLVED") {
      setTypeTab(TicketType.SOFTWARE);
      setFilters((f) => ({ ...f, type: TicketType.SOFTWARE, status: undefined }));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TYPE_TAB_KEY, TicketType.SOFTWARE);
      }
    }
  }, [user, canManageRole, typeTab]);

  useEffect(() => {
    if (typeTab !== "RESOLVED" && (filters.status === TicketStatus.RESOLVED || filters.status === TicketStatus.CLOSED)) {
      if (canManageRole) {
        setTypeTab("RESOLVED");
        if (typeof window !== "undefined") {
          window.localStorage.setItem(TYPE_TAB_KEY, "RESOLVED");
        }
        setFilters((f) => ({ ...f, type: undefined }));
      } else {
        setFilters((f) => ({ ...f, status: undefined }));
      }
    }
    if (typeTab === "RESOLVED" && (filters.status === TicketStatus.OPEN || filters.status === TicketStatus.IN_PROGRESS || filters.status === TicketStatus.AWAITING_CUSTOMER)) {
      setFilters((f) => ({ ...f, status: undefined }));
    }
  }, [typeTab, filters.status, canManageRole]);

  useEffect(() => {
    setFilters((f) => {
      const next = { ...f };
      if (!canManageRole) {
        delete (next as any).mine;
      } else {
        next.mine = activeMineOnly ? true : undefined;
      }
      return next;
    });
  }, [canManageRole, activeMineOnly]);

  const listTicketsQuery = useListTickets(filters, {
    query: {
      enabled: typeTab !== "RESOLVED",
      queryKey: getListTicketsQueryKey(filters),
    }
  });

  const listResolvedTicketsQuery = useListResolvedTickets(filters, {
    query: {
      enabled: canManageRole && typeTab === "RESOLVED",
      queryKey: getListResolvedTicketsQueryKey(filters),
    }
  });

  const { data: tickets, isLoading } = typeTab === "RESOLVED"
    ? listResolvedTicketsQuery
    : listTicketsQuery;

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
      [TicketType.SOFTWARE]: true,
      [TicketType.HARDWARE]: true,
      RESOLVED: true,
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
    if (!state) return;
    applyPersisted(state);
    attemptRestoreScroll();
  }, [user, applyPersisted, attemptRestoreScroll]);

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
            {canManageRole ? (
              <TabsTrigger value="RESOLVED" className="h-9 px-4">
                Resolvidos
              </TabsTrigger>
            ) : null}
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
          <div className="flex items-center gap-2">
            <Switch
              id={`tickets_mine_only_${typeTab}`}
              checked={activeMineOnly}
              onCheckedChange={(checked) => {
                const next = Boolean(checked);
                setMineOnlyByTab((p) => ({ ...p, [typeTab]: next }));
              }}
            />
            <Label htmlFor={`tickets_mine_only_${typeTab}`}>Meus chamados</Label>
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
                  <p className="text-xs text-muted-foreground">Status, prioridade, localização, responsável e ordenação</p>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-2">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                          if ((nextStatus === TicketStatus.RESOLVED || nextStatus === TicketStatus.CLOSED) && typeTab !== "RESOLVED" && canManageRole) {
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
                          <SelectValue placeholder={typeTab === "RESOLVED" ? "Todos (resolvidos/fechados)" : "Abertos e em andamento"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">
                            {typeTab === "RESOLVED" ? "Todos (resolvidos/fechados)" : "Abertos e em andamento"}
                          </SelectItem>
                          {typeTab !== "RESOLVED" ? (
                            <>
                              <SelectItem value={TicketStatus.OPEN}>Aberto</SelectItem>
                              <SelectItem value={TicketStatus.IN_PROGRESS}>Em Andamento</SelectItem>
                              <SelectItem value={TicketStatus.AWAITING_CUSTOMER}>Aguardando Cliente</SelectItem>
                              <SelectItem value={TicketStatus.RESOLVED}>Resolvido</SelectItem>
                              <SelectItem value={TicketStatus.CLOSED}>Fechado</SelectItem>
                            </>
                          ) : (
                            <>
                              <SelectItem value={TicketStatus.RESOLVED}>Resolvido</SelectItem>
                              <SelectItem value={TicketStatus.CLOSED}>Fechado</SelectItem>
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

                    {(user?.role === "ADMIN" || user?.role === "ANALYST") && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">UF</label>
                        <Select
                          value={filters.uf || "all"}
                          onValueChange={(v) => setFilters(f => ({ ...f, uf: v === "all" ? undefined : v }))}
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
                    )}
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
          ) : tickets === undefined ? (
            <div className="py-12 text-center">
              <p className="text-muted-foreground">
                Não foi possível carregar os chamados. Verifique se a API está rodando e se o banco foi atualizado.
              </p>
            </div>
          ) : visibleTickets.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              Nenhum chamado encontrado com os filtros atuais.
            </div>
          ) : (
            <div key={typeTab} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 animate-in fade-in-0 duration-200">
              {visibleTickets.map((ticket) => (
                <Link key={ticket.id} href={`/chamados/${ticket.id}`} className="block">
                  <div
                    className="rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors"
                    onClick={() => {
                      setLastActiveTicketId(ticket.id);
                      saveNow();
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">#{ticket.id} — {ticket.title}</p>
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {ticket.createdBy?.name ?? "—"} • {ticket.uf} - {ticket.municipality}
                        </p>
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
                        <div />
                      )}
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(ticket.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                      </p>
                    </div>

                    <div className="mt-3 pt-3 border-t text-sm">
                      <p className="text-xs text-muted-foreground">Responsável</p>
                      <p className="font-medium truncate">{ticket.assignedTo?.name ?? "Não atribuído"}</p>
                    </div>
                  </div>
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
