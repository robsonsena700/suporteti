export const TICKET_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "AWAITING_CUSTOMER",
  "IN_DEVELOPMENT",
  "RESOLVED",
  "CLOSED",
] as const;

export type TicketStatusValue = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS_CONFLICT_MESSAGE =
  "O chamado foi atualizado por outra pessoa enquanto você o movia. Atualize a lista para ver o status atual.";

/**
 * Lê o campo opcional `expectedStatus` do corpo da requisição (controle de concorrência otimista).
 * - `null`: campo ausente (comportamento antigo, sem verificação);
 * - `"invalid"`: campo presente com valor desconhecido;
 * - status válido: a atualização só deve acontecer se o chamado ainda estiver nesse status.
 */
export function parseExpectedStatus(body: unknown): TicketStatusValue | null | "invalid" {
  if (!body || typeof body !== "object") return null;
  const raw = (body as Record<string, unknown>).expectedStatus;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return "invalid";
  const normalized = raw.trim().toUpperCase();
  return (TICKET_STATUSES as readonly string[]).includes(normalized)
    ? (normalized as TicketStatusValue)
    : "invalid";
}

/** Limite opcional da listagem de resolvidos/cancelados (usado pelo quadro Kanban). */
export function parseListLimit(raw: unknown, max = 200): number | null | "invalid" {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" && typeof raw !== "number") return "invalid";
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1) return "invalid";
  return Math.min(n, max);
}
