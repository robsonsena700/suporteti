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
  { kind: "IMAGE", mimeType: "image/bmp", extensions: ["bmp"] },
  { kind: "IMAGE", mimeType: "image/heic", extensions: ["heic"] },
  { kind: "IMAGE", mimeType: "image/heif", extensions: ["heif"] },
  { kind: "FILE", mimeType: "application/pdf", extensions: ["pdf"] },
  { kind: "FILE", mimeType: "application/msword", extensions: ["doc"] },
  { kind: "FILE", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extensions: ["docx"] },
  { kind: "FILE", mimeType: "application/vnd.ms-excel", extensions: ["xls"] },
  { kind: "FILE", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extensions: ["xlsx"] },
  { kind: "FILE", mimeType: "text/plain", extensions: ["txt"] },
  { kind: "FILE", mimeType: "application/zip", extensions: ["zip"] },
  { kind: "AUDIO", mimeType: "audio/mpeg", extensions: ["mp3"] },
  { kind: "AUDIO", mimeType: "audio/wav", extensions: ["wav"] },
  { kind: "AUDIO", mimeType: "audio/x-wav", extensions: ["wav"] },
  { kind: "AUDIO", mimeType: "audio/mp4", extensions: ["m4a"] },
  { kind: "AUDIO", mimeType: "audio/ogg", extensions: ["ogg"] },
];

// Alguns formatos permitidos compartilham o mesmo "container" binario e nao dao
// pra diferenciar so pela assinatura dos primeiros bytes:
// - DOCX e XLSX sao ambos arquivos ZIP por dentro (OOXML);
// - DOC e XLS legados sao ambos "OLE Compound File" (mesma assinatura de 8 bytes);
// - HEIC e HEIF usam o mesmo container ISOBMFF/ftyp.
// Nesses casos sniffMimeType devolve uma assinatura "generica" e este mapa diz
// quais mimeTypes permitidos ela pode legitimamente corresponder - a extensao
// do arquivo decide qual dos dois é. Sem isso, so dava pra "confirmar" um dos
// dois formatos da dupla e o outro seria sempre rejeitado como "assinatura nao
// corresponde", mesmo sendo um arquivo legitimo.
const AMBIGUOUS_SNIFF_COMPATIBILITY: Record<string, string[]> = {
  "application/zip": [
    "application/zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  "application/msword": [
    "application/msword",
    "application/vnd.ms-excel",
  ],
  "image/heic": [
    "image/heic",
    "image/heif",
  ],
};

export function getAllowedAttachmentConfig(): AllowedAttachment[] {
  return allowed;
}

export function normalizeExt(filename: string): string {
  const lower = filename.toLowerCase();
  const idx = lower.lastIndexOf(".");
  if (idx === -1) return "";
  return lower.slice(idx + 1);
}

// Brands ISOBMFF (bytes 8-11 do box "ftyp") usados por arquivos HEIC/HEIF. Sem
// checar isso, qualquer arquivo com box ftyp (incluindo fotos HEIC de iPhone)
// caia no fallback de audio/mp4 - uma foto HEIC seria identificada como audio.
const HEIC_FTYP_BRANDS = ["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"];

export function sniffMimeType(buffer: Buffer): string | null {
  const buf = buffer.subarray(0, Math.min(buffer.length, MAX_SNIFF_BYTES));

  if (bytesEqual(buf, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytesEqual(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (asciiEqual(buf, 0, "GIF87a") || asciiEqual(buf, 0, "GIF89a")) return "image/gif";
  if (asciiEqual(buf, 0, "RIFF") && asciiEqual(buf, 8, "WEBP")) return "image/webp";
  if (bytesEqual(buf, 0, [0x42, 0x4d])) return "image/bmp";

  if (asciiEqual(buf, 0, "%PDF-")) return "application/pdf";
  if (bytesEqual(buf, 0, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  // OLE Compound File: assinatura unica compartilhada por DOC, XLS, PPT legados -
  // ver AMBIGUOUS_SNIFF_COMPATIBILITY acima para como DOC vs XLS e resolvido.
  if (bytesEqual(buf, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "application/msword";

  if (asciiEqual(buf, 0, "ID3")) return "audio/mpeg";
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "audio/mpeg";

  if (asciiEqual(buf, 0, "RIFF") && asciiEqual(buf, 8, "WAVE")) return "audio/wav";
  if (asciiEqual(buf, 0, "OggS")) return "audio/ogg";

  if (buf.length >= 12 && asciiEqual(buf, 4, "ftyp")) {
    const brand = buf.subarray(8, 12).toString("ascii");
    if (HEIC_FTYP_BRANDS.includes(brand)) return "image/heic";
    return "audio/mp4";
  }

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

  const compatibleMimeTypes = AMBIGUOUS_SNIFF_COMPATIBILITY[sniff] ?? [sniff];
  const matchBySniff = allowedByExt.find(a => compatibleMimeTypes.includes(a.mimeType));

  if (!matchBySniff) return { ok: false, error: "Assinatura do arquivo não corresponde ao tipo" };

  // So bloqueia aqui quando o Content-Type declarado pelo cliente é um tipo que
  // reconhecemos (esta na nossa lista de permitidos) mas nao bate com o que o
  // conteudo realmente e - sinal de algo deliberadamente malformado. Um
  // declarado desconhecido/nao padronizado e ignorado: e normal, nao suspeito.
  // Celulares Android sao o caso classico - e comum vir "image/jpg" (em vez do
  // padrao "image/jpeg") ou ate "application/octet-stream" pra fotos de camera
  // legitimas, dependendo do fabricante/app. A assinatura binaria real (sniff)
  // + a extensao ja sao a checagem que importa; o declarado e so um sinal extra.
  const declared = (args.declaredMimeType || "").toLowerCase();
  if (declared && declared !== matchBySniff.mimeType && !compatibleMimeTypes.includes(declared)) {
    const isRecognizedMimeType = allowed.some(a => a.mimeType === declared);
    if (isRecognizedMimeType) {
      return { ok: false, error: "Tipo MIME do arquivo não permitido" };
    }
  }

  return { ok: true, kind: matchBySniff.kind, canonicalMimeType: matchBySniff.mimeType };
}
