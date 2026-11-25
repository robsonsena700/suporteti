#!/usr/bin/env node
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

async function approve(adminToken, userId, role, coordinatorId) {
  const payload = coordinatorId != null ? { role, coordinatorId } : { role };
  const { status, data } = await api(`/users/${userId}/approve`, {
    method: "POST",
    token: adminToken,
    json: payload,
  });
  assert(status === 200, `Falha ao aprovar usuário ${userId} como ${role}`, { status, data });
  return data;
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

  const analyst = await registerUser({
    name: `Analista Aprov ${suffix}`,
    email: `analyst.approval.${suffix}@mail.com`,
    password,
    uf: "CE",
    municipality: "Fortaleza",
  });
  await approve(adminToken, analyst.id, "ANALYST");
  const analystToken = await login(analyst.email, password);

  const pendingDefault = await registerUser({
    name: `Pendente User ${suffix}`,
    email: `pending.user.${suffix}@mail.com`,
    password,
    uf: "CE",
    municipality: "Fortaleza",
  });
  const pendingCoordinator = await registerUser({
    name: `Pendente Coord ${suffix}`,
    email: `pending.coord.${suffix}@mail.com`,
    password,
    uf: "CE",
    municipality: "Fortaleza",
  });

  const queue = await listPendingApprovals(analystToken);
  assert(queue.status === 200, "Analista não conseguiu visualizar a fila de aprovações pendentes", queue);
  assert(
    Array.isArray(queue.data) && queue.data.some((user) => user.id === pendingDefault.id),
    "Fila do analista não contém o primeiro cadastro pendente",
    queue.data,
  );
  assert(
    Array.isArray(queue.data) && queue.data.some((user) => user.id === pendingCoordinator.id),
    "Fila do analista não contém o segundo cadastro pendente",
    queue.data,
  );

  const approveDefault = await api(`/users/${pendingDefault.id}/approve`, {
    method: "POST",
    token: analystToken,
    json: { role: "USER" },
  });
  assert(
    approveDefault.status === 200 && approveDefault.data?.status === "ACTIVE" && approveDefault.data?.role === "USER",
    "Analista não conseguiu aprovar cadastro como Usuário Padrão",
    approveDefault,
  );

  const approveCoordinator = await api(`/users/${pendingCoordinator.id}/approve`, {
    method: "POST",
    token: analystToken,
    json: { role: "COORDINATOR" },
  });
  assert(
    approveCoordinator.status === 200 && approveCoordinator.data?.status === "ACTIVE" && approveCoordinator.data?.role === "COORDINATOR",
    "Analista não conseguiu aprovar cadastro alterando o perfil",
    approveCoordinator,
  );

  const userAfter = await getUser(adminToken, pendingDefault.id);
  assert(userAfter.status === 200 && userAfter.data?.status === "ACTIVE", "Cadastro aprovado como usuário não ficou ativo", userAfter);

  const coordAfter = await getUser(adminToken, pendingCoordinator.id);
  assert(
    coordAfter.status === 200 && coordAfter.data?.status === "ACTIVE" && coordAfter.data?.role === "COORDINATOR",
    "Cadastro aprovado como coordenador não refletiu a alteração de perfil",
    coordAfter,
  );

  console.log("Teste de integração de aprovações pendentes por analista concluído com sucesso.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
