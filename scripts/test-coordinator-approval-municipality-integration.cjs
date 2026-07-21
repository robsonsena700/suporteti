/* eslint-disable no-console */
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3001/api";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Defina ADMIN_EMAIL e ADMIN_PASSWORD para executar o teste.");
  process.exit(1);
}

function assert(condition, message, details) {
  if (!condition) {
    if (details !== undefined) {
      throw new Error(`${message} :: ${JSON.stringify(details)}`);
    }
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

async function api(path, { method = "GET", token, json } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(json ? { "Content-Type": "application/json" } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
  });

  const text = await response.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  return { status: response.status, data };
}

async function login(email, password) {
  const { status, data } = await api("/auth/login", {
    method: "POST",
    json: { email, password },
  });
  assert(status === 200, `Falha no login de ${email}`, { status, data });
  return data.token;
}

async function registerUser({ name, email, password, uf, municipality }) {
  const { status, data } = await api("/auth/register", {
    method: "POST",
    json: {
      name,
      email,
      password,
      birthDate: "1990-01-15",
      cpf: generateValidCpf(),
      establishment: "UBS Centro",
      contactPhone: "+5511999999999",
      prefersWhatsapp: true,
      prefersTelegram: false,
      termsAccepted: true,
      uf,
      municipality,
    },
  });
  assert(status === 201, `Falha ao registrar ${email}`, { status, data });
  return data.user;
}

async function approveAsAdmin(adminToken, userId, role) {
  const { status, data } = await api(`/users/${userId}/approve`, {
    method: "POST",
    token: adminToken,
    json: { role },
  });
  assert(status === 200, `Falha ao aprovar usuário ${userId} como ${role}`, { status, data });
  return data;
}

async function approveAsCoordinator(coordinatorToken, userId) {
  return api(`/users/${userId}/approve`, {
    method: "POST",
    token: coordinatorToken,
    json: { role: "USER" },
  });
}

async function listPendingApprovals(token) {
  return api("/users?status=PENDING", { token });
}

async function getUser(token, userId) {
  return api(`/users/${userId}`, { token });
}

async function main() {
  const suffix = Date.now();
  const password = "Teste@12345";
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

  const coordinator = await registerUser({
    name: `Coord Municipio ${suffix}`,
    email: `coord.municipio.${suffix}@mail.com`,
    password,
    uf: "SP",
    municipality: "São Paulo",
  });

  await approveAsAdmin(adminToken, coordinator.id, "COORDINATOR");

  const coordinatorToken = await login(coordinator.email, password);

  const candidateSameMunicipality = await registerUser({
    name: `Candidato SP ${suffix}`,
    email: `cand.sp.${suffix}@mail.com`,
    password,
    uf: "SP",
    municipality: "São Paulo",
  });

  const candidateOtherMunicipality = await registerUser({
    name: `Candidato Campinas ${suffix}`,
    email: `cand.cps.${suffix}@mail.com`,
    password,
    uf: "SP",
    municipality: "Campinas",
  });

  const pendingForCoordinator = await listPendingApprovals(coordinatorToken);
  assert(pendingForCoordinator.status === 200, "Coordenador não conseguiu listar aprovações pendentes", pendingForCoordinator);
  assert(
    Array.isArray(pendingForCoordinator.data) && pendingForCoordinator.data.some((u) => u.id === candidateSameMunicipality.id),
    "Fila do coordenador não contém candidato do mesmo município",
    pendingForCoordinator.data,
  );
  assert(
    Array.isArray(pendingForCoordinator.data) && !pendingForCoordinator.data.some((u) => u.id === candidateOtherMunicipality.id),
    "Fila do coordenador exibiu candidato de outro município",
    pendingForCoordinator.data,
  );

  const approvedSameMunicipality = await approveAsCoordinator(coordinatorToken, candidateSameMunicipality.id);
  assert(
    approvedSameMunicipality.status === 200 && approvedSameMunicipality.data?.status === "ACTIVE",
    "Coordenador não aprovou candidato do mesmo município",
    approvedSameMunicipality,
  );

  const sameMunicipalityLoginToken = await login(candidateSameMunicipality.email, password);
  assert(Boolean(sameMunicipalityLoginToken), "Usuário aprovado pelo coordenador não conseguiu autenticar");

  const otherMunicipalityAttempt = await approveAsCoordinator(coordinatorToken, candidateOtherMunicipality.id);
  assert(
    otherMunicipalityAttempt.status === 403,
    "Coordenador conseguiu aprovar candidato de outro município",
    otherMunicipalityAttempt,
  );
  assert(
    typeof otherMunicipalityAttempt.data?.error === "string"
      && otherMunicipalityAttempt.data.error.includes("próprio município"),
    "Mensagem de erro inesperada ao bloquear município divergente",
    otherMunicipalityAttempt,
  );

  const otherMunicipalityUser = await getUser(adminToken, candidateOtherMunicipality.id);
  assert(
    otherMunicipalityUser.status === 200 && otherMunicipalityUser.data?.status === "PENDING",
    "Usuário de outro município não permaneceu pendente após bloqueio",
    otherMunicipalityUser,
  );

  console.log("Teste de integração de aprovação municipal por coordenador concluído com sucesso.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
