import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilPath = path.resolve(__dirname, "../../artifacts/api-server/src/lib/ticket-message-content.ts");
const mod = await import(pathToFileURL(utilPath).href);

const { sanitizeTicketMessageHtml, validateTicketMessageAttachmentFile, normalizeFilename } = mod as {
  sanitizeTicketMessageHtml: (input: string) => string;
  validateTicketMessageAttachmentFile: (file: { originalname: string; mimetype: string; size: number }) => { ok: true } | { ok: false; error: string };
  normalizeFilename: (filename: string) => string;
};

{
  const out = sanitizeTicketMessageHtml('<p>Oi<script>alert(1)</script></p>');
  assert.equal(out.includes("<script"), false);
  assert.equal(out.includes("alert(1)"), false);
}

{
  const out = sanitizeTicketMessageHtml('<p><strong>Negrito</strong> <em>Itálico</em> <u>Sublinhado</u> <s>Riscado</s></p>');
  assert.equal(out.includes("<strong>Negrito</strong>"), true);
  assert.equal(out.includes("<em>Itálico</em>"), true);
}

{
  const out = sanitizeTicketMessageHtml("Veja https://example.com/teste");
  assert.equal(out.includes('href="https://example.com/teste"'), true);
}

{
  const ok = validateTicketMessageAttachmentFile({ originalname: "img.png", mimetype: "image/png", size: 1024 });
  assert.equal(ok.ok, true);
}

{
  const bad = validateTicketMessageAttachmentFile({ originalname: "virus.exe", mimetype: "application/octet-stream", size: 10 });
  assert.equal(bad.ok, false);
}

{
  const bad = validateTicketMessageAttachmentFile({ originalname: "img.png", mimetype: "image/jpeg", size: 10 });
  assert.equal(bad.ok, false);
}

{
  const bad = validateTicketMessageAttachmentFile({ originalname: "big.pdf", mimetype: "application/pdf", size: 3 * 1024 * 1024 + 1 });
  assert.equal(bad.ok, false);
}

{
  const out = normalizeFilename('a b/ç?.pdf');
  assert.equal(out.includes(" "), false);
  assert.equal(out.includes("/"), false);
  assert.equal(out.endsWith(".pdf"), true);
}

console.log("Teste unitário de conteúdo/anexos de mensagem do chamado concluído com sucesso.");

