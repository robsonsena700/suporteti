import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, "../../artifacts/api-server/src/lib/dashboard-metrics.ts");
const mod: any = await import(pathToFileURL(modPath).href);
const { computeDashboardMetrics, median, dashboardVisibility, canCountRating } = mod;

// "Agora" fixo: 26/11/2026 15:00 em Sao Paulo (18:00 UTC)
const now = new Date("2026-11-26T18:00:00Z");
const h = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000);
const d = (daysAgo: number) => h(daysAgo * 24);

let nextId = 1;
function row(p: Partial<any>) {
  return {
    id: nextId++,
    title: "t",
    type: "SOFTWARE",
    priority: "MEDIUM",
    status: "OPEN",
    createdAt: h(1),
    updatedAt: h(1),
    createdById: 100,
    createdByName: "Ana",
    assignedToId: null,
    assignedToName: null,
    firstResponseAt: null,
    resolvedAt: null,
    reopened: false,
    rating: null,
    ratedAt: null,
    ...p,
  };
}

const rows = [
  // Sistemas
  row({ type: "SOFTWARE", status: "OPEN", priority: "HIGH", createdAt: h(5), firstResponseAt: h(4.5) }),            // 30 min
  row({ type: "SOFTWARE", status: "IN_PROGRESS", priority: "HIGH", createdAt: h(10), firstResponseAt: h(9), assignedToId: 7, assignedToName: "Bruno" }), // 60 min
  row({ type: "SOFTWARE", status: "RESOLVED", createdAt: h(30), firstResponseAt: h(29.5), resolvedAt: h(26), assignedToId: 7, assignedToName: "Bruno", rating: 5, ratedAt: h(20) }), // 4h
  row({ type: "SOFTWARE", status: "RESOLVED", createdAt: d(3), resolvedAt: d(1), assignedToId: 8, assignedToName: "Carla", reopened: true, createdById: 101, createdByName: "Davi", rating: 2, ratedAt: d(1) }), // 48h
  row({ type: "SOFTWARE", status: "CLOSED", createdAt: d(2) }),
  // Equipamentos
  row({ type: "HARDWARE", status: "OPEN", priority: "LOW", createdAt: h(2) }),
  row({ type: "HARDWARE", status: "AWAITING_CUSTOMER", priority: "HIGH", createdAt: d(4), firstResponseAt: d(3.9), createdById: 101, createdByName: "Davi" }),
  row({ type: "HARDWARE", status: "RESOLVED", createdAt: h(12), firstResponseAt: h(11), resolvedAt: h(6), assignedToId: 7, assignedToName: "Bruno", rating: 4, ratedAt: h(5) }), // 6h
  // Fora do periodo de 7 dias (40 dias atras), mas conta nas contagens atuais
  row({ type: "HARDWARE", status: "RESOLVED", createdAt: d(40), resolvedAt: d(39), assignedToId: 7, assignedToName: "Bruno", rating: 1, ratedAt: d(39) }),
  // Resolvido e depois reaberto: status ativo, NAO conta como resolvido no periodo
  row({ type: "SOFTWARE", status: "IN_PROGRESS", createdAt: d(2), resolvedAt: d(1), reopened: true, assignedToId: 8, assignedToName: "Carla" }),
];

const admin = computeDashboardMetrics(rows, { now, days: 7, role: "ADMIN", userId: 1 });

// Periodo
assert.equal(admin.period.days, 7);
assert.equal(admin.period.to, "2026-11-26");
assert.equal(admin.period.from, "2026-11-20");
assert.equal(admin.daily.length, 7);

// Contagens atuais (todo o historico)
assert.deepEqual(admin.statusCounts.SOFTWARE, { total: 6, open: 1, inProgress: 2, resolved: 2, cancelled: 1 });
assert.deepEqual(admin.statusCounts.HARDWARE, { total: 4, open: 1, inProgress: 1, resolved: 2, cancelled: 0 });
assert.equal(admin.statusCounts.ALL.total, 10);
assert.equal(admin.statusCounts.ALL.inProgress, 3);

// Abertos no periodo: 9 (o de 40 dias fica fora)
assert.equal(admin.kpis.ALL.createdInPeriod, 9);
assert.equal(admin.kpis.SOFTWARE.createdInPeriod, 6);

// 1a resposta (Sistemas): 30, 60, 30 min -> mediana 30, media 40
assert.equal(admin.kpis.SOFTWARE.firstResponse.sample, 3);
assert.equal(admin.kpis.SOFTWARE.firstResponse.medianMinutes, 30);
assert.equal(admin.kpis.SOFTWARE.firstResponse.avgMinutes, 40);

// Resolucao no periodo (status atual RESOLVED): Sistemas 4h e 48h
assert.equal(admin.kpis.SOFTWARE.resolvedInPeriod, 2);
assert.equal(admin.kpis.SOFTWARE.resolution.avgHours, 26);
assert.equal(admin.kpis.SOFTWARE.resolution.medianHours, 26);
assert.equal(admin.kpis.HARDWARE.resolution.avgHours, 6);
assert.equal(admin.kpis.ALL.resolvedInPeriod, 3);

