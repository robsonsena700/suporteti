import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libPath = path.resolve(__dirname, "../../artifacts/api-server/src/lib/password-policy.ts");
const mod = await import(pathToFileURL(libPath).href);
const { validatePasswordStrength } = mod as any;

{
  const r = validatePasswordStrength("Abc#1234");
  assert.equal(r.ok, true);
}

{
  const r = validatePasswordStrength("abc1234");
  assert.equal(r.ok, false);
  assert.equal(r.code, "PASSWORD_WEAK");
}

{
  const r = validatePasswordStrength("abcdefgh");
  assert.equal(r.ok, false);
  assert.equal(r.code, "PASSWORD_WEAK");
}

{
  const r = validatePasswordStrength("Abcdefgh");
  assert.equal(r.ok, false);
  assert.equal(r.code, "PASSWORD_WEAK");
}

{
  const r = validatePasswordStrength("Abcdefg1");
  assert.equal(r.ok, false);
  assert.equal(r.code, "PASSWORD_WEAK");
}

