// Regras do quadro Kanban de chamados. Espelham as regras da API (que continua sendo a autoridade):
// - lib/ticket-reassign-policy.ts (responsável obrigatório para mudar status);
// - lib/ticket-reopen-policy.ts (reabrir cancelado: só Admin/Analista em até 24h);
// - POST /tickets/:id/resolve (resolver exige mensagem de solução; cancelado não pode ser resolvido).

export type KanbanColumnId = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export const KANBAN_COLUMNS: ReadonlyArray<{ id: KanbanColumnId; title: string; statuses: readonly string[]; dotClass: string }> = [
  { id: "OPEN", title: "Abertos", statuses: ["OPEN"], dotClass: "bg-slate-900 dark:bg-slate-200" },
  { id: "IN_PROGRESS", title: "Em Andamento", statuses: ["IN_PROGRESS", "AWAITING_CUSTOMER", "IN_DEVELOPMENT"], dotClass: "bg-orange-500" },
  { id: "RESOLVED", title: "Resolvidos", statuses: ["RESOLVED"], dotClass: "bg-emerald-600" },
  { id: "CLOSED", title: "Cancelados", statuses: ["CLOSED"], dotClass: "bg-slate-500" },
];

export const REOPEN_WINDOW_MS = 24 * 60 * 60 * 1000;

const MANAGER_ROLES = new Set(["ADMIN", "ANALYST", "COORDINATOR", "GESTOR"]);
const ASSIGNEE_ROLES = new Set(["ADMIN", "ANALYST", "COORDINATOR"]);

export function kanbanColumnOf(status: string | null | undefined): KanbanColumnId | null {
  const s = String(status ?? "").toUpperCase();
  for (const col of KANBAN_COLUMNS) {
    if (col.statuses.includes(s)) return col.id;
  }
  return null;
}

export type KanbanTicket = {
  id: number;
  status: string;
  createdById?: number | null;
  createdBy?: { id?: number | null } | null;
  assignedToId?: number | null;
  assignedTo?: { id?: number | null; role?: string | null } | null;
  updatedAt?: string | Date | null;
};

export type KanbanActor = { id: number; role: string };

export type KanbanMovePlan =
  | { kind: "noop" }
  | { kind: "blocked"; reason: string }
  | { kind: "update"; status: string; expectedStatus: string; confirm?: { title: string; description: string; actionLabel: string; destructive?: boolean } }
  | { kind: "resolve"; expectedStatus: string };

function ownerId(t: KanbanTicket): number | null {
  return t.createdById ?? t.createdBy?.id ?? null;
}

function assigneeId(t: KanbanTicket): number | null {
  return t.assignedToId ?? t.assignedTo?.id ?? null;
}

export function hasValidKanbanAssignee(t: KanbanTicket): boolean {
  const role = String(t.assignedTo?.role ?? "").toUpperCase();
  return assigneeId(t) != null && ASSIGNEE_ROLES.has(role);
}

/** Mesma regra de "pode interagir" da tela de detalhe (colaboradores não vêm na listagem). */
export function canActorInteract(t: KanbanTicket, actor: KanbanActor): boolean {
  const role = actor.role.toUpperCase();
  return role === "ADMIN" || role === "ANALYST" || ownerId(t) === actor.id || assigneeId(t) === actor.id;
}

export function canActorReopenClosed(t: KanbanTicket, actor: KanbanActor, now: number = Date.now()): boolean {
  const role = actor.role.toUpperCase();
  if (role !== "ADMIN" && role !== "ANALYST") return false;
  const closedAt = t.updatedAt ? new Date(t.updatedAt).getTime() : NaN;
  if (!Number.isFinite(closedAt)) return false;
  const diff = now - closedAt;
  return diff >= 0 && diff <= REOPEN_WINDOW_MS;
}

/** Decide o que acontece ao soltar um card em uma coluna. Nunca altera nada: só planeja. */
export function planKanbanMove(
  ticket: KanbanTicket,
  target: KanbanColumnId,
  actor: KanbanActor | null | undefined,
  now: number = Date.now(),
): KanbanMovePlan {
  const source = kanbanColumnOf(ticket.status);
  if (!source || source === target) return { kind: "noop" };
  if (!actor || !MANAGER_ROLES.has(actor.role.toUpperCase())) {
    return { kind: "blocked", reason: "Seu perfil não permite alterar o status dos chamados." };
  }
  if (!canActorInteract(ticket, actor)) {
    return { kind: "blocked", reason: "Você não participa deste chamado. Abra o chamado para colaborar ou peça a atribuição." };
  }
  if (source === "CLOSED" && !canActorReopenClosed(ticket, actor, now)) {
    return { kind: "blocked", reason: "Reabertura permitida apenas para Admin/Analista em até 24h após o cancelamento." };
  }
  if (target !== "OPEN" && !hasValidKanbanAssignee(ticket)) {
    return { kind: "blocked", reason: "Atribua um responsável (Admin, Coordenador ou Analista) antes de mudar o status." };
  }

  const expectedStatus = ticket.status;
  if (target === "RESOLVED") {
    if (source === "CLOSED") {
      return { kind: "blocked", reason: "Chamados cancelados não podem ser marcados como resolvidos." };
    }
    return { kind: "resolve", expectedStatus };
  }
  if (target === "CLOSED") {
    return {
      kind: "update",
      status: "CLOSED",
      expectedStatus,
      confirm: {
        title: `Cancelar o chamado #${ticket.id}?`,
        description: "O chamado será marcado como Cancelado. A reabertura só poderá ser feita por Admin/Analista em até 24h.",
        actionLabel: "Cancelar chamado",
        destructive: true,
      },
    };
  }
  const nextStatus = target === "OPEN" ? "OPEN" : "IN_PROGRESS";
  if (source === "RESOLVED" || source === "CLOSED") {
    return {
      kind: "update",
      status: nextStatus,
      expectedStatus,
      confirm: {
        title: `Reabrir o chamado #${ticket.id}?`,
        description: `O chamado sairá de "${source === "RESOLVED" ? "Resolvidos" : "Cancelados"}" e voltará para "${target === "OPEN" ? "Abertos" : "Em Andamento"}".`,
        actionLabel: "Reabrir chamado",
      },
    };
  }
  return { kind: "update", status: nextStatus, expectedStatus };
}

/** Se o card pode ao menos ser arrastado (há alguma coluna de destino permitida). */
export function canDragKanbanTicket(ticket: KanbanTicket, actor: KanbanActor | null | undefined, now: number = Date.now()): boolean {
  return KANBAN_COLUMNS.some((c) => {
    const plan = planKanbanMove(ticket, c.id, actor, now);
    return plan.kind === "update" || plan.kind === "resolve";
  });
}

export function matchesTicketQuickSearch(
  t: {
    id: number;
    title?: string | null;
    createdBy?: { name?: string | null } | null;
    assignedTo?: { name?: string | null } | null;
    establishment?: string | null;
    municipality?: string | null;
    uf?: string | null;
  },
  query: string,
): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (!q) return true;
  if (/^\d+$/.test(q) && String(t.id).startsWith(q)) return true;
  const hay = [t.title, t.createdBy?.name, t.assignedTo?.name, t.establishment, t.municipality, t.uf]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const needle = q.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return hay.includes(needle);
}
