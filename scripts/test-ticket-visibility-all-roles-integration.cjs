#!/usr/bin/env node
const API_BASE = process.env.API_BASE || "http://localhost:3001";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ANALYST_EMAIL = process.env.ANALYST_EMAIL;
const ANALYST_PASSWORD = process.env.ANALYST_PASSWORD;
const COORD1_EMAIL = process.env.COORD1_EMAIL;
const COORD1_PASSWORD = process.env.COORD1_PASSWORD;
const COORD2_EMAIL = process.env.COORD2_EMAIL;
const COORD2_PASSWORD = process.env.COORD2_PASSWORD;
const GESTOR_EMAIL = process.env.GESTOR_EMAIL;
const GESTOR_PASSWORD = process.env.GESTOR_PASSWORD;
const USER1_EMAIL = process.env.USER1_EMAIL;
const USER1_PASSWORD = process.env.USER1_PASSWORD;
const USER2_EMAIL = process.env.USER2_EMAIL;
const USER2_PASSWORD = process.env.USER2_PASSWORD;

function fail(msg, details) {
  console.error(msg);
  if (details != null) {
    console.error(typeof details === "string" ? details : JSON.stringify(details, null, 2));
  }
  process.exit(1);
}

const REQUIRED = [
  ["ADMIN_EMAIL", ADMIN_EMAIL], ["ADMIN_PASSWORD", ADMIN_PASSWORD],
  ["ANALYST_EMAIL", ANALYST_EMAIL], ["ANALYST_PASSWORD", ANALYST_PASSWORD],
  ["COORD1_EMAIL", COORD1_EMAIL], ["COORD1_PASSWORD", COORD1_PASSWORD],
  ["COORD2_EMAIL", COORD2_EMAIL], ["COORD2_PASSWORD", COORD2_PASSWORD],
  ["GESTOR_EMAIL", GESTOR_EMAIL], ["GESTOR_PASSWORD", GESTOR_PASSWORD],
  ["USER1_EMAIL", USER1_EMAIL], ["USER1_PASSWORD", USER1_PASSWORD],
  ["USER2_EMAIL", USER2_EMAIL], ["USER2_PASSWORD", USER2_PASSWORD],
];
const missing = REQUIRED.filter(([, v]) => !v).map(([k]) => k);
if (missing.length > 0) {
  fail(`Defina as variáveis: ${missing.join(", ")}`);
}

async function jsonFetch(url, options = {}) {
  const startedAt = Date.now();
  const resp = await fetch(url, options);
  const elapsedMs = Date.now() - startedAt;
  const text = await resp.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: resp.ok, status: resp.status, data, elapsedMs };
}

async function login(email, password) {
  const r = await jsonFetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok || !r.data?.token) fail(`Falha no login (${email}): ${r.status}`, r.data);
  return r.data.token;
}

async function listActiveUsers(adminToken) {
  const r = await jsonFetch(`${API_BASE}/api/users?status=ACTIVE&includeCoordinator=true`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!r.ok || !Array.isArray(r.data)) fail("Falha ao listar usuários ativos.", r);
  return r.data;
}

function pickUserId(users, email) {
  const found = users.find((u) => String(u.email || "").toLowerCase() === String(email).toLowerCase());
  if (!found?.id) fail(`Usuário não encontrado por email: ${email}`);
  return found.id;
}

async function setRole(adminToken, userId, role, coordinatorId) {
  const body = coordinatorId != null ? { role, coordinatorId } : { role };
  const r = await jsonFetch(`${API_BASE}/api/users/${userId}/role`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) fail(`Falha ao definir role=${role} para userId=${userId}.`, r);
}

async function setCoordinator(adminToken, userId, coordinatorId) {
  const r = await jsonFetch(`${API_BASE}/api/users/${userId}/coordinators`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ coordinatorId }),
  });
  if (!r.ok) fail(`Falha ao vincular userId=${userId} ao coordinatorId=${coordinatorId}.`, r);
}

async function setUserLocation(adminToken, userId, uf, municipality) {
  const r = await jsonFetch(`${API_BASE}/api/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ uf, municipality }),
  });
  if (!r.ok) fail(`Falha ao atualizar localidade do usuário ${userId} para ${municipality}-${uf}.`, r);
}

async function updateGestorConfig(adminToken, gestorId, coordinatorId, allowedUserIds) {
  const r = await jsonFetch(`${API_BASE}/api/users/${gestorId}/gestor-config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ coordinatorId, allowedUserIds }),
  });
  if (!r.ok) fail("Falha ao atualizar configuração do Gestor.", r);
}

