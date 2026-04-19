/* eslint-disable no-console */
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3001/api";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Defina ADMIN_EMAIL e ADMIN_PASSWORD para executar o teste de integração.");
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function randomDigits(length) {
  let out = "";
  for (let i = 0; i < length; i += 1) out += Math.floor(Math.random() * 10);
  return out;
}

function generateValidCpf() {
  const base = randomDigits(9).split("").map(Number);
  const sum1 = base.reduce((acc, digit, idx) => acc + digit * (10 - idx), 0);
  const check1 = ((sum1 * 10) % 11) % 10;
  const sum2 = [...base, check1].reduce((acc, digit, idx) => acc + digit * (11 - idx), 0);
  const check2 = ((sum2 * 10) % 11) % 10;
  return `${base.join("")}${check1}${check2}`;
}

async function api(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { status: response.status, data };
}

async function login(email, password) {
  const result = await api("/auth/login", { method: "POST", body: { email, password } });
  assert(result.status === 200, `Falha no login ${email}: ${result.status}`);
  return result.data.token;
}

async function registerUser({ name, email, password }) {
  const result = await api("/auth/register", {
    method: "POST",
    body: {
      name,
      email,
      password,
      cpf: generateValidCpf(),
      establishment: "UBS Centro",
      contactPhone: "+5511999999999",
      prefersWhatsapp: true,
      prefersTelegram: false,
      termsAccepted: true,
      uf: "SP",
      municipality: "S\u00E3o Paulo",
    },
  });
  assert(result.status === 201, `Falha ao registrar ${email}: ${result.status}`);
  return result.data.user;
}

async function approveUser(adminToken, userId, role, coordinatorId) {
  const body = { role };
  if (coordinatorId) body.coordinatorId = coordinatorId;
  const result = await api(`/users/${userId}/approve`, {
    method: "POST",
    token: adminToken,
    body,
  });
  assert(result.status === 200, `Falha ao aprovar usuário ${userId}: ${result.status}`);
}

async function main() {
  const suffix = Date.now();
  const password = "Teste@12345";

  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const analyst = await registerUser({ name: `Analyst ${suffix}`, email: `analyst.${suffix}@mail.com`, password });
  const coordA = await registerUser({ name: `CoordA ${suffix}`, email: `coorda.${suffix}@mail.com`, password });
  const coordB = await registerUser({ name: `CoordB ${suffix}`, email: `coordb.${suffix}@mail.com`, password });
  const userA = await registerUser({ name: `UserA ${suffix}`, email: `usera.${suffix}@mail.com`, password });
  const userB = await registerUser({ name: `UserB ${suffix}`, email: `userb.${suffix}@mail.com`, password });

  await approveUser(adminToken, analyst.id, "ANALYST");
  await approveUser(adminToken, coordA.id, "COORDINATOR");
  await approveUser(adminToken, coordB.id, "COORDINATOR");
  await approveUser(adminToken, userA.id, "USER", coordA.id);
  await approveUser(adminToken, userB.id, "USER", coordB.id);

  const analystToken = await login(analyst.email, password);
  const coordAToken = await login(coordA.email, password);

  const analystParticipants = await api("/chat/participants", { token: analystToken });
  assert(analystParticipants.status === 200, "Analista não conseguiu listar participantes");
  const analystIds = analystParticipants.data.map(p => p.id);
  assert(analystIds.includes(coordA.id), "Analista deveria visualizar coordenadores");
  assert(!analystIds.includes(userA.id), "Analista visualizou usuário (USER) indevidamente");

  const analystGroupMsg = await api("/chat/messages", {
    method: "POST",
    token: analystToken,
    body: { message: `analyst-group-${suffix}` },
  });
  assert(analystGroupMsg.status === 201, "Analista deveria conseguir enviar mensagem de grupo");

  const coordGroupMsg = await api("/chat/messages", {
    method: "POST",
    token: coordAToken,
    body: { message: `coord-group-${suffix}` },
  });
  assert(coordGroupMsg.status === 201, "Coordenador deveria conseguir enviar mensagem de grupo");

  const coordParticipants = await api("/chat/participants", { token: coordAToken });
  assert(coordParticipants.status === 200, "Coordenador não conseguiu listar participantes");
  const participantIds = coordParticipants.data.map(p => p.id);
  assert(participantIds.includes(analyst.id), "Coordenador não visualiza analista");
  assert(!participantIds.includes(coordB.id), "Coordenador visualizou outro coordenador indevidamente");
  assert(!participantIds.includes(userA.id), "Coordenador visualizou usuário indevidamente");
  assert(!participantIds.includes(userB.id), "Coordenador visualizou usuário indevidamente");

  const coordGroupMessages = await api("/chat/messages?limit=200", { token: coordAToken });
  assert(coordGroupMessages.status === 200, "Coordenador não conseguiu listar mensagens de grupo");
  const containsAnalystMessage = coordGroupMessages.data.some(m => m.message === `analyst-group-${suffix}`);
  const containsCoordMessage = coordGroupMessages.data.some(m => m.message === `coord-group-${suffix}`);
  assert(containsAnalystMessage, "Coordenador não visualiza mensagem de analista");
  assert(containsCoordMessage, "Coordenador não visualizou a própria mensagem");

  const deniedDmToAnalyst = await api(`/chat/dm/${analyst.id}`, {
    method: "POST",
    token: coordAToken,
    body: { message: "não deveria enviar" },
  });
  assert(deniedDmToAnalyst.status === 201, "Coordenador deveria conseguir enviar DM para analista");

  const deniedDmToUserA = await api(`/chat/dm/${userA.id}`, {
    method: "POST",
    token: coordAToken,
    body: { message: "ok associado" },
  });
  assert(deniedDmToUserA.status === 403, "Coordenador enviou DM para usuário indevidamente");

  const deniedDmToCoordB = await api(`/chat/dm/${coordB.id}`, {
    method: "POST",
    token: coordAToken,
    body: { message: "não deveria enviar" },
  });
  assert(deniedDmToCoordB.status === 403, "Coordenador enviou DM para outro coordenador indevidamente");

  const analystDmToUserA = await api(`/chat/dm/${userA.id}`, {
    method: "POST",
    token: analystToken,
    body: { message: "não deveria enviar para USER" },
  });
  assert(analystDmToUserA.status === 403, "Analista enviou DM para USER indevidamente");

  const analystDmToCoordA = await api(`/chat/dm/${coordA.id}`, {
    method: "POST",
    token: analystToken,
    body: { message: "analista acesso total" },
  });
  assert(analystDmToCoordA.status === 201, "Analista deveria ter acesso total ao DM");

  console.log("Teste de integração de permissões do chat concluído com sucesso.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
