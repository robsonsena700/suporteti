import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kanban = await import(pathToFileURL(path.resolve(__dirname, "../../artifacts/suporte-ti/src/lib/tickets-kanban.ts")).href);
const concurrency = await import(pathToFileURL(path.resolve(__dirname, "../../artifacts/api-server/src/lib/ticket-status-concurrency.ts")).href);

const { planKanbanMove, kanbanColumnOf, canDragKanbanTicket, matchesTicketQuickSearch } = kanban as any;
const { parseExpectedStatus, parseListLimit } = concurrency as any;

const NOW = new Date("2026-11-27T12:00:00Z").getTime();
const admin = { id: 1, role: "ADMIN" };
const analyst = { id: 2, role: "ANALYST" };
const coord = { id: 3, role: "COORDINATOR" };
const gestor = { id: 4, role: "GESTOR" };
const user = { id: 5, role: "USER" };

const base = {
  id: 100,
  status: "OPEN",
  createdById: 5,
  assignedToId: 3,
  assignedTo: { id: 3, role: "COORDINATOR" },
  updatedAt: "2026-11-27T10:00:00Z",
};

// Colunas
assert.equal(kanbanColumnOf("OPEN"), "OPEN");
assert.equal(kanbanColumnOf("AWAITING_CUSTOMER"), "IN_PROGRESS");
assert.equal(kanbanColumnOf("IN_DEVELOPMENT"), "IN_PROGRESS");
assert.equal(kanbanColumnOf("RESOLVED"), "RESOLVED");
assert.equal(kanbanColumnOf("CLOSED"), "CLOSED");
assert.equal(kanbanColumnOf("XYZ"), null);

// Mesma coluna = nada a fazer
assert.equal(planKanbanMove(base, "OPEN", admin, NOW).kind, "noop");
assert.equal(planKanbanMove({ ...base, status: "AWAITING_CUSTOMER" }, "IN_PROGRESS", admin, NOW).kind, "noop");

// Perfil sem gestão não move
assert.equal(planKanbanMove(base, "IN_PROGRESS", user, NOW).kind, "blocked");
assert.equal(planKanbanMove(base, "IN_PROGRESS", null, NOW).kind, "blocked");
assert.equal(canDragKanbanTicket(base, user, NOW), false);

// Aberto -> Em andamento (direto, com status esperado)
assert.deepEqual(planKanbanMove(base, "IN_PROGRESS", admin, NOW), { kind: "update", status: "IN_PROGRESS", expectedStatus: "OPEN" });
assert.deepEqual(planKanbanMove(base, "IN_PROGRESS", coord, NOW), { kind: "update", status: "IN_PROGRESS", expectedStatus: "OPEN" });

// Gestor/coordenador que não participa do chamado não move
assert.equal(planKanbanMove({ ...base, assignedToId: 9, assignedTo: { id: 9, role: "ANALYST" } }, "IN_PROGRESS", coord, NOW).kind, "blocked");
assert.equal(planKanbanMove(base, "IN_PROGRESS", gestor, NOW).kind, "blocked");
assert.equal(planKanbanMove({ ...base, createdById: 4 }, "IN_PROGRESS", gestor, NOW).kind, "update");

// Sem responsável válido: só pode ir para Abertos
const noAssignee = { ...base, status: "IN_PROGRESS", assignedToId: null, assignedTo: null };
assert.equal(planKanbanMove({ ...base, assignedToId: null, assignedTo: null }, "IN_PROGRESS", admin, NOW).kind, "blocked");
assert.equal(planKanbanMove({ ...base, assignedTo: { id: 3, role: "GESTOR" } }, "IN_PROGRESS", admin, NOW).kind, "blocked");
assert.equal(planKanbanMove(noAssignee, "OPEN", admin, NOW).kind, "update");

// Resolver exige mensagem (diálogo)
assert.deepEqual(planKanbanMove(base, "RESOLVED", analyst, NOW), { kind: "resolve", expectedStatus: "OPEN" });

// Cancelar pede confirmação destrutiva
const cancel = planKanbanMove(base, "CLOSED", admin, NOW);
assert.equal(cancel.kind, "update");
assert.equal(cancel.status, "CLOSED");
assert.equal(cancel.confirm.destructive, true);

// Reabrir resolvido pede confirmação
const reopenResolved = planKanbanMove({ ...base, status: "RESOLVED" }, "IN_PROGRESS", coord, NOW);
assert.equal(reopenResolved.kind, "update");
assert.equal(reopenResolved.expectedStatus, "RESOLVED");
assert.ok(reopenResolved.confirm);

// Cancelado: só Admin/Analista em 24h; nunca para Resolvidos
const closed = { ...base, status: "CLOSED", updatedAt: "2026-11-27T02:00:00Z" };
assert.equal(planKanbanMove(closed, "OPEN", coord, NOW).kind, "blocked");
assert.equal(planKanbanMove(closed, "OPEN", admin, NOW).kind, "update");
assert.equal(planKanbanMove(closed, "RESOLVED", admin, NOW).kind, "blocked");
const oldClosed = { ...closed, updatedAt: "2026-11-25T02:00:00Z" };
assert.equal(planKanbanMove(oldClosed, "OPEN", admin, NOW).kind, "blocked");
assert.equal(canDragKanbanTicket(oldClosed, admin, NOW), false);
assert.equal(canDragKanbanTicket(closed, admin, NOW), true);

// Busca rápida
const t = { id: 1806, title: "Impressora de etiqueta", createdBy: { name: "Alex Brito" }, assignedTo: { name: "Aurean Marinho" }, establishment: "Hospital São Paulo", municipality: "Fortaleza", uf: "CE" };
assert.equal(matchesTicketQuickSearch(t, ""), true);
assert.equal(matchesTicketQuickSearch(t, "#1806"), true);
assert.equal(matchesTicketQuickSearch(t, "180"), true);
assert.equal(matchesTicketQuickSearch(t, "sao paulo"), true);
assert.equal(matchesTicketQuickSearch(t, "ALEX"), true);
assert.equal(matchesTicketQuickSearch(t, "monitor"), false);
assert.equal(matchesTicketQuickSearch(t, "aurean"), true);
assert.equal(matchesTicketQuickSearch(t, "ce"), true);
assert.equal(matchesTicketQuickSearch(t, "fortaleza"), true);
assert.equal(matchesTicketQuickSearch(t, "rj"), false);

// API: status esperado e limite
assert.equal(parseExpectedStatus({}), null);
assert.equal(parseExpectedStatus(null), null);
assert.equal(parseExpectedStatus({ expectedStatus: "open" }), "OPEN");
assert.equal(parseExpectedStatus({ expectedStatus: "FOO" }), "invalid");
assert.equal(parseExpectedStatus({ expectedStatus: 3 }), "invalid");
assert.equal(parseListLimit(undefined), null);
assert.equal(parseListLimit("50"), 50);
assert.equal(parseListLimit("9999"), 200);
assert.equal(parseListLimit("0"), "invalid");
assert.equal(parseListLimit("abc"), "invalid");

console.log("Teste unitário do quadro Kanban de chamados concluído com sucesso.");
