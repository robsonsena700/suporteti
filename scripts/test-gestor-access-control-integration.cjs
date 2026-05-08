#!/usr/bin/env node
const API_BASE = process.env.API_BASE || "http://localhost:3001";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const COORDINATOR_EMAIL = process.env.COORDINATOR_EMAIL;
const COORDINATOR_PASSWORD = process.env.COORDINATOR_PASSWORD;
const GESTOR_EMAIL = process.env.GESTOR_EMAIL;
const GESTOR_PASSWORD = process.env.GESTOR_PASSWORD;
const USER_EMAIL = process.env.USER_EMAIL;
const USER_PASSWORD = process.env.USER_PASSWORD;
const EXTRA_USER_EMAIL = process.env.EXTRA_USER_EMAIL;
const EXTRA_USER_PASSWORD = process.env.EXTRA_USER_PASSWORD;
const OTHER_USER_EMAIL = process.env.OTHER_USER_EMAIL;
const OTHER_USER_PASSWORD = process.env.OTHER_USER_PASSWORD;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (
  !ADMIN_EMAIL || !ADMIN_PASSWORD
  || !COORDINATOR_EMAIL || !COORDINATOR_PASSWORD
  || !GESTOR_EMAIL || !GESTOR_PASSWORD
  || !USER_EMAIL || !USER_PASSWORD
  || !EXTRA_USER_EMAIL || !EXTRA_USER_PASSWORD
  || !OTHER_USER_EMAIL || !OTHER_USER_PASSWORD
) {
  fail("Defina ADMIN_EMAIL, ADMIN_PASSWORD, COORDINATOR_EMAIL, COORDINATOR_PASSWORD, GESTOR_EMAIL, GESTOR_PASSWORD, USER_EMAIL, USER_PASSWORD, EXTRA_USER_EMAIL, EXTRA_USER_PASSWORD, OTHER_USER_EMAIL e OTHER_USER_PASSWORD.");
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

async function getUserIdByEmail(adminToken, email) {
  const r = await jsonFetch(`${API_BASE}/api/users?status=ACTIVE`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!r.ok || !Array.isArray(r.data)) fail(`Falha ao listar usuários (admin). Status: ${r.status}`);
  const found = r.data.find((u) => String(u.email || "").toLowerCase() === String(email).toLowerCase());
  if (!found?.id) fail(`Usuário não encontrado por email: ${email}`);
  return { id: found.id, name: found.name, role: found.role };
}

async function ensureUserCoordinator(adminToken, userId, coordinatorId) {
  const r = await jsonFetch(`${API_BASE}/api/users/${userId}/coordinators`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ coordinatorId }),
  });
  if (!r.ok) fail(`Falha ao vincular coordenador ao usuário ${userId}. Status: ${r.status}`);
}

async function setRole(adminToken, userId, role, coordinatorId) {
  const body = coordinatorId != null ? { role, coordinatorId } : { role };
  const r = await jsonFetch(`${API_BASE}/api/users/${userId}/role`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) fail(`Falha ao alterar role do usuário ${userId} para ${role}. Status: ${r.status}`);
}

async function setGestorConfig(adminToken, gestorId, coordinatorId, allowedUserIds) {
  const r = await jsonFetch(`${API_BASE}/api/users/${gestorId}/gestor-config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ coordinatorId, allowedUserIds }),
  });
  if (!r.ok) fail(`Falha ao atualizar gestor-config. Status: ${r.status}`);
  return r.data;
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

async function assignTicket(token, ticketId, assignedToId, reason) {
  const r = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ assignedToId, reason }),
  });
  return r;
}

async function createMessage(token, ticketId, message) {
  const r = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
  return r;
}

async function addCollaborators(token, ticketId, userIds) {
  const r = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}/collaborators`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userIds }),
  });
  return r;
}

