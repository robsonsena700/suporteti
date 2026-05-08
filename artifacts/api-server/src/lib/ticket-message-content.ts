import path from "node:path";
import sanitizeHtml from "sanitize-html";

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

export function sanitizeTicketMessageHtml(input: string): string {
  const withLinks = input.replaceAll(
    /(^|[\s(>])((https?:\/\/)[^\s<]+)/g,
    (_m, prefix, url) => `${prefix}<a href="${url}" rel="noopener noreferrer" target="_blank">${url}</a>`,
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

