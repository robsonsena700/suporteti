#!/usr/bin/env node
// Confere, com dados reais e por perfil, que o Painel de Controle mostra
// exatamente os mesmos chamados que a tela de Chamados mostra para o mesmo
// usuario (mesma regra de visibilidade). Somente leitura: nao altera nada.
//
// Uso (API local rodando, de preferencia com a copia do banco de producao):
//   set API_BASE=http://localhost:3001
//   set DASH_LOGINS=admin@x.com:senha;coord@x.com:senha;gestor@x.com:senha;user@x.com:senha
//   node scripts/test-dashboard-consistency-integration.cjs
const API_BASE = process.env.API_BASE || "http://localhost:3001";
const LOGINS = String(process.env.DASH_LOGINS || "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const i = s.indexOf(":");
    return { email: s.slice(0, i), password: s.slice(i + 1) };
  });

if (LOGINS.length === 0) {
  console.error("Defina DASH_LOGINS=email:senha;email2:senha2 (um usuario de cada perfil que quiser conferir).");
  process.exit(1);
}

async function jsonFetch(url, options = {}) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: resp.ok, status: resp.status, data };
}

const ACTIVE = new Set(["IN_PROGRESS", "AWAITING_CUSTOMER", "IN_DEVELOPMENT"]);
const EXPECTED_VIS = {
  ADMIN: { showRequesters: true, showAssignees: true, showRatings: true },
  ANALYST: { showRequesters: true, showAssignees: true, showRatings: true },
  COORDINATOR: { showRequesters: true, showAssignees: true, showRatings: true },
  GESTOR: { showRequesters: true, showAssignees: false, showRatings: false },
  USER: { showRequesters: false, showAssignees: false, showRatings: true },
};

function countsFromLists(active, finished, type) {
  const a = active.filter((t) => !type || t.type === type);
  const f = finished.filter((t) => !type || t.type === type);
  return {
    open: a.filter((t) => t.status === "OPEN").length,
    inProgress: a.filter((t) => ACTIVE.has(t.status)).length,
    resolved: f.filter((t) => t.status === "RESOLVED").length,
    cancelled: f.filter((t) => t.status === "CLOSED").length,
  };
}

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FALHA"} ${label}${ok ? "" : `\n        painel: ${JSON.stringify(actual)}\n        lista:  ${JSON.stringify(expected)}`}`);
}

(async () => {
  for (const { email, password } of LOGINS) {
    const login = await jsonFetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!login.ok || !login.data?.token) {
      console.log(`\n[${email}] falha no login (${login.status})`);
      failures++;
      continue;
    }
    const h = { Authorization: `Bearer ${login.data.token}` };
    const [me, active, finished, dash] = await Promise.all([
      jsonFetch(`${API_BASE}/api/auth/me`, { headers: h }),
      jsonFetch(`${API_BASE}/api/tickets`, { headers: h }),
      jsonFetch(`${API_BASE}/api/tickets/resolved`, { headers: h }),
      jsonFetch(`${API_BASE}/api/reports/dashboard?days=30`, { headers: h }),
    ]);
    const role = me.data?.role;
    console.log(`\n[${email}] perfil ${role}`);
    if (!active.ok || !finished.ok || !dash.ok) {
      console.log(`  FALHA nas chamadas: tickets=${active.status} resolved=${finished.status} dashboard=${dash.status}`);
      failures++;
      continue;
    }
    const pick = (c) => ({ open: c.open, inProgress: c.inProgress, resolved: c.resolved, cancelled: c.cancelled });
    check("Todos", pick(dash.data.statusCounts.ALL), countsFromLists(active.data, finished.data));
    check("Sistemas", pick(dash.data.statusCounts.SOFTWARE), countsFromLists(active.data, finished.data, "SOFTWARE"));
    check("Equipamentos", pick(dash.data.statusCounts.HARDWARE), countsFromLists(active.data, finished.data, "HARDWARE"));
    const vis = dash.data.visibility;
    check("Blocos visiveis para o perfil", { showRequesters: vis.showRequesters, showAssignees: vis.showAssignees, showRatings: vis.showRatings }, EXPECTED_VIS[role]);
    check("Ranking de solicitantes oculto/visivel", dash.data.topRequesters === null, !EXPECTED_VIS[role].showRequesters);
    check("Desempenho por responsavel oculto/visivel", dash.data.assignees === null, !EXPECTED_VIS[role].showAssignees);
    check("Avaliacoes oculto/visivel", dash.data.ratings === null, !EXPECTED_VIS[role].showRatings);
    if (role === "USER") {
      const foreign = [...active.data, ...finished.data].filter((t) => t.createdById !== me.data.id).length;
      check("USER so enxerga os proprios chamados", foreign, 0);
    }
  }
  console.log(failures === 0 ? "\nTUDO CONFERE." : `\n${failures} verificacao(oes) com divergencia.`);
  process.exit(failures === 0 ? 0 : 1);
})();