async function listAudit(token, ticketId) {
  return jsonFetch(`${API_BASE}/api/tickets/${ticketId}/audit`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

(async () => {
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const coordinatorToken = await login(COORDINATOR_EMAIL, COORDINATOR_PASSWORD);
  const gestorToken = await login(GESTOR_EMAIL, GESTOR_PASSWORD);
  const userToken = await login(USER_EMAIL, USER_PASSWORD);
  const extraUserToken = await login(EXTRA_USER_EMAIL, EXTRA_USER_PASSWORD);
  const otherUserToken = await login(OTHER_USER_EMAIL, OTHER_USER_PASSWORD);

  const coordinator = await getUserIdByEmail(adminToken, COORDINATOR_EMAIL);
  const gestor = await getUserIdByEmail(adminToken, GESTOR_EMAIL);
  const user = await getUserIdByEmail(adminToken, USER_EMAIL);
  const extraUser = await getUserIdByEmail(adminToken, EXTRA_USER_EMAIL);
  const otherUser = await getUserIdByEmail(adminToken, OTHER_USER_EMAIL);

  await ensureUserCoordinator(adminToken, user.id, coordinator.id);
  await ensureUserCoordinator(adminToken, extraUser.id, coordinator.id);

  await setRole(adminToken, gestor.id, "GESTOR", coordinator.id);
  await setGestorConfig(adminToken, gestor.id, coordinator.id, [extraUser.id]);

  const ticketFromGestor = await createTicket(gestorToken, `gestor-own-${Date.now()}`);
  const ticketFromManagedUser = await createTicket(userToken, `gestor-managed-${Date.now()}`);
  const ticketFromExtraUser = await createTicket(extraUserToken, `gestor-extra-${Date.now()}`);
  const ticketFromOtherUser = await createTicket(otherUserToken, `gestor-other-${Date.now()}`);

  const list = await jsonFetch(`${API_BASE}/api/tickets`, {
    headers: { Authorization: `Bearer ${gestorToken}` },
  });
  if (!list.ok || !Array.isArray(list.data)) fail(`Gestor deveria listar tickets. Status: ${list.status}`);
  const ids = new Set(list.data.map((t) => t.id));
  if (!ids.has(ticketFromGestor)) fail("Gestor deveria ver ticket criado por ele mesmo.");
  if (!ids.has(ticketFromManagedUser)) fail("Gestor deveria ver ticket do coordenador (usuário subordinado).");
  if (!ids.has(ticketFromExtraUser)) fail("Gestor deveria ver ticket do usuário explicitamente permitido.");
  if (ids.has(ticketFromOtherUser)) fail("Gestor não deveria ver ticket fora do escopo.");

  const getAllowed = await jsonFetch(`${API_BASE}/api/tickets/${ticketFromManagedUser}`, {
    headers: { Authorization: `Bearer ${gestorToken}` },
  });
  if (!getAllowed.ok) fail(`Gestor deveria acessar ticket permitido. Status: ${getAllowed.status}`);

  const getDenied = await jsonFetch(`${API_BASE}/api/tickets/${ticketFromOtherUser}`, {
    headers: { Authorization: `Bearer ${gestorToken}` },
  });
  if (getDenied.status !== 403) fail(`Esperado 403 ao acessar ticket fora do escopo. Obtido: ${getDenied.status}`);

  const patchAllowed = await jsonFetch(`${API_BASE}/api/tickets/${ticketFromManagedUser}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${gestorToken}` },
    body: JSON.stringify({ priority: "HIGH" }),
  });
  if (!patchAllowed.ok) fail(`Gestor deveria atualizar ticket permitido. Obtido: ${patchAllowed.status}`);

  const patchDeniedOutsideScope = await jsonFetch(`${API_BASE}/api/tickets/${ticketFromOtherUser}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${gestorToken}` },
    body: JSON.stringify({ priority: "LOW" }),
  });
  if (patchDeniedOutsideScope.status !== 403) fail(`Esperado 403 ao atualizar ticket fora do escopo. Obtido: ${patchDeniedOutsideScope.status}`);

  const assignDenied = await assignTicket(gestorToken, ticketFromManagedUser, gestor.id, "auto-assign (teste gestor)");
  if (assignDenied.status !== 400) fail(`Esperado 400 ao tentar atribuir para Gestor. Obtido: ${assignDenied.status}`);

  const assign = await assignTicket(gestorToken, ticketFromManagedUser, coordinator.id, "assign coord (teste gestor)");
  if (!assign.ok) fail(`Gestor deveria conseguir atribuir ticket permitido para Coordenador. Status: ${assign.status}`);

  const collab = await addCollaborators(gestorToken, ticketFromManagedUser, [gestor.id]);
  if (!collab.ok) fail(`Gestor deveria conseguir adicionar-se como colaborador no ticket do escopo. Status: ${collab.status}`);

  const msgAllowed = await createMessage(gestorToken, ticketFromManagedUser, "mensagem gestor (teste)");
  if (!msgAllowed.ok) fail(`Gestor deveria conseguir enviar mensagem como colaborador. Status: ${msgAllowed.status}`);

  const audit = await listAudit(gestorToken, ticketFromManagedUser);
  if (!audit.ok || !Array.isArray(audit.data)) fail(`Gestor deveria acessar auditoria do ticket permitido. Status: ${audit.status}`);
  const hasGestorActor = audit.data.some((l) => l?.actor?.id === gestor.id);
  if (!hasGestorActor) fail("Auditoria deveria registrar ações do Gestor como actor no ticket.");

  const coordinatorList = await jsonFetch(`${API_BASE}/api/tickets`, {
    headers: { Authorization: `Bearer ${coordinatorToken}` },
  });
  if (!coordinatorList.ok) fail(`Coordenador deveria listar tickets. Status: ${coordinatorList.status}`);

  console.log("Integração de escopo e permissões do Gestor (equivalente ao Coordenador) validada com sucesso.");
})();

