import path from "node:path";
import sanitizeHtml from "sanitize-html";
import { sniffMimeType } from "./file-sniff";

const MAX_ATTACHMENT_SIZE = 3 * 1024 * 1024;

function extensionOf(filename: string): string {
  return path.extname(filename || "").toLowerCase();
}

export function normalizeFilename(filename: string): string {
  return filename.replaceAll(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160);
}

export function inferAttachmentMimeType(filename: string): string | null {
  const ext = extensionOf(filename);
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".pdf") return "application/pdf";
  return null;
}

export function validateTicketMessageAttachmentFile(file: { originalname: string; mimetype: string; size: number }): { ok: true } | { ok: false; error: string } {
  const allowedMime = new Set(["image/png", "image/jpeg", "application/pdf"]);
  const allowedExt = new Set([".png", ".jpg", ".jpeg", ".pdf"]);
  const ext = extensionOf(file.originalname);
  if (!allowedExt.has(ext)) return { ok: false, error: "Extensão de arquivo não permitida. Use .png, .jpg ou .pdf." };
  const inferred = inferAttachmentMimeType(file.originalname);
  const normalizedMime = String(file.mimetype || "").toLowerCase();
  const isGenericMime = normalizedMime === "" || normalizedMime === "application/octet-stream" || normalizedMime === "binary/octet-stream";
  const mimeOk = allowedMime.has(normalizedMime) || (isGenericMime && inferred != null);
  if (!mimeOk) return { ok: false, error: "Tipo de arquivo não permitido. Use PNG, JPG ou PDF." };
  if (!isGenericMime && inferred != null && normalizedMime !== inferred) {
    return { ok: false, error: "Tipo MIME não corresponde à extensão do arquivo." };
  }
  if (file.size > MAX_ATTACHMENT_SIZE) return { ok: false, error: "Arquivo excede 3MB." };
  return { ok: true };
}

// Escapa o texto da URL antes de monta-lo num atributo/texto HTML. Isso e
// defesa em profundidade: o regex abaixo ja para de capturar em ", ', < e >
// (nao so em espaco, como antes), mas montar HTML por concatenacao de string
// e inserir o resultado ainda sem escapar foi exatamente a causa raiz do
// achado #4 da varredura de 20/10/2026 (risco de injecao de atributo / mXSS
// dependendo de como o parser do sanitizador interpreta o resultado) - nao
// deve depender so da lista de tags/atributos permitidos do sanitizeHtml
// (achado #1 da mesma varredura) pra ficar seguro.
function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

// Mapa fechado extensao -> mimeType "canonico" esperado por assinatura
// binaria, so para os 3 tipos que esta rota aceita (ver allowedExt/allowedMime
// em validateTicketMessageAttachmentFile acima). Reusa o sniffMimeType de
// file-sniff.ts (mesma deteccao ja usada e testada em ticket-attachments.ts),
// mas com uma lista propria em vez do isAllowedAttachment generico daquele
// arquivo - que aceita docx/xlsx/audio/etc, tipos que esta rota especifica
// (anexo em MENSAGEM de chamado) nunca permitiu e nao deveria passar a
// permitir so por ganhar a verificacao de conteudo.
const CANONICAL_MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
};

// Achado #3 da varredura de 20/10/2026 (docs/auditoria-seguranca-2026-10-20.md):
// validateTicketMessageAttachmentFile (acima) so confere extensao e o
// Content-Type DECLARADO pelo cliente - ambos falsificaveis sem esforco
// (curl/Postman). Essa funcao confere a assinatura binaria real do arquivo,
// do mesmo jeito que ticket-attachments.ts e chat-attachments.ts ja faziam -
// o valor retornado aqui (canonicalMimeType) deve ser o que vai pro banco
// como mimeType, nunca o declarado pelo cliente, porque a rota de download
// usa esse campo armazenado como o Content-Type servido de volta.
export function verifyTicketMessageAttachmentContent(
  file: { originalname: string },
  buffer: Buffer,
): { ok: true; canonicalMimeType: string } | { ok: false; error: string } {
  const ext = extensionOf(file.originalname);
  const expectedMime = CANONICAL_MIME_BY_EXTENSION[ext];
  if (!expectedMime) return { ok: false, error: "Extensão de arquivo não permitida" };

  const sniffed = sniffMimeType(buffer);
  if (!sniffed) return { ok: false, error: "Arquivo inválido ou corrompido" };
  if (sniffed !== expectedMime) return { ok: false, error: "Assinatura do arquivo não corresponde ao tipo" };

  return { ok: true, canonicalMimeType: expectedMime };
}

export function sanitizeTicketMessageHtml(input: string): string {
  const withLinks = input.replaceAll(
    /(^|[\s(>])((https?:\/\/)[^\s<>"']+)/g,
    (_m, prefix, url) => {
      const safeUrl = escapeHtmlText(url);
      return `${prefix}<a href="${safeUrl}" rel="noopener noreferrer" target="_blank">${safeUrl}</a>`;
    },
  );
  return sanitizeHtml(withLinks, {
    allowedTags: [
      "p", "br",
      "strong", "b", "em", "i", "u", "s", "del",
      "ul", "ol", "li",
      "a",
      "blockquote",
      "pre", "code",
      "span",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      span: ["style"],
      p: ["style"],
      pre: ["style"],
      code: ["style"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/],
        "font-size": [/^\d+(px|em|rem|%)$/],
        "text-align": [/^(left|right|center|justify)$/],
      },
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }, true),
    },
  });
}

