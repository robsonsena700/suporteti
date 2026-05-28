import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilPath = path.resolve(__dirname, "../../artifacts/api-server/src/middlewares/auth.ts");
const mod = await import(pathToFileURL(utilPath).href);

const { requireRoles } = mod as { requireRoles: (...roles: string[]) => any };

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: any) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

{
  const mw = requireRoles("ADMIN");
  const req: any = { user: { role: "USER" } };
  const res = mockRes();
  let called = false;
  mw(req, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
}

{
  const mw = requireRoles("ADMIN");
  const req: any = { user: { role: "ADMIN" } };
  const res = mockRes();
  let called = false;
  mw(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.statusCode, 200);
}

