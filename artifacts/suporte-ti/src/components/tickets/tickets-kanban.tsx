import { useMemo, useState, type DragEvent } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import {
  useListTickets,
  getListTicketsQueryKey,
  TicketType,
  type ListTicketsParams,
  type Ticket,
} from "@workspace/api-client-react";
import { ApiError, customFetch } from "@workspace/api-client-react/custom-fetch";
import { ArrowRightLeft, GripVertical, Loader2, Lock } from "lucide-react";
import { PriorityBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  KANBAN_COLUMNS,
  canDragKanbanTicket,
  kanbanColumnOf,
  planKanbanMove,
  type KanbanActor,
  type KanbanColumnId,
  type KanbanMovePlan,
} from "@/lib/tickets-kanban";

export const KANBAN_FINISHED_LIMIT = 50;
const DRAG_MIME = "application/x-suporteti-ticket";
const RESOLVE_MAX = 2000;

export type KanbanBaseParams = Omit<ListTicketsParams, "status">;

type Props = {
  actor: KanbanActor | null;
  baseParams: KanbanBaseParams;
  /** Filtros locais (busca, usuário, localização, responsável e ordenação) já usados na visão de cards. */
  applyClientFilters: (tickets: Ticket[]) => Ticket[];
  onShowAllFinished: () => void;
};

type UpdatePlan = Extract<KanbanMovePlan, { kind: "update" }>;

const SUBSTATUS_LABEL: Record<string, string> = {
  AWAITING_CUSTOMER: "Aguardando cliente",
  IN_DEVELOPMENT: "Em desenvolvimento",
};

function toSearch(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const detail = (err.data as { error?: string } | null)?.error;
    return detail || err.message || fallback;
  }
  return (err as Error | null)?.message || fallback;
}

function isTicketsQuery(q: Query): boolean {
  const k = q.queryKey[0];
  return (typeof k === "string" && k.startsWith("/api/tickets")) || k === "tickets-kanban-finished";
}

function useFinishedTickets(status: "RESOLVED" | "CLOSED", baseParams: KanbanBaseParams, enabled: boolean) {
  const params = { ...baseParams, status, limit: KANBAN_FINISHED_LIMIT };
  return useQuery({
    queryKey: ["tickets-kanban-finished", params],
    enabled,
    queryFn: ({ signal }) => customFetch<Ticket[]>(`/api/tickets/resolved?${toSearch(params)}`, { signal }),
  });
}

