import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// requireAuth deve usar o estado ATUAL do usuario (banco), nao o do token.
process.env.SESSION_SECRET ||= "segredo-apenas-para-teste-unitario";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authPath = path.resolve(__dirname, "../../artifacts/api-server/src/middlewares/auth.ts");
const mod: any = await import(pathToFileURL(authPath).href);
const { requireAuth, signToken, revokeToken, setAuthUserLoaderForTests, invalidateAuthUserCache } = mod;

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null as any,
    status(code: number) { res.statusCode = code; return res; },
    json(payload: any) { res.body = payload; return res; },
  };
  return res;
}

async function run(token: string | null) {
  const req: any = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  const res = mockRes();
  let called = false;
  await requireAuth(req, res, () => { called = true; });
  return { req, res, called };
}

const basePayload = { userId: 42, email: "a@x.com", role: "ADMIN", status: "ACTIVE", uf: "CE", municipality: "Fortaleza" };
let dbState: any = { email: "a@x.com", role: "ADMIN", status: "ACTIVE", uf: "CE", municipality: "Fortaleza" };
let loads = 0;
setAuthUserLoaderForTests(async (id: number) => { loads++; return id === 42 ? dbState : null; });

// Sem token -> 401
{
  const r = await run(null);
  assert.equal(r.called, false);
  assert.equal(r.res.statusCode, 401);
}

// Token valido + usuario ativo -> passa com dados do banco
const token = signToken(basePayload);
{
  const r = await run(token);
  assert.equal(r.called, true);
  assert.equal(r.req.user.role, "ADMIN");
  assert.equal(r.req.user.status, "ACTIVE");
}

// Cache: segunda chamada nao consulta o banco de novo
{
  const before = loads;
  await run(token);
  assert.equal(loads, before);
}

// Usuario rebaixado e desativado: apos invalidar o cache, o token antigo reflete o estado novo
dbState = { ...dbState, role: "USER", status: "INACTIVE" };
invalidateAuthUserCache(42);
{
  const r = await run(token);
  assert.equal(r.called, true);
  assert.equal(r.req.user.role, "USER");
  assert.equal(r.req.user.status, "INACTIVE");
}

// Usuario removido -> 401
{
  const orphan = signToken({ ...basePayload, userId: 999 });
  const r = await run(orphan);
  assert.equal(r.called, false);
  assert.equal(r.res.statusCode, 401);
}

// Falha no banco -> 503 (fail closed)
setAuthUserLoaderForTests(async () => { throw new Error("db down"); });
{
  const r = await run(token);
  assert.equal(r.called, false);
  assert.equal(r.res.statusCode, 503);
}

// Token revogado -> 401
setAuthUserLoaderForTests(async () => dbState);
revokeToken(token);
{
  const r = await run(token);
  assert.equal(r.called, false);
  assert.equal(r.res.statusCode, 401);
}

setAuthUserLoaderForTests(null);
console.log("OK: test-require-auth-revalidation-unit");
