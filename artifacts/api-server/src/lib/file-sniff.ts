const MAX_SNIFF_BYTES = 64;

function bytesEqual(buf: Buffer, offset: number, bytes: number[]): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

function asciiEqual(buf: Buffer, offset: number, text: string): boolean {
  if (buf.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (buf[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

export type AllowedAttachmentKind = "IMAGE" | "AUDIO" | "FILE";

export type AllowedAttachment = {
  kind: AllowedAttachmentKind;
  mimeType: string;
  extensions: string[];
};

const allowed: AllowedAttachment[] = [
  { kind: "IMAGE", mimeType: "image/jpeg", extensions: ["jpg", "jpeg"] },
  { kind: "IMAGE", mimeType: "image/png", extensions: ["png"] },
  { kind: "IMAGE", mimeType: "image/gif", extensions: ["gif"] },
  { kind: "IMAGE", mimeType: "image/webp", extensions: ["webp"] },
  { kind: "FILE", mimeType: "application/pdf", extensions: ["pdf"] },
  { kind: "FILE", mimeType: "application/msword", extensions: ["doc"] },
  { kind: "FILE", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extensions: ["docx"] },
  { kind: "FILE", mimeType: "text/plain", extensions: ["txt"] },
  { kind: "FILE", mimeType: "application/zip", extensions: ["zip"] },
  { kind: "AUDIO", mimeType: "audio/mpeg", extensions: ["mp3"] },
  { kind: "AUDIO", mimeType: "audio/wav", extensions: ["wav"] },
  { kind: "AUDIO", mimeType: "audio/x-wav", extensions: ["wav"] },
  { kind: "AUDIO", mimeType: "audio/mp4", extensions: ["m4a"] },
  { kind: "AUDIO", mimeType: "audio/ogg", extensions: ["ogg"] },
];

export function getAllowedAttachmentConfig(): AllowedAttachment[] {
  return allowed;
}

export function normalizeExt(filename: string): string {
  const lower = filename.toLowerCase();
  const idx = lower.lastIndexOf(".");
  if (idx === -1) return "";
  return lower.slice(idx + 1);
}

export function sniffMimeType(buffer: Buffer): string | null {
  const buf = buffer.subarray(0, Math.min(buffer.length, MAX_SNIFF_BYTES));

  if (bytesEqual(buf, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytesEqual(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (asciiEqual(buf, 0, "GIF87a") || asciiEqual(buf, 0, "GIF89a")) return "image/gif";
  if (asciiEqual(buf, 0, "RIFF") && asciiEqual(buf, 8, "WEBP")) return "image/webp";

  if (asciiEqual(buf, 0, "%PDF-")) return "application/pdf";
  if (bytesEqual(buf, 0, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  if (bytesEqual(buf, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "application/msword";

  if (asciiEqual(buf, 0, "ID3")) return "audio/mpeg";
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "audio/mpeg";

  if (asciiEqual(buf, 0, "RIFF") && asciiEqual(buf, 8, "WAVE")) return "audio/wav";
  if (asciiEqual(buf, 0, "OggS")) return "audio/ogg";

  if (buf.length >= 12 && asciiEqual(buf, 4, "ftyp")) return "audio/mp4";

  const hasNull = buf.includes(0x00);
  if (!hasNull) return "text/plain";

  return null;
}

export function isAllowedAttachment(args: {
  filename: string;
  declaredMimeType: string | undefined;
  sniffedMimeType: string | null;
}): { ok: true; kind: AllowedAttachmentKind; canonicalMimeType: string } | { ok: false; error: string } {
  const ext = normalizeExt(args.filename);
  if (!ext) return { ok: false, error: "Arquivo sem extensão" };

  const allowedByExt = allowed.filter(a => a.extensions.includes(ext));
  if (allowedByExt.length === 0) return { ok: false, error: "Tipo de arquivo não permitido" };

  const sniff = args.sniffedMimeType;
  if (!sniff) return { ok: false, error: "Arquivo inválido ou corrompido" };

  const matchBySniff = allowedByExt.find(a => a.mimeType === sniff)
    ?? (sniff === "application/zip" && allowedByExt.some(a => a.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      ? allowedByExt.find(a => a.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")!
      : null);

  if (!matchBySniff) return { ok: false, error: "Assinatura do arquivo não corresponde ao tipo" };

  const declared = (args.declaredMimeType || "").toLowerCase();
  if (declared && declared !== matchBySniff.mimeType) {
    const declaredAllowed = allowedByExt.some(a => a.mimeType === declared)
      || (declared === "application/zip" && ext === "docx");
    if (!declaredAllowed) return { ok: false, error: "Tipo MIME do arquivo não permitido" };
  }

  return { ok: true, kind: matchBySniff.kind, canonicalMimeType: matchBySniff.mimeType };
}

