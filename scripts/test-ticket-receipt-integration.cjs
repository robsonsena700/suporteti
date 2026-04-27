#!/usr/bin/env node
const API_BASE = process.env.API_BASE || "http://localhost:3001";
const USER_EMAIL = process.env.USER_EMAIL;
const USER_PASSWORD = process.env.USER_PASSWORD;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!USER_EMAIL || !USER_PASSWORD) {
  fail("Defina USER_EMAIL e USER_PASSWORD.");
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
  return { ok: resp.ok, status: resp.status, data, raw: text, headers: resp.headers };
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

(async () => {
  const token = await login(USER_EMAIL, USER_PASSWORD);
  const ticketId = await createTicket(token, `receipt-integration-${Date.now()}`);

  const resp = await fetch(`${API_BASE}/chamados/${ticketId}/comprovante?autoprint=0`, {
    headers: { Accept: "text/html" },
  });
  if (resp.status !== 200) fail(`Esperado 200 ao acessar rota do comprovante. Obtido: ${resp.status}`);
  const html = await resp.text();
  if (!html.includes("id=\"root\"")) fail("Esperado receber index.html (SPA) na rota do comprovante.");

  console.log("Integração da rota de comprovante (SPA) validada com sucesso.");
})();

