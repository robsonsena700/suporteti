import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilPath = path.resolve(__dirname, "../../artifacts/api-server/src/lib/password-reset.ts");
const mod = await import(pathToFileURL(utilPath).href);

const { generateResetToken, hashResetToken, buildPasswordResetLink } = mod as {
  generateResetToken: () => string;
  hashResetToken: (t: string) => string;
  buildPasswordResetLink: (t: string) => string;
};

process.env.APP_PUBLIC_URL = "https://suporteti.exemplo.com";

const t1 = generateResetToken();
const t2 = generateResetToken();
assert.ok(t1.length >= 40);
assert.notEqual(t1, t2);

assert.equal(hashResetToken("abc"), hashResetToken("abc"));
assert.notEqual(hashResetToken("abc"), hashResetToken("abcd"));

const link = buildPasswordResetLink("token123");
assert.ok(link.startsWith("https://suporteti.exemplo.com/redefinir-senha?token="));