export function TicketsKanban({ actor, baseParams, applyClientFilters, onShowAllFinished }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const openQuery = useListTickets(baseParams as ListTicketsParams, {
    query: { enabled: !!actor, queryKey: getListTicketsQueryKey(baseParams as ListTicketsParams) },
  });
  const resolvedQuery = useFinishedTickets("RESOLVED", baseParams, !!actor);
  const closedQuery = useFinishedTickets("CLOSED", baseParams, !!actor);

  // Movimentos em andamento: o card aparece na coluna de destino até a API confirmar.
  const [pending, setPending] = useState<Record<number, KanbanColumnId>>({});
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [over, setOver] = useState<{ column: KanbanColumnId; allowed: boolean } | null>(null);
  const [confirmMove, setConfirmMove] = useState<{ ticket: Ticket; plan: UpdatePlan; target: KanbanColumnId } | null>(null);
  const [resolveMove, setResolveMove] = useState<{ ticket: Ticket; expectedStatus: string } | null>(null);
  const [resolveText, setResolveText] = useState("");

  const allTickets = useMemo(() => {
    const map = new Map<number, Ticket>();
    for (const t of [...(resolvedQuery.data ?? []), ...(closedQuery.data ?? []), ...(openQuery.data ?? [])]) {
      map.set(t.id, t);
    }
    return map;
  }, [openQuery.data, resolvedQuery.data, closedQuery.data]);

  const columns = useMemo(() => {
    const byColumn: Record<KanbanColumnId, Ticket[]> = { OPEN: [], IN_PROGRESS: [], RESOLVED: [], CLOSED: [] };
    for (const t of applyClientFilters([...allTickets.values()])) {
      const col = pending[t.id] ?? kanbanColumnOf(t.status);
      if (col) byColumn[col].push(t);
    }
    return byColumn;
  }, [allTickets, applyClientFilters, pending]);

  const columnState: Record<KanbanColumnId, { loading: boolean; error: boolean; capped: boolean }> = {
    OPEN: { loading: openQuery.isLoading, error: openQuery.isError, capped: false },
    IN_PROGRESS: { loading: openQuery.isLoading, error: openQuery.isError, capped: false },
    RESOLVED: { loading: resolvedQuery.isLoading, error: resolvedQuery.isError, capped: (resolvedQuery.data?.length ?? 0) >= KANBAN_FINISHED_LIMIT },
    CLOSED: { loading: closedQuery.isLoading, error: closedQuery.isError, capped: (closedQuery.data?.length ?? 0) >= KANBAN_FINISHED_LIMIT },
  };

  const columnTitle = (id: KanbanColumnId) => KANBAN_COLUMNS.find((c) => c.id === id)?.title ?? id;

  const refresh = () => queryClient.invalidateQueries({ predicate: isTicketsQuery });

  const finishMove = async (ticketId: number) => {
    try {
      await refresh();
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[ticketId];
        return next;
      });
    }
  };

  const handleFailure = (ticket: Ticket, err: unknown) => {
    const conflict = err instanceof ApiError && err.status === 409;
    toast({
      title: conflict ? `O chamado #${ticket.id} mudou enquanto você o movia` : `Não foi possível mover o chamado #${ticket.id}`,
      description: errorMessage(err, "Tente novamente."),
      variant: "destructive",
    });
  };

  const runUpdate = async (ticket: Ticket, plan: UpdatePlan, target: KanbanColumnId) => {
    if (pending[ticket.id]) return;
    setPending((p) => ({ ...p, [ticket.id]: target }));
    try {
      await customFetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: plan.status, expectedStatus: plan.expectedStatus }),
      });
      toast({ title: `Chamado #${ticket.id} movido para ${columnTitle(target)}` });
    } catch (err) {
      handleFailure(ticket, err);
    } finally {
      await finishMove(ticket.id);
    }
  };

  const runResolve = async () => {
    if (!resolveMove) return;
    const { ticket, expectedStatus } = resolveMove;
    const message = resolveText.trim();
    if (!message) {
      toast({ title: "Descreva a solução para resolver o chamado.", variant: "destructive" });
      return;
    }
    setResolveMove(null);
    setResolveText("");
    if (pending[ticket.id]) return;
    setPending((p) => ({ ...p, [ticket.id]: "RESOLVED" }));
    try {
      await customFetch(`/api/tickets/${ticket.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, expectedStatus }),
      });
      toast({ title: `Chamado #${ticket.id} resolvido` });
    } catch (err) {
      handleFailure(ticket, err);
    } finally {
      await finishMove(ticket.id);
    }
  };

  const requestMove = (ticket: Ticket, target: KanbanColumnId) => {
    if (pending[ticket.id]) return;
    const plan = planKanbanMove(ticket, target, actor);
    if (plan.kind === "noop") return;
    if (plan.kind === "blocked") {
      toast({ title: "Movimento não permitido", description: plan.reason, variant: "destructive" });
      return;
    }
    if (plan.kind === "resolve") {
      setResolveText("");
      setResolveMove({ ticket, expectedStatus: plan.expectedStatus });
      return;
    }
    if (plan.confirm) {
      setConfirmMove({ ticket, plan, target });
      return;
    }
    void runUpdate(ticket, plan, target);
  };

  const onDragStart = (e: DragEvent<HTMLElement>, ticket: Ticket) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(DRAG_MIME, String(ticket.id));
    e.dataTransfer.setData("text/plain", `#${ticket.id}`);
    setDraggingId(ticket.id);
  };

  const onDragEnd = () => {
    setDraggingId(null);
    setOver(null);
  };

  const onDragOver = (e: DragEvent<HTMLElement>, column: KanbanColumnId) => {
    if (draggingId == null) return;
    const ticket = allTickets.get(draggingId);
    if (!ticket) return;
    const plan = planKanbanMove(ticket, column, actor);
    if (plan.kind === "noop") {
      if (over) setOver(null);
      return;
    }
    const allowed = plan.kind === "update" || plan.kind === "resolve";
    if (allowed) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
    if (over?.column !== column || over.allowed !== allowed) setOver({ column, allowed });
  };

  const onDrop = (e: DragEvent<HTMLElement>, column: KanbanColumnId) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DRAG_MIME);
    const id = Number(raw || draggingId);
    setDraggingId(null);
    setOver(null);
    const ticket = Number.isFinite(id) ? allTickets.get(id) : undefined;
    if (ticket) requestMove(ticket, column);
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" role="list" aria-label="Quadro Kanban de chamados">
        {KANBAN_COLUMNS.map((col) => {
          const items = columns[col.id];
          const state = columnState[col.id];
          const isOver = over?.column === col.id;
          return (
            <section
              key={col.id}
              role="listitem"
              aria-labelledby={`kanban-col-${col.id}`}
              onDragOver={(e) => onDragOver(e, col.id)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
              }}
              onDrop={(e) => onDrop(e, col.id)}
              className={cn(
                "flex min-h-[220px] flex-col rounded-xl border bg-muted/40 p-2.5 transition-colors",
                isOver && over?.allowed ? "border-primary/60 bg-primary/5 ring-2 ring-primary/20" : null,
                isOver && !over?.allowed ? "border-destructive/40 bg-destructive/5" : null,
              )}
            >
              <header className="mb-2 flex items-center justify-between px-1.5 py-1">
                <h2 id={`kanban-col-${col.id}`} className="flex items-center gap-2 text-sm font-semibold">
                  <span className={cn("h-2.5 w-2.5 rounded-full", col.dotClass)} aria-hidden="true" />
                  {col.title}
                </h2>
                <span className="rounded-full border bg-background px-2 py-0.5 text-xs font-semibold tabular-nums" aria-label={`${items.length} chamados`}>
                  {items.length}
                  {state.capped ? "+" : ""}
                </span>
              </header>

              {isOver && !over?.allowed ? (
                <p className="mb-2 flex items-center gap-1.5 px-1.5 text-xs text-destructive">
                  <Lock className="h-3.5 w-3.5" /> Movimento não permitido para esta coluna
                </p>
              ) : null}

              <div className="flex max-h-[68vh] flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
                {state.loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : state.error ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    Não foi possível carregar.
                    <Button type="button" variant="link" size="sm" onClick={() => void refresh()}>
                      Tentar novamente
                    </Button>
                  </div>
                ) : items.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">Nenhum chamado</p>
                ) : (
                  items.map((ticket) => (
                    <KanbanCard
                      key={ticket.id}
                      ticket={ticket}
                      actor={actor}
                      isPending={pending[ticket.id] != null}
                      isDragging={draggingId === ticket.id}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      onMove={requestMove}
                    />
                  ))
                )}
              </div>

              {state.capped ? (
                <button
                  type="button"
                  onClick={onShowAllFinished}
                  className="mt-2 rounded-md px-2 py-1.5 text-center text-xs text-muted-foreground hover:bg-background hover:text-foreground"
                >
                  Mostrando os {KANBAN_FINISHED_LIMIT} mais recentes · Ver todos
                </button>
              ) : null}
            </section>
          );
        })}
      </div>

      <AlertDialog open={confirmMove != null} onOpenChange={(open) => { if (!open) setConfirmMove(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmMove?.plan.confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block font-medium text-foreground">{confirmMove?.ticket.title}</span>
              <span className="mt-1 block">{confirmMove?.plan.confirm?.description}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className={cn(confirmMove?.plan.confirm?.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : null)}
              onClick={() => {
                const move = confirmMove;
                setConfirmMove(null);
                if (move) void runUpdate(move.ticket, move.plan, move.target);
              }}
            >
              {confirmMove?.plan.confirm?.actionLabel ?? "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resolveMove != null} onOpenChange={(open) => { if (!open) { setResolveMove(null); setResolveText(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resolver o chamado #{resolveMove?.ticket.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              Descreva a solução aplicada. A mensagem será registrada no chamado e enviada ao solicitante.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Textarea
              autoFocus
              aria-label="Mensagem de solução"
              placeholder="Ex.: Driver da impressora reinstalado e teste de impressão realizado com sucesso."
              value={resolveText}
              onChange={(e) => setResolveText(e.target.value.slice(0, RESOLVE_MAX))}
              rows={5}
            />
            <p className="text-right text-xs text-muted-foreground">{resolveText.length}/{RESOLVE_MAX}</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={resolveText.trim().length === 0}
              onClick={(e) => {
                e.preventDefault();
                void runResolve();
              }}
            >
              Resolver chamado
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function KanbanCard({
  ticket,
  actor,
  isPending,
  isDragging,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  ticket: Ticket;
  actor: KanbanActor | null;
  isPending: boolean;
  isDragging: boolean;
  onDragStart: (e: DragEvent<HTMLElement>, ticket: Ticket) => void;
  onDragEnd: () => void;
  onMove: (ticket: Ticket, target: KanbanColumnId) => void;
}) {
  const draggable = !isPending && canDragKanbanTicket(ticket, actor);
  const source = kanbanColumnOf(ticket.status);
  const substatus = SUBSTATUS_LABEL[ticket.status];
  const isSoftware = ticket.type === TicketType.SOFTWARE;
  const unit = ticket.establishment || ticket.municipality;
  const lockReason = useMemo(() => {
    if (draggable || isPending) return null;
    for (const c of KANBAN_COLUMNS) {
      const plan = planKanbanMove(ticket, c.id, actor);
      if (plan.kind === "blocked") return plan.reason;
    }
    return null;
  }, [draggable, isPending, ticket, actor]);

  return (
    <div
      className={cn(
        "group relative rounded-lg border bg-card shadow-sm transition",
        draggable ? "cursor-grab active:cursor-grabbing hover:border-primary/40" : null,
        isDragging ? "opacity-40" : null,
        isPending ? "opacity-70" : null,
        ticket.ownerHasCoordinator === false ? "border-amber-400/70" : null,
      )}
      draggable={draggable}
      onDragStart={(e) => onDragStart(e, ticket)}
      onDragEnd={onDragEnd}
      aria-busy={isPending || undefined}
      title={lockReason ?? undefined}
    >
      <Link
        href={`/chamados/${ticket.id}`}
        draggable={false}
        className="block rounded-lg p-3 pr-9 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground tabular-nums">#{ticket.id}</span>
          <PriorityBadge priority={ticket.priority} />
        </div>
        <p className="mt-1 truncate text-sm font-semibold" title={ticket.title}>{ticket.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {ticket.createdBy?.name ?? "—"}
          {unit ? ` · ${unit}` : ""}
        </p>
        {substatus ? (
          <span className="mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {substatus}
          </span>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span
            className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
            style={{
              color: isSoftware ? "var(--series-software)" : "var(--series-hardware)",
              backgroundColor: `color-mix(in srgb, ${isSoftware ? "var(--series-software)" : "var(--series-hardware)"} 12%, transparent)`,
            }}
          >
            {isSoftware ? "Sistema" : "Equipamentos"}
          </span>
          <span className="truncate text-xs font-medium">{ticket.assignedTo?.name ?? "Não atribuído"}</span>
        </div>
      </Link>

      <div className="absolute right-1.5 top-1.5 flex flex-col items-center gap-0.5">
        {isPending ? (
          <Loader2 className="m-1.5 h-4 w-4 animate-spin text-muted-foreground" aria-label="Atualizando" />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground opacity-70 group-hover:opacity-100"
                aria-label={`Mover chamado #${ticket.id}`}
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Mover para</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {KANBAN_COLUMNS.filter((c) => c.id !== source).map((c) => {
                const plan = planKanbanMove(ticket, c.id, actor);
                const blocked = plan.kind === "blocked";
                return (
                  <DropdownMenuItem
                    key={c.id}
                    disabled={blocked}
                    onSelect={() => onMove(ticket, c.id)}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", c.dotClass)} aria-hidden="true" />
                      {c.title}
                    </span>
                    {blocked ? <span className="text-[11px] leading-snug text-muted-foreground">{plan.reason}</span> : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {draggable ? (
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />
        ) : lockReason ? (
          <Lock className="h-3 w-3 text-muted-foreground/60" aria-label={lockReason} />
        ) : null}
      </div>
    </div>
  );
}
