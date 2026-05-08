#!/usr/bin/env node
const API_BASE = process.env.API_BASE || "http://localhost:3001";
const USER_EMAIL = process.env.USER_EMAIL;
const USER_PASSWORD = process.env.USER_PASSWORD;

function fail(msg, details) {
  console.error(msg);
  if (details != null) {
    console.error(typeof details === "string" ? details : JSON.stringify(details, null, 2));
  }
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
  return { ok: resp.ok, status: resp.status, data, headers: resp.headers };
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
  if (!r.ok || !r.data?.id) fail(`Falha ao criar ticket: ${r.status}`, r.data);
  return r.data.id;
}

function onePxPngBuffer() {
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X8pGQAAAAASUVORK5CYII=";
  return Buffer.from(b64, "base64");
}

(async () => {
  const token = await login(USER_EMAIL, USER_PASSWORD);
  const ticketId = await createTicket(token, `msg-attach-${Date.now()}`);

  {
    const form = new FormData();
    form.append("format", "HTML");
    form.append("message", '<p>Oi <strong>teste</strong><script>alert(1)</script> https://example.com</p>');
    form.append("files", new Blob([onePxPngBuffer()], { type: "image/png" }), "img.png");

    const r = await fetch(`${API_BASE}/api/tickets/${ticketId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (r.status !== 201) fail("Esperado 201 ao enviar mensagem com anexo.", { status: r.status, data });
    if (!data?.id) fail("Resposta não contém id da mensagem.", data);
  }

  const list = await jsonFetch(`${API_BASE}/api/tickets/${ticketId}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!list.ok || !Array.isArray(list.data) || list.data.length < 1) {
    fail("Falha ao listar mensagens.", list);
  }
  const msg = list.data[list.data.length - 1];
  if (msg.format !== "HTML") fail("Esperado format=HTML.", msg);
  if (String(msg.message).includes("<script")) fail("Sanitização falhou: script ainda presente.", msg.message);
  if (!Array.isArray(msg.attachments) || msg.attachments.length !== 1) fail("Esperado 1 anexo na mensagem.", msg.attachments);

  const att = msg.attachments[0];
  const dl = await fetch(`${API_BASE}/api/tickets/${ticketId}/messages/${msg.id}/attachments/${att.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (dl.status !== 200) fail("Falha ao baixar anexo.", { status: dl.status });
  const ct = dl.headers.get("content-type") || "";
  if (!ct.includes("image/png")) fail("Content-Type inesperado no download.", { contentType: ct });

  {
    const form = new FormData();
    form.append("format", "HTML");
    form.append("message", "<p>teste</p>");
    form.append("files", new Blob([onePxPngBuffer()], { type: "image/png" }), "img.txt");

    const r = await fetch(`${API_BASE}/api/tickets/${ticketId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (r.status !== 400) fail("Esperado 400 para extensão inválida.", { status: r.status, body: await r.text() });
  }

  {
    const form = new FormData();
    form.append("format", "HTML");
    form.append("message", "<p>muitos</p>");
    for (let i = 0; i < 6; i++) {
      form.append("files", new Blob([onePxPngBuffer()], { type: "image/png" }), `img-${i}.png`);
    }

    const r = await fetch(`${API_BASE}/api/tickets/${ticketId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (r.status !== 400) fail("Esperado 400 para excesso de anexos.", { status: r.status, body: await r.text() });
  }

  console.log("Integração de anexos + rich text (mensagens) validada com sucesso.");
})().catch((err) => fail("Erro inesperado no teste de integração.", String(err && err.stack ? err.stack : err)));