// Reabertura (Sistemas, abertos no periodo que ja finalizaram alguma vez):
// resolvido 4h, resolvido reaberto, cancelado, ativo reaberto -> 2 de 4
assert.equal(admin.kpis.SOFTWARE.reopen.resolved, 4);
assert.equal(admin.kpis.SOFTWARE.reopen.reopened, 2);
assert.equal(admin.kpis.SOFTWARE.reopen.rate, 0.5);

// Grafico diario soma o mesmo que os KPIs
const sum = (k: string) => admin.daily.reduce((a: number, x: any) => a + x[k], 0);
assert.equal(sum("createdSoftware") + sum("createdHardware"), admin.kpis.ALL.createdInPeriod);
assert.equal(sum("resolvedSoftware") + sum("resolvedHardware"), admin.kpis.ALL.resolvedInPeriod);

// Criticidade dos ativos
assert.deepEqual(admin.priorityActive, [
  { priority: "HIGH", software: 2, hardware: 1 },
  { priority: "MEDIUM", software: 1, hardware: 0 },
  { priority: "LOW", software: 0, hardware: 1 },
]);

// Solicitantes: Ana 7, Davi 2 (no periodo)
assert.equal(admin.topRequesters[0].name, "Ana");
assert.equal(admin.topRequesters[0].total, 7);
assert.deepEqual(admin.topRequesters[1], { userId: 101, name: "Davi", software: 1, hardware: 1, total: 2 });

// Responsaveis: Bruno resolveu 2 no periodo (4h e 6h), tem 1 ativo
const bruno = admin.assignees.find((a: any) => a.name === "Bruno");
assert.deepEqual(bruno, { userId: 7, name: "Bruno", resolvedSoftware: 1, resolvedHardware: 1, resolvedTotal: 2, avgResolutionHours: 5, activeNow: 1 });

// CSAT ADMIN: notas no periodo 5, 2, 4 (a nota 1 de 39 dias atras fica fora)
assert.equal(admin.ratings.ALL.count, 3);
assert.equal(admin.ratings.ALL.avg, 3.67);
assert.deepEqual(admin.ratings.ALL.distribution, [0, 1, 0, 1, 1]);
assert.equal(admin.ratings.ALL.coverage, 1); // 3 resolvidos no periodo, 3 avaliados

// Atividade recente: ordenada por atualizacao (ate 20; aqui ha 10 chamados)
assert.equal(admin.recent.length, 10);
assert.ok(new Date(admin.recent[0].updatedAt) >= new Date(admin.recent[1].updatedAt));

// ---- Regras por perfil ----
assert.deepEqual(dashboardVisibility("ADMIN"), { role: "ADMIN", showRequesters: true, showAssignees: true, showRatings: true });
assert.deepEqual(dashboardVisibility("ANALYST"), { role: "ANALYST", showRequesters: true, showAssignees: true, showRatings: true });
assert.deepEqual(dashboardVisibility("COORDINATOR"), { role: "COORDINATOR", showRequesters: true, showAssignees: true, showRatings: true });
assert.deepEqual(dashboardVisibility("GESTOR"), { role: "GESTOR", showRequesters: true, showAssignees: false, showRatings: false });
assert.deepEqual(dashboardVisibility("USER"), { role: "USER", showRequesters: false, showAssignees: false, showRatings: true });

const userM = computeDashboardMetrics(rows.filter((r: any) => r.createdById === 101), { now, days: 7, role: "USER", userId: 101 });
assert.equal(userM.topRequesters, null);
assert.equal(userM.assignees, null);
assert.equal(userM.ratings.ALL.count, 1); // so a avaliacao do proprio chamado

const gestorM = computeDashboardMetrics(rows, { now, days: 7, role: "GESTOR", userId: 50 });
assert.equal(gestorM.ratings, null);
assert.equal(gestorM.assignees, null);
assert.notEqual(gestorM.topRequesters, null);

// ANALYST ve todos os chamados, mas so as avaliacoes dos atribuidos a ele (Bruno = 7)
const analystM = computeDashboardMetrics(rows, { now, days: 7, role: "ANALYST", userId: 7 });
assert.equal(analystM.statusCounts.ALL.total, 10);
assert.equal(analystM.ratings.ALL.count, 2); // notas 5 e 4
assert.equal(analystM.ratings.ALL.avg, 4.5);
assert.equal(canCountRating(rows[3], "ANALYST", 7), false);
assert.equal(canCountRating(rows[3], "COORDINATOR", 99), true);

// Vazio nao quebra
const empty = computeDashboardMetrics([], { now, days: 30, role: "ADMIN", userId: 1 });
assert.equal(empty.kpis.ALL.firstResponse.avgMinutes, null);
assert.equal(empty.kpis.ALL.reopen.rate, null);
assert.equal(empty.ratings.ALL.coverage, null);
assert.equal(empty.daily.length, 30);

assert.equal(median([3, 1, 2]), 2);
assert.equal(median([4, 1, 2, 3]), 2.5);
assert.equal(median([]), null);

console.log("OK: test-dashboard-metrics-unit");
