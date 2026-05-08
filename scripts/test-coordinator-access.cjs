/* eslint-disable no-console */
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3001/api";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Defina ADMIN_EMAIL e ADMIN_PASSWORD para executar o teste.");
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
  const { status, data } = await api("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  assert(status === 200, `Falha no login de ${email}: ${status}`);
  return data.token;
}

async function registerUser({ name, email, password }) {
  const { status, data } = await api("/auth/register", {
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
  assert(status === 201, `Falha ao registrar ${email}: ${status} - ${JSON.stringify(data)}`);
  return data.user;
}

async function approveUser(adminToken, userId, role, coordinatorId) {
  const body = { role };
  if (coordinatorId) body.coordinatorId = coordinatorId;
  const { status, data } = await api(`/users/${userId}/approve`, {
    method: "POST",
    token: adminToken,
    body,
  });
  assert(status === 200, `Falha ao aprovar usuário ${userId}: ${status} - ${JSON.stringify(data)}`);
}

async function createTicket(userToken, title) {
  const { status, data } = await api("/tickets", {
    method: "POST",
    token: userToken,
    body: {
      title,
      description: `Teste integração ${title}`,
      establishment: "UBS Centro",
      type: "SOFTWARE",
      priority: "MEDIUM",
    },
  });
  assert(status === 201, `Falha ao criar ticket ${title}: ${status}`);
  return data.id;
}

async function main() {
  const suffix = Date.now();
  const password = "Teste@12345";
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

  const coordA = await registerUser({ name: `CoordA ${suffix}`, email: `coorda.${suffix}@mail.com`, password });
  const coordB = await registerUser({ name: `CoordB ${suffix}`, email: `coordb.${suffix}@mail.com`, password });
  const userA = await registerUser({ name: `UserA ${suffix}`, email: `usera.${suffix}@mail.com`, password });
  const userB = await registerUser({ name: `UserB ${suffix}`, email: `userb.${suffix}@mail.com`, password });
  const gestorA = await registerUser({ name: `GestorA ${suffix}`, email: `gestora.${suffix}@mail.com`, password });
  const gestorB = await registerUser({ name: `GestorB ${suffix}`, email: `gestorb.${suffix}@mail.com`, password });

  await approveUser(adminToken, coordA.id, "COORDINATOR");
  await approveUser(adminToken, coordB.id, "COORDINATOR");
  await approveUser(adminToken, userA.id, "USER", coordA.id);
  await approveUser(adminToken, userB.id, "USER", coordB.id);
  await approveUser(adminToken, gestorA.id, "GESTOR", coordA.id);
  await approveUser(adminToken, gestorB.id, "GESTOR", coordB.id);

  const userAToken = await login(userA.email, password);
  const userBToken = await login(userB.email, password);
  const coordAToken = await login(coordA.email, password);
  const coordBToken = await login(coordB.email, password);
  const gestorAToken = await login(gestorA.email, password);
  const gestorBToken = await login(gestorB.email, password);

  const ticketA = await createTicket(userAToken, `TicketA-${suffix}`);
  const ticketB = await createTicket(userBToken, `TicketB-${suffix}`);
  const ticketGestorA = await createTicket(gestorAToken, `TicketGestorA-${suffix}`);
  const ticketGestorB = await createTicket(gestorBToken, `TicketGestorB-${suffix}`);

  const listA = await api("/tickets", { token: coordAToken });
  assert(listA.status === 200, "Coordenador A não conseguiu listar tickets");
  assert(listA.data.some(t => t.id === ticketA), "Coordenador A não visualiza ticket associado");
  assert(listA.data.some(t => t.id === ticketGestorA), "Coordenador A não visualiza ticket do Gestor associado");
  assert(!listA.data.some(t => t.id === ticketB), "Coordenador A visualizou ticket de outro coordenador");
  assert(!listA.data.some(t => t.id === ticketGestorB), "Coordenador A visualizou ticket de Gestor não associado");

  const listB = await api("/tickets", { token: coordBToken });
  assert(listB.status === 200, "Coordenador B não conseguiu listar tickets");
  assert(listB.data.some(t => t.id === ticketB), "Coordenador B não visualiza ticket associado");
  assert(listB.data.some(t => t.id === ticketGestorB), "Coordenador B não visualiza ticket do Gestor associado");
  assert(!listB.data.some(t => t.id === ticketA), "Coordenador B visualizou ticket de outro coordenador");
  assert(!listB.data.some(t => t.id === ticketGestorA), "Coordenador B visualizou ticket de Gestor não associado");

  const forbiddenRead = await api(`/tickets/${ticketB}`, { token: coordAToken });
  assert(forbiddenRead.status === 403, "Coordenador A conseguiu ler ticket do coordenador B");
  const allowedReadGestor = await api(`/tickets/${ticketGestorA}`, { token: coordAToken });
  assert(allowedReadGestor.status === 200, "Coordenador A não conseguiu ler ticket do Gestor associado");

  const forbiddenUpdate = await api(`/tickets/${ticketB}`, {
    method: "PATCH",
    token: coordAToken,
    body: { priority: "HIGH" },
  });
  assert(forbiddenUpdate.status === 403, "Coordenador A conseguiu editar ticket do coordenador B");
  const allowedUpdateGestor = await api(`/tickets/${ticketGestorA}`, {
    method: "PATCH",
    token: coordAToken,
    body: { priority: "HIGH" },
  });
  assert(allowedUpdateGestor.status === 200, "Coordenador A não conseguiu editar ticket do Gestor associado");

  const forbiddenMessage = await api(`/tickets/${ticketB}/messages`, {
    method: "POST",
    token: coordAToken,
    body: { message: "Tentativa de acesso" },
  });
  assert(forbiddenMessage.status === 403, "Coordenador A conseguiu interagir em ticket do coordenador B");

  console.log("Teste de integração concluído com sucesso.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
