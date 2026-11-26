import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// Regressao: com @hookform/resolvers 3.x + zod 4, um campo invalido fazia o
// zodResolver LANCAR um ZodError (tela de erro no login e nos demais
// formularios) em vez de devolver a mensagem do campo.
// Resolve as libs a partir do front, que e quem as usa.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.resolve(__dirname, "../../artifacts/suporte-ti/package.json"));
const { z } = await import(pathToFileURL(req.resolve("zod")).href);
const { zodResolver } = await import(pathToFileURL(req.resolve("@hookform/resolvers/zod")).href);

const schema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(1, "Senha obrigatória"),
});
const opts = { fields: {}, shouldUseNativeValidation: false } as any;

const bad = await zodResolver(schema)({ email: "abc", password: "" }, undefined, opts);
assert.equal(bad.errors.email?.message, "E-mail inválido");
assert.equal(bad.errors.password?.message, "Senha obrigatória");
assert.deepEqual(bad.values, {});

const good = await zodResolver(schema)({ email: "a@b.com.br", password: "x" }, undefined, opts);
assert.deepEqual(good.errors, {});
assert.equal(good.values.email, "a@b.com.br");

console.log("OK: test-form-resolver-unit");
