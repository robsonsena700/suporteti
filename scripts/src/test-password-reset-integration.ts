import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.APP_PUBLIC_URL ||= "https://suporteti.exemplo.com";
process.env.MAIL_MODE ||= "fail";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.resolve(__dirname, "../../artifacts/api-server/src/app.ts");
const resetLibPath = path.resolve(__dirname, "../../artifacts/api-server/src/lib/password-reset.ts");
const dbPath = path.resolve(__dirname, "../../lib/db/src/index.ts");
const appMod = await import(pathToFileURL(appPath).href);
const resetMod = await import(pathToFileURL(resetLibPath).href);
const dbMod = await import(pathToFileURL(dbPath).href);

const app = (appMod as any).default;
const { hashResetToken } = resetMod as { hashResetToken: (t: string) => string };
const { db, usersTable, passwordResetTokensTable } = dbMod as any;

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Falha ao obter porta do servidor");
const API_BASE = `http://127.0.0.1:${address.port}/api`;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const USER_EMAIL = process.env.USER_EMAIL;
const USER_PASSWORD = process.env.USER_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !USER_EMAIL || !USER_PASSWORD) {
  throw new Error("Defina ADMIN_EMAIL, ADMIN_PASSWORD, USER_EMAIL, USER_PASSWORD no ambiente.");
}

async function jsonFetch(url: string, init?: RequestInit) {
  const resp = await fetch(url, init);
  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: resp.ok, status: resp.status, data };
}

async function login(email: string, password: string) {
  const r = await jsonFetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(r.status, 200, `Falha no login (${email}): ${JSON.stringify(r.data)}`);
  assert.ok(r.data?.token);
  return r.data.token as string;
}

try {
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const userToken = await login(USER_EMAIL, USER_PASSWORD);

  const allUsers = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable);
  const userRow = allUsers.find((u: any) => String(u.email || "").toLowerCase() === String(USER_EMAIL).toLowerCase());
  assert.ok(userRow?.id, "Usuário de teste não encontrado no banco.");

  {
    const r = await jsonFetch(`${API_BASE}/admin/users/${userRow.id}/password-reset`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.equal(r.status, 403);
  }

  {
    const r = await jsonFetch(`${API_BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: USER_EMAIL }),
    });
    assert.equal(r.status, 503);
  }

  {
    const r = await jsonFetch(`${API_BASE}/admin/users/${userRow.id}/password-reset`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(r.status, 503);
  }

  {
    const token = `expired_${Date.now()}`;
    const tokenHash = hashResetToken(token);
    await db.insert(passwordResetTokensTable).values({
      userId: userRow.id,
      tokenHash,
      purpose: "forgot_password",
      expiresAt: new Date(Date.now() - 60_000),
    });

    const r = await jsonFetch(`${API_BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "NovaSenha#123" }),
    });
    assert.equal(r.status, 400);
    assert.equal(r.data?.code, "TOKEN_EXPIRED");
  }

  {
    const r = await jsonFetch(`${API_BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: `invalid_${Date.now()}`, newPassword: "NovaSenha#123" }),
    });
    assert.equal(r.status, 400);
    assert.equal(r.data?.code, "TOKEN_INVALID");
  }

  {
    const token = `ok_${Date.now()}`;
    const tokenHash = hashResetToken(token);
    await db.insert(passwordResetTokensTable).values({
      userId: userRow.id,
      tokenHash,
      purpose: "forgot_password",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const newPassword = "SenhaTemp#123";
    const r = await jsonFetch(`${API_BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
    assert.equal(r.status, 200);

    await login(USER_EMAIL, newPassword);

    const tokenRestore = `restore_${Date.now()}`;
    const tokenRestoreHash = hashResetToken(tokenRestore);
    await db.insert(passwordResetTokensTable).values({
      userId: userRow.id,
      tokenHash: tokenRestoreHash,
      purpose: "forgot_password",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const restore = await jsonFetch(`${API_BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenRestore, newPassword: USER_PASSWORD }),
    });
    assert.equal(restore.status, 200);
    await login(USER_EMAIL, USER_PASSWORD);
  }
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
