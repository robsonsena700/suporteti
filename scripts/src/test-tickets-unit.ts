import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilPath = path.resolve(__dirname, "../../artifacts/suporte-ti/src/lib/tickets-utils.ts");
const mod = await import(pathToFileURL(utilPath).href);

const { formatUfMunicipality, filterAndSortTickets } = mod as {
  formatUfMunicipality: (uf: string, municipality: string) => string;
  filterAndSortTickets: (tickets: any[], opts?: any) => any[];
};

assert.equal(formatUfMunicipality("SP", "São Paulo"), "SP - São Paulo");

const tickets = [
  { id: 1, uf: "SP", municipality: "São Paulo", createdAt: "2026-01-01T00:00:00.000Z", createdBy: { name: "Ana" }, assignedTo: { name: "Carlos" } },
  { id: 2, uf: "RJ", municipality: "Rio de Janeiro", createdAt: "2026-01-02T00:00:00.000Z", createdBy: { name: "Bruno" }, assignedTo: null },
  { id: 3, uf: "SP", municipality: "Campinas", createdAt: "2026-01-03T00:00:00.000Z", createdBy: { name: "Ana" }, assignedTo: { name: "Beatriz" } },
];

const onlyAna = filterAndSortTickets(tickets, { userFilter: "ana" });
assert.deepEqual(onlyAna.map(t => t.id).sort((a: number, b: number) => a - b), [1, 3]);

const onlySp = filterAndSortTickets(tickets, { locationFilter: "sp - " });
assert.deepEqual(onlySp.map(t => t.id).sort((a: number, b: number) => a - b), [1, 3]);

const onlyCarlos = filterAndSortTickets(tickets, { responsibleFilter: "carlos" });
assert.deepEqual(onlyCarlos.map(t => t.id), [1]);

const sortedUserAsc = filterAndSortTickets(tickets, { sortBy: "user", sortDir: "asc" });
assert.deepEqual(sortedUserAsc.map(t => t.id), [1, 3, 2]);

console.log("Teste unitário do módulo de chamados (cards/filtros/ordenação) concluído com sucesso.");

