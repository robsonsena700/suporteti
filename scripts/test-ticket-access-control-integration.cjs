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

if (!USER_EMAIL || !USER_PASSWORD || !OTHER_EMAIL || !OTHER_PASSWORD || !ADMIN_EMAIL || !ADMIN_PASSWORD || !TICKET_ID) {
  fail("Defina USER_EMAIL, USER_PASSWORD, OTHER_EMAIL, OTHER_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD e TICKET_ID.");
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

(async () => {
  const userToken = await login(USER_EMAIL, USER_PASSWORD);
  const otherToken = await login(OTHER_EMAIL, OTHER_PASSWORD);
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

  const otherGet = await jsonFetch(`${API_BASE}/api/tickets/${TICKET_ID}`, {
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  if (otherGet.status !== 403) fail(`Esperado 403 para usuário não autorizado no GET ticket. Obtido: ${otherGet.status}`);

  const otherMsg = await jsonFetch(`${API_BASE}/api/tickets/${TICKET_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${otherToken}` },
    body: JSON.stringify({ message: "tentativa" }),
  });
  if (otherMsg.status !== 403) fail(`Esperado 403 para usuário não autorizado no POST message. Obtido: ${otherMsg.status}`);

  const adminView = await jsonFetch(`${API_BASE}/api/tickets/${TICKET_ID}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!adminView.ok) fail(`Admin deveria visualizar ticket. Status: ${adminView.status}`);

  const adminMsg = await jsonFetch(`${API_BASE}/api/tickets/${TICKET_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ message: "tentativa admin sem atribuição" }),
  });
  if (adminMsg.status !== 403) fail(`Esperado 403 para admin sem atribuição no POST message. Obtido: ${adminMsg.status}`);

  const ownerMsg = await jsonFetch(`${API_BASE}/api/tickets/${TICKET_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ message: "mensagem do criador" }),
  });
  if (!ownerMsg.ok) fail(`Criador deveria conseguir postar mensagem. Status: ${ownerMsg.status}`);

  console.log("Integração de controle de acesso a tickets validada com sucesso.");
})();

