/* eslint-disable no-console */
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3001/api";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Defina ADMIN_EMAIL e ADMIN_PASSWORD para executar o teste.");
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

async function api(path, { method = "GET", token, json, formData } = {}) {
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: json ? JSON.stringify(json) : (formData || undefined),
  });
  const text = await response.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  return { status: response.status, data };
}

async function login(email, password) {
  const { status, data } = await api("/auth/login", { method: "POST", json: { email, password } });
  assert(status === 200, `Falha no login de ${email}: ${status}`);
  return data.token;
}

async function registerUser({ name, email, password }) {
  const { status, data } = await api("/auth/register", {
    method: "POST",
    json: {
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
      municipality: "São Paulo",
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
    json: body,
  });
  assert(status === 200, `Falha ao aprovar usuário ${userId}: ${status} - ${JSON.stringify(data)}`);
}

async function createTicket(userToken, title) {
  const { status, data } = await api("/tickets", {
    method: "POST",
    token: userToken,
    json: {
      title,
      description: `Teste integração ${title}`,
      type: "SOFTWARE",
      priority: "MEDIUM",
    },
  });
  assert(status === 201, `Falha ao criar ticket ${title}: ${status} - ${JSON.stringify(data)}`);
  return data.id;
}

async function uploadAttachment(token, ticketId) {
  const form = new FormData();
  const blob = new Blob(["hello"], { type: "text/plain" });
  form.append("files", blob, "hello.txt");
  const { status, data } = await api(`/tickets/${ticketId}/attachments`, { method: "POST", token, formData: form });
  assert(status === 201, `Falha ao enviar anexo: ${status} - ${JSON.stringify(data)}`);
  assert(Array.isArray(data) && data.length === 1 && data[0].id, "Resposta inesperada no upload de anexo");
  return data[0].id;
}

async function main() {
  const suffix = Date.now();
  const password = "Teste@12345";
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

  const analyst = await registerUser({ name: `Analyst ${suffix}`, email: `analyst.${suffix}@mail.com`, password });
  const coordinator = await registerUser({ name: `Coord ${suffix}`, email: `coord.${suffix}@mail.com`, password });
  const userNoCoord = await registerUser({ name: `UserNoCoord ${suffix}`, email: `user.nocoord.${suffix}@mail.com`, password });

  await approveUser(adminToken, analyst.id, "ANALYST");
  await approveUser(adminToken, coordinator.id, "COORDINATOR");
  await approveUser(adminToken, userNoCoord.id, "USER");

  const analystToken = await login(analyst.email, password);
  const coordinatorToken = await login(coordinator.email, password);
  const userToken = await login(userNoCoord.email, password);

  const ticketId = await createTicket(userToken, `Ticket-NoCoord-${suffix}`);

  const listByAnalyst = await api("/tickets?noCoordinator=true", { token: analystToken });
  assert(listByAnalyst.status === 200, `Analista não conseguiu listar com filtro noCoordinator: ${listByAnalyst.status}`);
  assert(listByAnalyst.data.some((t) => t.id === ticketId), "Filtro noCoordinator não retornou o ticket esperado");

  const listByUserForbidden = await api("/tickets?noCoordinator=true", { token: userToken });
  assert(listByUserForbidden.status === 403, "Usuário padrão conseguiu usar filtro noCoordinator");

  const coordReadForbidden = await api(`/tickets/${ticketId}`, { token: coordinatorToken });
  assert(coordReadForbidden.status === 403, "Coordenador conseguiu acessar ticket de usuário sem coordenador");

  const msgByAnalyst = await api(`/tickets/${ticketId}/messages`, {
    method: "POST",
    token: analystToken,
    json: { message: "Interação do analista em ticket sem coordenador" },
  });
  assert(msgByAnalyst.status === 201, `Analista não conseguiu enviar mensagem: ${msgByAnalyst.status} - ${JSON.stringify(msgByAnalyst.data)}`);

  const attachmentId = await uploadAttachment(analystToken, ticketId);

  const delAtt = await api(`/tickets/${ticketId}/attachments/${attachmentId}`, { method: "DELETE", token: analystToken });
  assert(delAtt.status === 204, `Analista não conseguiu remover anexo: ${delAtt.status} - ${JSON.stringify(delAtt.data)}`);

  const assign = await api(`/tickets/${ticketId}/assign`, {
    method: "POST",
    token: analystToken,
    json: { assignedToId: analyst.id, reason: "Assumindo atendimento (sem coordenador)" },
  });
  assert(assign.status === 200, `Analista não conseguiu atribuir: ${assign.status} - ${JSON.stringify(assign.data)}`);

  const resolve = await api(`/tickets/${ticketId}/resolve`, {
    method: "POST",
    token: analystToken,
    json: { message: "Solução aplicada pelo analista." },
  });
  assert(resolve.status === 200, `Analista não conseguiu resolver: ${resolve.status} - ${JSON.stringify(resolve.data)}`);

  const msgAfterResolve = await api(`/tickets/${ticketId}/messages`, {
    method: "POST",
    token: analystToken,
    json: { message: "Tentativa após resolver" },
  });
  assert(msgAfterResolve.status === 400, "Sistema permitiu enviar mensagem em ticket resolvido");

  const reopenFromResolved = await api(`/tickets/${ticketId}`, {
    method: "PATCH",
    token: analystToken,
    json: { status: "IN_PROGRESS" },
  });
  assert(reopenFromResolved.status === 200, `Analista não conseguiu reabrir (voltar para IN_PROGRESS): ${reopenFromResolved.status}`);

  const forbiddenRating = await api(`/tickets/${ticketId}/rating`, {
    method: "POST",
    token: analystToken,
    json: { rating: 5, comment: "ok", reason_low_rating: "" },
  });
  assert(forbiddenRating.status === 403, "Analista conseguiu avaliar chamado (deveria ser exclusivo do usuário padrão)");

  console.log("Teste de integração (tickets sem coordenador) concluído com sucesso.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
