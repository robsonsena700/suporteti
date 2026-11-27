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

{
  const { buildTicketsPageItems, getTicketsPageInfo, normalizeTicketsPageSize } = mod as {
    buildTicketsPageItems: (current: number, total: number) => Array<number | string>;
    getTicketsPageInfo: (total: number, page: number, size: number) => { page: number; totalPages: number; start: number; end: number; total: number };
    normalizeTicketsPageSize: (v: unknown) => number;
  };

  assert.equal(normalizeTicketsPageSize(undefined), 18);
  assert.equal(normalizeTicketsPageSize("20"), 20);
  assert.equal(normalizeTicketsPageSize(15), 15);
  assert.equal(normalizeTicketsPageSize(50), 18);

  assert.deepEqual(getTicketsPageInfo(74, 1, 18), { page: 1, totalPages: 5, start: 1, end: 18, total: 74 });
  assert.deepEqual(getTicketsPageInfo(74, 5, 18), { page: 5, totalPages: 5, start: 73, end: 74, total: 74 });
  assert.deepEqual(getTicketsPageInfo(74, 99, 18), { page: 5, totalPages: 5, start: 73, end: 74, total: 74 });
  assert.deepEqual(getTicketsPageInfo(74, 0, 18), { page: 1, totalPages: 5, start: 1, end: 18, total: 74 });
  assert.deepEqual(getTicketsPageInfo(0, 3, 18), { page: 1, totalPages: 1, start: 0, end: 0, total: 0 });
  assert.equal(getTicketsPageInfo(1566, 1, 20).totalPages, 79);

  assert.deepEqual(buildTicketsPageItems(1, 1), [1]);
  assert.deepEqual(buildTicketsPageItems(1, 3), [1, 2, 3]);
  assert.deepEqual(buildTicketsPageItems(1, 5), [1, 2, "ellipsis-end", 5]);
  assert.deepEqual(buildTicketsPageItems(3, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(buildTicketsPageItems(5, 5), [1, "ellipsis-start", 4, 5]);
  assert.deepEqual(buildTicketsPageItems(5, 10), [1, "ellipsis-start", 4, 5, 6, "ellipsis-end", 10]);
  assert.deepEqual(buildTicketsPageItems(40, 79), [1, "ellipsis-start", 39, 40, 41, "ellipsis-end", 79]);
}

{
  const { resolveTicketsPeriodRange, isWithinTicketsPeriod } = mod as any;
  const exp = await import(pathToFileURL(path.resolve(__dirname, "../../artifacts/suporte-ti/src/lib/tickets-export.ts")).href);
  const now = new Date(2026, 10, 27, 15, 0, 0);
  const all = resolveTicketsPeriodRange("all", null, null, now);
  assert.deepEqual(all, { start: null, end: null });
  assert.equal(isWithinTicketsPeriod("2020-01-01T00:00:00Z", all), true);

  const today = resolveTicketsPeriodRange("today", null, null, now);
  assert.equal(today.start, new Date(2026, 10, 27).getTime());
  assert.equal(isWithinTicketsPeriod(new Date(2026, 10, 27, 0, 5), today), true);
  assert.equal(isWithinTicketsPeriod(new Date(2026, 10, 26, 23, 59), today), false);

  const d7 = resolveTicketsPeriodRange("7d", null, null, now);
  assert.equal(d7.start, new Date(2026, 10, 21).getTime());

  const custom = resolveTicketsPeriodRange("custom", "2026-11-01", "2026-11-10", now);
  assert.equal(isWithinTicketsPeriod(new Date(2026, 10, 10, 23, 30), custom), true);
  assert.equal(isWithinTicketsPeriod(new Date(2026, 10, 11, 0, 1), custom), false);
  assert.equal(isWithinTicketsPeriod(new Date(2026, 9, 31, 23, 59), custom), false);
  const swapped = resolveTicketsPeriodRange("custom", "2026-11-10", "2026-11-01", now);
  assert.deepEqual(swapped, custom);
  assert.deepEqual(resolveTicketsPeriodRange("custom", "", "lixo", now), { start: null, end: null });
  assert.equal(isWithinTicketsPeriod(null, custom), false);

  // Exportação: CSV seguro (sem fórmulas) e HTML escapado
  assert.equal(exp.csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(exp.csvCell('a;b"c'), '"a;b""c"');
  assert.equal(exp.csvCell("linha1\nlinha2"), "linha1 linha2");
  const csv = exp.buildTicketsCsv([{ id: 7, title: "Impressora; sala 2", status: "OPEN", priority: "HIGH", type: "HARDWARE", uf: "CE", municipality: "Fortaleza", createdAt: new Date(2026, 10, 1, 9, 5), createdBy: { name: "Ana" }, assignedTo: null, emailSentCount: 0 }]);
  assert.ok(csv.startsWith("\uFEFFID;Título;Status"));
  assert.ok(csv.includes('7;"Impressora; sala 2";Aberto;Alta;Equipamentos;Ana;CE;Fortaleza;;Não atribuído;01/11/2026 09:05;;Não'));
  const html = exp.buildTicketsPrintHtml([{ id: 1, title: "<script>x</script>", status: "OPEN", priority: "LOW", type: "SOFTWARE", createdAt: now }], { title: "T", filters: [], generatedAt: now });
  assert.ok(!html.includes("<script>x"));
  assert.ok(html.includes("&lt;script&gt;x&lt;/script&gt;"));
}
