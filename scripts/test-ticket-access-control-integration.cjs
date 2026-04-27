#!/usr/bin/env node
const API_BASE = process.env.API_BASE || "http://localhost:3001";
const USER_EMAIL = process.env.USER_EMAIL;
const USER_PASSWORD = process.env.USER_PASSWORD;
const OTHER_EMAIL = process.env.OTHER_EMAIL;
const OTHER_PASSWORD = process.env.OTHER_PASSWORD;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const TICKET_ID = Number(process.env.TICKET_ID || 0);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!USER_EMAIL || !USER_PASSWORD || !OTHER_EMAIL || !OTHER_PASSWORD || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  fail("Defina USER_EMAIL, USER_PASSWORD, OTHER_EMAIL, OTHER_PASSWORD, ADMIN_EMAIL e ADMIN_PASSWORD.");
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

async function getUserIdByEmail(adminToken, email) {
  const r = await jsonFetch(`${API_BASE}/api/users?status=ACTIVE`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!r.ok || !Array.isArray(r.data)) fail(`Falha ao listar usuários (admin). Status: ${r.status}`);
  const found = r.data.find((u) => String(u.email || "").toLowerCase() === String(email).toLowerCase());
  if (!found?.id) fail(`Usuário não encontrado por email: ${email}`);
  return { id: found.id, name: found.name };
}

(async () => {
  const userToken = await login(USER_EMAIL, USER_PASSWORD);
  const otherToken = await login(OTHER_EMAIL, OTHER_PASSWORD);
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

  const ticketId = TICKET_ID || await createTicket(userToken, `access-control-${Date.now()}`);

  const otherGet = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}`, {
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  if (otherGet.status !== 403) fail(`Esperado 403 para usuário não autorizado no GET ticket. Obtido: ${otherGet.status}`);

  const otherMsg = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${otherToken}` },
    body: JSON.stringify({ message: "tentativa" }),
  });
  if (otherMsg.status !== 403) fail(`Esperado 403 para usuário não autorizado no POST message. Obtido: ${otherMsg.status}`);

  const adminView = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!adminView.ok) fail(`Admin deveria visualizar ticket. Status: ${adminView.status}`);

  const adminMsg = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ message: "tentativa admin sem atribuição" }),
  });
  if (adminMsg.status !== 403 && adminMsg.status !== 201) fail(`Status inesperado para admin no POST message. Obtido: ${adminMsg.status}`);

  const adminUser = await getUserIdByEmail(adminToken, ADMIN_EMAIL);

  const selfAssign = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ assignedToId: adminUser.id, reason: "Autoatribuição via teste" }),
  });
  if (!selfAssign.ok) fail(`Falha na autoatribuição. Status: ${selfAssign.status}`);

  const msgsAfterAssign = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}/messages`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  if (!msgsAfterAssign.ok || !Array.isArray(msgsAfterAssign.data)) {
    fail(`Falha ao listar mensagens após autoatribuição. Status: ${msgsAfterAssign.status}`);
  }
  const expected = `usuário ${adminUser.name} atribuiu-se ao seu chamado, aguarde...`;
  if (!msgsAfterAssign.data.some((m) => (m?.message || "") === expected)) {
    fail("Esperado encontrar a mensagem automática de autoatribuição no histórico do ticket.");
  }

  const awaitingMsg =
    "Estamos aguardando seu retorno para dar continuidade ao atendimento. Caso não haja resposta ou interação dentro do período previsto, o chamado poderá ser encerrado automaticamente como 'Cancelado'.";
  const setAwaiting = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: "AWAITING_CUSTOMER" }),
  });
  if (!setAwaiting.ok) fail(`Falha ao marcar como AWAITING_CUSTOMER. Status: ${setAwaiting.status}`);

  const msgsAfterAwaiting = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}/messages`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  if (!msgsAfterAwaiting.ok || !Array.isArray(msgsAfterAwaiting.data)) {
    fail(`Falha ao listar mensagens após AWAITING_CUSTOMER. Status: ${msgsAfterAwaiting.status}`);
  }
  if (!msgsAfterAwaiting.data.some((m) => (m?.message || "") === awaitingMsg)) {
    fail("Esperado encontrar a mensagem automática do status 'Aguardando Cliente' no histórico do ticket.");
  }

  const addCollaborator = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}/collaborators`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ userIds: [adminUser.id] }),
  });
  if (!(addCollaborator.ok || addCollaborator.status === 409)) {
    fail(`Falha ao adicionar colaborador. Status: ${addCollaborator.status}`);
  }

  const adminMsgAfter = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ message: "mensagem como colaborador (admin)" }),
  });
  if (!adminMsgAfter.ok) fail(`Admin colaborador deveria conseguir postar mensagem. Status: ${adminMsgAfter.status}`);

  const audit = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}/audit`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!audit.ok || !Array.isArray(audit.data)) fail(`Falha ao obter auditoria. Status: ${audit.status}`);
  const hasCollaboratorAdded = audit.data.some((l) => l?.type === "COLLABORATOR_ADDED");
  if (!hasCollaboratorAdded && addCollaborator.ok) fail("Auditoria deveria conter COLLABORATOR_ADDED após adicionar colaborador.");

  const ownerMsg = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ message: "mensagem do criador" }),
  });
  if (!ownerMsg.ok) fail(`Criador deveria conseguir postar mensagem. Status: ${ownerMsg.status}`);

  console.log("Integração de controle de acesso a tickets validada com sucesso.");
})();

