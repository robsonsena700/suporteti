import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilPath = path.resolve(__dirname, "../../artifacts/suporte-ti/src/lib/validators.ts");
const mod = await import(pathToFileURL(utilPath).href);

const { maskEmail } = mod as { maskEmail: (value: string) => string };

assert.equal(maskEmail("marcos@dominio.com"), "mar***@dominio.com");
assert.equal(maskEmail("ab@x.com"), "ab***@x.com");
assert.equal(maskEmail("a@x.com"), "a***@x.com");
assert.equal(maskEmail(""), "");
assert.equal(maskEmail("invalido"), "");

