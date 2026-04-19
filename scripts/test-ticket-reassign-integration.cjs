#!/usr/bin/env node
const API_BASE = process.env.API_BASE || "http://localhost:3001";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const TICKET_ID = Number(process.env.TICKET_ID || 0);
const TARGET_USER_ID = Number(process.env.TARGET_USER_ID || 0);
const REASON = process.env.REASON || "Reatribuição para balanceamento de carga";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !TICKET_ID || !TARGET_USER_ID) {
  fail("Defina ADMIN_EMAIL, ADMIN_PASSWORD, TICKET_ID e TARGET_USER_ID para rodar este teste.");
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

(async () => {
  const login = await jsonFetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!login.ok || !login.data?.token) fail(`Falha no login: ${login.status}`);
  const token = login.data.token;

  const assign = await jsonFetch(`${API_BASE}/api/tickets/${TICKET_ID}/assign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ assignedToId: TARGET_USER_ID, reason: REASON }),
  });
  if (!assign.ok) fail(`Falha na reatribuição: ${assign.status} ${JSON.stringify(assign.data)}`);

  const audit = await jsonFetch(`${API_BASE}/api/tickets/${TICKET_ID}/audit`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!audit.ok || !Array.isArray(audit.data)) fail(`Falha ao carregar auditoria: ${audit.status}`);

  const hasManualAssign = audit.data.some((l) => l?.type === "MANUAL_ASSIGN" && (l?.detail || "").includes(REASON));
  if (!hasManualAssign) fail("Auditoria não registrou MANUAL_ASSIGN com motivo.");

  console.log("Integração de reatribuição validada com sucesso.");
})();

