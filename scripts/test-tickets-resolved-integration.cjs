#!/usr/bin/env node
const API_BASE = process.env.API_BASE || "http://localhost:3001";
const USER_EMAIL = process.env.USER_EMAIL;
const USER_PASSWORD = process.env.USER_PASSWORD;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!USER_EMAIL || !USER_PASSWORD || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  fail("Defina USER_EMAIL, USER_PASSWORD, ADMIN_EMAIL e ADMIN_PASSWORD.");
}

async function jsonFetch(url, options = {}) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: resp.ok, status: resp.status, data };
}

async function login(email, password) {
  const r = await jsonFetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok || !r.data?.token) fail(`Falha no login (${email}): ${r.status}`);
  return r.data.token;
}

async function createTicket(token, title) {
  const r = await jsonFetch(`${API_BASE}/api/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title,
      description: `Integração: ${title}`,
      type: "SOFTWARE",
      priority: "MEDIUM",
    }),
  });
  if (!r.ok || !r.data?.id) fail(`Falha ao criar ticket: ${r.status}`);
  return r.data.id;
}

async function updateTicketStatus(token, id, status) {
  const r = await jsonFetch(`${API_BASE}/api/tickets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  });
  if (!r.ok) fail(`Falha ao atualizar status do ticket ${id}: ${r.status}`);
  return r.data;
}

async function resolveTicket(token, id, message) {
  const r = await jsonFetch(`${API_BASE}/api/tickets/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
  return r;
}

async function getUserIdByEmail(adminToken, email) {
  const r = await jsonFetch(`${API_BASE}/api/users/assignable`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!r.ok || !Array.isArray(r.data)) fail(`Falha ao listar usuários (admin). Status: ${r.status}`);
  const found = r.data.find((u) => String(u.email || "").toLowerCase() === String(email).toLowerCase());
  if (!found?.id) fail(`Usuário não encontrado por email: ${email}`);
  return { id: found.id, name: found.name };
}

async function assignTicket(adminToken, id, assignedToId) {
  const r = await jsonFetch(`${API_BASE}/api/tickets/${id}/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ assignedToId, reason: "Atribuição obrigatória para testes de status" }),
  });
  if (!r.ok) fail(`Falha ao atribuir ticket: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

async function listMessages(token, id) {
  const r = await jsonFetch(`${API_BASE}/api/tickets/${id}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok || !Array.isArray(r.data)) fail(`Falha ao listar mensagens: ${r.status}`);
  return r.data;
}

(async () => {
  const userToken = await login(USER_EMAIL, USER_PASSWORD);
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

  const title = `ticket-resolved-integration-${Date.now()}`;
  const ticketId = await createTicket(userToken, title);

  const resolveWithoutAssignee = await resolveTicket(adminToken, ticketId, "Solução de teste");
  if (resolveWithoutAssignee.status !== 400) {
    fail(`Esperado 400 ao resolver sem responsável atribuído. Obtido: ${resolveWithoutAssignee.status}`);
  }

  const adminUser = await getUserIdByEmail(adminToken, ADMIN_EMAIL);
  await assignTicket(adminToken, ticketId, adminUser.id);

  const patchResolved = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: "RESOLVED" }),
  });
  if (patchResolved.status !== 400) {
    fail(`Esperado 400 ao resolver via PATCH sem mensagem. Obtido: ${patchResolved.status}`);
  }

  const resolveEmpty = await resolveTicket(adminToken, ticketId, "   ");
  if (resolveEmpty.status !== 400) {
    fail(`Esperado 400 ao resolver sem mensagem. Obtido: ${resolveEmpty.status}`);
  }

  const solution = `Solução aplicada em ${new Date().toISOString()}`;
  const resolved = await resolveTicket(adminToken, ticketId, solution);
  if (!resolved.ok) fail(`Falha ao resolver ticket: ${resolved.status} ${JSON.stringify(resolved.data)}`);

  const msgs = await listMessages(adminToken, ticketId);
  if (!msgs.some((m) => (m?.message || "").includes(solution))) {
    fail("Esperado encontrar a mensagem de solução no histórico.");
  }

  const userResolved = await jsonFetch(`${API_BASE}/api/tickets/resolved`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  if (userResolved.status !== 403) fail(`Esperado 403 no /tickets/resolved para USER. Obtido: ${userResolved.status}`);

  const userMine = await jsonFetch(`${API_BASE}/api/tickets?mine=true`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  if (userMine.status !== 403) fail(`Esperado 403 no /tickets?mine=true para USER. Obtido: ${userMine.status}`);

  const adminResolved = await jsonFetch(`${API_BASE}/api/tickets/resolved?mine=false`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!adminResolved.ok || !Array.isArray(adminResolved.data)) {
    fail(`Admin deveria listar /tickets/resolved. Status: ${adminResolved.status}`);
  }
  if (!adminResolved.data.some((t) => t.id === ticketId && (t.status === "RESOLVED" || t.status === "CLOSED"))) {
    fail("Esperado encontrar o ticket resolvido na lista de /tickets/resolved.");
  }

  const adminOpenList = await jsonFetch(`${API_BASE}/api/tickets`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!adminOpenList.ok || !Array.isArray(adminOpenList.data)) {
    fail(`Admin deveria listar /tickets. Status: ${adminOpenList.status}`);
  }
  if (adminOpenList.data.some((t) => t.id === ticketId)) {
    fail("Ticket RESOLVED não deveria aparecer em /tickets (deve ir para a aba Resolvidos).");
  }

  const adminResolvedOnOpenEndpoint = await jsonFetch(`${API_BASE}/api/tickets?status=RESOLVED`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (adminResolvedOnOpenEndpoint.status !== 400) {
    fail(`Esperado 400 no /tickets?status=RESOLVED. Obtido: ${adminResolvedOnOpenEndpoint.status}`);
  }

  const adminMine = await jsonFetch(`${API_BASE}/api/tickets?mine=true`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!adminMine.ok || !Array.isArray(adminMine.data)) {
    fail(`Admin deveria listar /tickets?mine=true. Status: ${adminMine.status}`);
  }
  if (adminMine.data.some((t) => t.id === ticketId)) {
    fail("Admin com mine=true não deveria listar ticket criado por outro usuário (não atribuído).");
  }

  console.log("Integração de aba 'Resolvidos' e filtro 'Meus chamados' validada com sucesso.");
})();