async function createTicket(token, title) {
  const r = await jsonFetch(`${API_BASE}/api/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title,
      description: `Teste integração: ${title}`,
      type: "SOFTWARE",
      priority: "MEDIUM",
    }),
  });
  if (!r.ok || !r.data?.id) fail("Falha ao criar ticket.", r);
  return r.data.id;
}

async function listTickets(token) {
  return jsonFetch(`${API_BASE}/api/tickets`, { headers: { Authorization: `Bearer ${token}` } });
}

async function getTicket(token, ticketId) {
  return jsonFetch(`${API_BASE}/api/tickets/${ticketId}`, { headers: { Authorization: `Bearer ${token}` } });
}

async function chatParticipants(token) {
  return jsonFetch(`${API_BASE}/api/chat/participants`, { headers: { Authorization: `Bearer ${token}` } });
}

async function createMessage(token, ticketId, message) {
  return jsonFetch(`${API_BASE}/api/tickets/${ticketId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
}

async function createTicketAs(token, title) {
  return jsonFetch(`${API_BASE}/api/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title,
      description: `Teste integração: ${title}`,
      type: "SOFTWARE",
      priority: "MEDIUM",
    }),
  });
}

function assertTicketInList(resp, ticketId, label) {
  if (!resp.ok || !Array.isArray(resp.data)) fail(`Falha ao listar tickets (${label}).`, resp);
  const found = resp.data.some((t) => t && Number(t.id) === Number(ticketId));
  if (!found) fail(`Esperado ticketId=${ticketId} na listagem (${label}).`, { status: resp.status, sampleIds: resp.data.slice(0, 10).map(t => t?.id) });
}

function assertTicketNotInList(resp, ticketId, label) {
  if (!resp.ok || !Array.isArray(resp.data)) fail(`Falha ao listar tickets (${label}).`, resp);
  const found = resp.data.some((t) => t && Number(t.id) === Number(ticketId));
  if (found) fail(`Não era esperado ticketId=${ticketId} na listagem (${label}).`, { status: resp.status });
}

(async () => {
  const report = {
    baseUrl: API_BASE,
    startedAt: new Date().toISOString(),
    performance: {},
    checks: [],
  };

  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const analystToken = await login(ANALYST_EMAIL, ANALYST_PASSWORD);
  const coord1Token = await login(COORD1_EMAIL, COORD1_PASSWORD);
  const coord2Token = await login(COORD2_EMAIL, COORD2_PASSWORD);
  const gestorToken = await login(GESTOR_EMAIL, GESTOR_PASSWORD);
  const user1Token = await login(USER1_EMAIL, USER1_PASSWORD);
  const user2Token = await login(USER2_EMAIL, USER2_PASSWORD);

  const users = await listActiveUsers(adminToken);
  const adminId = pickUserId(users, ADMIN_EMAIL);
  const analystId = pickUserId(users, ANALYST_EMAIL);
  const coord1Id = pickUserId(users, COORD1_EMAIL);
  const coord2Id = pickUserId(users, COORD2_EMAIL);
  const gestorId = pickUserId(users, GESTOR_EMAIL);
  const user1Id = pickUserId(users, USER1_EMAIL);
  const user2Id = pickUserId(users, USER2_EMAIL);

  await setRole(adminToken, adminId, "ADMIN");
  await setRole(adminToken, analystId, "ANALYST");
  await setRole(adminToken, coord1Id, "COORDINATOR");
  await setRole(adminToken, coord2Id, "COORDINATOR");
  await setRole(adminToken, user1Id, "USER", coord1Id);
  await setRole(adminToken, user2Id, "USER", coord2Id);
  await setRole(adminToken, gestorId, "GESTOR", coord1Id);

  await setUserLocation(adminToken, coord1Id, "SP", "São Paulo");
  await setUserLocation(adminToken, user1Id, "SP", "São Paulo");
  await setUserLocation(adminToken, coord2Id, "RJ", "Rio de Janeiro");
  await setUserLocation(adminToken, user2Id, "RJ", "Rio de Janeiro");

  await setCoordinator(adminToken, user1Id, coord1Id);
  await setCoordinator(adminToken, user2Id, coord2Id);
  await updateGestorConfig(adminToken, gestorId, coord1Id, [user2Id]);

  const ticket1 = await createTicket(user1Token, `vis-u1-${Date.now()}`);
  const ticket2 = await createTicket(user2Token, `vis-u2-${Date.now()}`);

  const extraCount = Number(process.env.EXTRA_TICKETS || "150");
  for (let i = 0; i < extraCount; i++) {
    const ownerToken = i % 2 === 0 ? user1Token : user2Token;
    await createTicket(ownerToken, `bulk-${Date.now()}-${i}`);
  }

  {
    const r1 = await getTicket(user1Token, ticket1);
    if (!r1.ok) fail("Usuário padrão deveria acessar seu próprio ticket.", r1);
    report.checks.push({ rule: "USER own ticket", ok: true, ticketId: ticket1 });

    const r2 = await getTicket(user1Token, ticket2);
    if (r2.status !== 403) fail("Usuário padrão não deveria acessar ticket de outro usuário (esperado 403).", r2);
    report.checks.push({ rule: "USER deny other ticket", ok: true, ticketId: ticket2 });

    const list = await listTickets(user1Token);
    assertTicketInList(list, ticket1, "USER list own");
    assertTicketNotInList(list, ticket2, "USER list other");
  }

  {
    const adminList = await listTickets(adminToken);
    const analystList = await listTickets(analystToken);

    report.performance.adminListTicketsMs = adminList.elapsedMs;
    report.performance.analystListTicketsMs = analystList.elapsedMs;

    assertTicketInList(adminList, ticket1, "ADMIN list");
    assertTicketInList(adminList, ticket2, "ADMIN list");
    assertTicketInList(analystList, ticket1, "ANALYST list");
    assertTicketInList(analystList, ticket2, "ANALYST list");

    const adminGet = await getTicket(adminToken, ticket1);
    if (!adminGet.ok) fail("ADMIN deveria acessar qualquer ticket.", adminGet);
    const analystGet = await getTicket(analystToken, ticket2);
    if (!analystGet.ok) fail("ANALYST deveria acessar qualquer ticket.", analystGet);

    report.checks.push({ rule: "ADMIN/ANALYST unrestricted", ok: true });
  }

  {
    const c1List = await listTickets(coord1Token);
    assertTicketInList(c1List, ticket1, "COORD1 list SP");
    assertTicketNotInList(c1List, ticket2, "COORD1 list RJ");

    const c2List = await listTickets(coord2Token);
    assertTicketInList(c2List, ticket2, "COORD2 list RJ");
    assertTicketNotInList(c2List, ticket1, "COORD2 list SP");

    const c1Get = await getTicket(coord1Token, ticket1);
    if (!c1Get.ok) fail("COORD1 deveria acessar ticket do município/equipe.", c1Get);
    const c1GetDenied = await getTicket(coord1Token, ticket2);
    if (c1GetDenied.status !== 403) fail("COORD1 não deveria acessar ticket fora do município/equipe (esperado 403).", c1GetDenied);

    report.checks.push({ rule: "COORD municipality/team visibility", ok: true });
  }

  {
    const gList = await listTickets(gestorToken);
    assertTicketInList(gList, ticket1, "GESTOR list coordinator scope");
    assertTicketInList(gList, ticket2, "GESTOR list allowlist");

    const gDeniedChat = await chatParticipants(gestorToken);
    if (gDeniedChat.status !== 403) fail("GESTOR não deve acessar endpoints de chat (esperado 403).", gDeniedChat);
    report.checks.push({ rule: "GESTOR chat forbidden", ok: true });

    const gCreateTicket = await createTicketAs(gestorToken, `gestor-create-${Date.now()}`);
    if (gCreateTicket.status !== 403) fail("GESTOR não deve criar chamados (esperado 403).", gCreateTicket);

    const gMessage = await createMessage(gestorToken, ticket1, "mensagem gestor");
    if (gMessage.status !== 403) fail("GESTOR não deve interagir via mensagens (esperado 403).", gMessage);
    report.checks.push({ rule: "GESTOR read-only", ok: true });
  }

  {
    await setCoordinator(adminToken, user1Id, coord2Id);
    const c1ListAfter = await listTickets(coord1Token);
    assertTicketInList(c1ListAfter, ticket1, "COORD1 list after user1 reassigned (municipality)");

    const c2ListAfter = await listTickets(coord2Token);
    assertTicketInList(c2ListAfter, ticket1, "COORD2 list after user1 reassigned (team)");
    report.checks.push({ rule: "Role transition: USER coordinator reassignment", ok: true });
  }

  {
    await updateGestorConfig(adminToken, gestorId, coord1Id, []);
    const gListAfter = await listTickets(gestorToken);
    assertTicketInList(gListAfter, ticket1, "GESTOR list after allowlist removal (coordinator scope)");
    assertTicketNotInList(gListAfter, ticket2, "GESTOR list after allowlist removal (ticket2 removed)");
    report.checks.push({ rule: "GESTOR allowlist add/remove", ok: true });
  }

  console.log("RELATÓRIO DE VERIFICAÇÃO (tickets + chat)");
  console.log(JSON.stringify(report, null, 2));
  console.log("OK: regras principais validadas com sucesso.");
})().catch((err) => fail("Erro inesperado no teste de integração.", String(err && err.stack ? err.stack : err)));
