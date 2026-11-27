import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const mod = await import(pathToFileURL(path.join(root, "artifacts/api-server/src/lib/privacy-documents.ts")).href);
const {
  PRIVACY_DOCUMENTS,
  PRIVACY_REQUEST_TYPES,
  buildPrivacyProtocol,
  hashPrivacyDocument,
  pendingPrivacyDocuments,
  getPrivacyContacts,
} = mod as any;

// Documentos: política e termos, versionados, exigindo ciência, com hash estável.
const types = PRIVACY_DOCUMENTS.map((d: any) => d.type).sort();
assert.deepEqual(types, ["POLITICA_PRIVACIDADE", "TERMOS_USO"]);
for (const d of PRIVACY_DOCUMENTS) {
  assert.ok(d.version >= 1, "versão >= 1");
  assert.match(d.effectiveDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(hashPrivacyDocument(d), hashPrivacyDocument({ title: d.title, content: d.content }));
  assert.match(hashPrivacyDocument(d), /^[a-f0-9]{64}$/);
  // Só marcadores conhecidos (trocados na tela).
  const markers = [...d.content.matchAll(/\{\{(\w+)\}\}/g)].map((m: RegExpMatchArray) => m[1]);
  for (const m of markers) assert.ok(["controlador", "encarregado", "contato"].includes(m), `marcador desconhecido: ${m}`);
  // Sem promessas que o sistema não cumpre / sem segredos.
  assert.ok(!/google analytics|pixel do facebook/i.test(d.content.replace(/não usa[^.]*\./gi, "")));
  assert.ok(!/(password|senha)\s*=\s*\S+/i.test(d.content));
  assert.ok(!/DB_PASSWORD|SMTP_PASS|JWT_SECRET|BEGIN PRIVATE KEY/.test(d.content));
}
assert.notEqual(hashPrivacyDocument({ title: "A", content: "x" }), hashPrivacyDocument({ title: "A", content: "y" }));

// Pendências: usuário sem aceite precisa dos dois; com versão vigente, nenhum.
assert.equal(pendingPrivacyDocuments({}).length, 2);
const current = Object.fromEntries(PRIVACY_DOCUMENTS.map((d: any) => [d.type, d.version]));
assert.equal(pendingPrivacyDocuments(current).length, 0);
assert.equal(pendingPrivacyDocuments({ POLITICA_PRIVACIDADE: current.POLITICA_PRIVACIDADE }).length, 1);
assert.equal(pendingPrivacyDocuments({ POLITICA_PRIVACIDADE: 0, TERMOS_USO: 0 }).length, 2);

// Protocolo e tipos de pedido (art. 18).
assert.equal(buildPrivacyProtocol(7, new Date(2026, 10, 27)), "PRV-2026-000007");
assert.ok(Object.keys(PRIVACY_REQUEST_TYPES).length >= 8);

// Contatos vêm do .env, sem valor inventado.
delete process.env.PRIVACY_CONTROLLER;
assert.equal(getPrivacyContacts().controller, null);
process.env.PRIVACY_DPO_EMAIL = "  dpo@exemplo.com.br ";
assert.equal(getPrivacyContacts().dpoEmail, "dpo@exemplo.com.br");

// A política diz que fonte e QR Code são do próprio sistema: o código não pode chamar Google Fonts nem api.qrserver.
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|css|html)$/.test(e.name)) out.push(p);
  }
  return out;
}
const front = [...walk(path.join(root, "artifacts/suporte-ti/src")), path.join(root, "artifacts/suporte-ti/index.html")];
for (const f of front) {
  const txt = fs.readFileSync(f, "utf8");
  assert.ok(!txt.includes("fonts.googleapis.com"), `Google Fonts em ${f}`);
  assert.ok(!txt.includes("api.qrserver.com"), `api.qrserver em ${f}`);
  assert.ok(!/google-analytics|googletagmanager|gtag\(/.test(txt), `analytics em ${f}`);
}

// O texto do formulário de cadastro aponta para os documentos públicos.
const register = fs.readFileSync(path.join(root, "artifacts/suporte-ti/src/pages/register.tsx"), "utf8");
assert.ok(register.includes('href="/termos-de-uso"') && register.includes('href="/politica-de-privacidade"'));

console.log("Teste unitário de privacidade (LGPD) concluído com sucesso.");
