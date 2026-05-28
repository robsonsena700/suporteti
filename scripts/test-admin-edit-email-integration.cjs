#!/usr/bin/env node
const API_BASE = process.env.API_BASE || "http://localhost:3001";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const USER1_EMAIL = process.env.USER1_EMAIL;
const USER1_PASSWORD = process.env.USER1_PASSWORD;
const USER2_EMAIL = process.env.USER2_EMAIL;
const USER2_PASSWORD = process.env.USER2_PASSWORD;

function fail(msg, extra) {
  console.error(msg);
  if (extra) console.error(extra);
  process.exit(1);
}

async function jsonFetch(url, init) {
  const resp = await fetch(url, init);
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: resp.ok, status: resp.status, data };
}

async function login(email, password) {
  const r = await jsonFetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok || !r.data?.token) fail(`Falha no login: ${email}`, r);
  return r.data.token;
}

async function listActiveUsers(adminToken) {
  const r = await jsonFetch(`${API_BASE}/api/users?status=ACTIVE`, {
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

function buildUniqueEmailLike(originalEmail) {
  const s = String(originalEmail || "");
  const at = s.indexOf("@");
  if (at <= 0) fail(`Email inválido para teste: ${s}`);
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  return `${local}+adminedit${Date.now()}@${domain}`.toLowerCase();
}

(async () => {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !USER1_EMAIL || !USER1_PASSWORD || !USER2_EMAIL || !USER2_PASSWORD) {
    fail("Defina ADMIN_EMAIL, ADMIN_PASSWORD, USER1_EMAIL, USER1_PASSWORD, USER2_EMAIL, USER2_PASSWORD.");
  }

  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const user1Token = await login(USER1_EMAIL, USER1_PASSWORD);
  await login(USER2_EMAIL, USER2_PASSWORD);

  const users = await listActiveUsers(adminToken);
  const user1Id = pickUserId(users, USER1_EMAIL);
  const user2Id = pickUserId(users, USER2_EMAIL);
  if (user1Id === user2Id) fail("USER1 e USER2 devem ser usuários diferentes.");

  {
    const r = await jsonFetch(`${API_BASE}/api/admin/users/${user1Id}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${user1Token}` },
      body: JSON.stringify({
        newEmail: buildUniqueEmailLike(USER1_EMAIL),
        confirmNewEmail: buildUniqueEmailLike(USER1_EMAIL),
        adminPassword: ADMIN_PASSWORD,
      }),
    });
    if (r.status !== 403) fail("Esperado 403 para não-admin.", r);
  }

  {
    const r = await jsonFetch(`${API_BASE}/api/admin/users/${user1Id}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        newEmail: buildUniqueEmailLike(USER1_EMAIL),
        confirmNewEmail: buildUniqueEmailLike(USER1_EMAIL),
        adminPassword: "senha_incorreta",
      }),
    });
    if (r.status !== 403) fail("Esperado 403 para senha de admin inválida.", r);
  }

  {
    const r = await jsonFetch(`${API_BASE}/api/admin/users/${user1Id}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        newEmail: USER2_EMAIL,
        confirmNewEmail: USER2_EMAIL,
        adminPassword: ADMIN_PASSWORD,
      }),
    });
    if (r.status !== 409) fail("Esperado 409 para email duplicado.", r);
  }

  const newEmail = buildUniqueEmailLike(USER1_EMAIL);
  try {
    {
      const r = await jsonFetch(`${API_BASE}/api/admin/users/${user1Id}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          newEmail,
          confirmNewEmail: newEmail,
          adminPassword: ADMIN_PASSWORD,
        }),
      });
      if (r.status !== 200) fail("Esperado 200 no update de email.", r);
    }

    const after = await listActiveUsers(adminToken);
    const updated = after.find((u) => u.id === user1Id);
    if (!updated || String(updated.email).toLowerCase() !== newEmail) {
      fail("E-mail não foi atualizado conforme esperado.", updated);
    }
  } finally {
    const r = await jsonFetch(`${API_BASE}/api/admin/users/${user1Id}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        newEmail: USER1_EMAIL,
        confirmNewEmail: USER1_EMAIL,
        adminPassword: ADMIN_PASSWORD,
      }),
    });
    if (r.status !== 200) fail("Falha ao restaurar e-mail original do USER1.", r);
  }

  console.log("OK: admin edit email integration");
})().catch((e) => {
  fail("Erro inesperado", e);
});

