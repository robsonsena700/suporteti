import { db, municipalitiesTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import http from "node:http";
import https from "node:https";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 12;

const municipalitiesCache = new Map<string, CacheEntry<string[]>>();

export function normalizeUf(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidUf(value: string): boolean {
  return /^[A-Z]{2}$/.test(normalizeUf(value));
}

function getIbgeTimeoutMs(): number {
  const raw = String(process.env.IBGE_FETCH_TIMEOUT_MS ?? process.env.MUNICIPALITIES_SYNC_TIMEOUT_MS ?? "60000").trim();
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1000) return 60000;
  return Math.min(120000, n);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableFetchError(err: unknown): boolean {
  const anyErr = err as any;
  const name = String(anyErr?.name ?? anyErr?.cause?.name ?? "");
  const msg = String(anyErr?.message ?? anyErr?.cause?.message ?? "");
  return (
    name.includes("ConnectTimeoutError") ||
    name.includes("TimeoutError") ||
    msg.includes("Connect Timeout") ||
    msg.includes("timeout") ||
    msg.includes("fetch failed")
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const timeoutMs = getIbgeTimeoutMs();
  const attempts = 3;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const data = await new Promise<T>((resolve, reject) => {
        const parsed = new URL(url);
        const client = parsed.protocol === "http:" ? http : https;
        const req = client.request(
          parsed,
          {
            method: "GET",
            headers: { accept: "application/json" },
          },
          (res) => {
            const status = res.statusCode ?? 0;
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            res.on("end", () => {
              const body = Buffer.concat(chunks).toString("utf8");
              if (status < 200 || status >= 300) {
                reject(new Error(`IBGE request failed: ${status} (${parsed.protocol}//${parsed.host}${parsed.pathname})`));
                return;
              }
              try {
                resolve(JSON.parse(body) as T);
              } catch (err) {
                reject(err);
              }
            });
          },
        );

        req.on("error", reject);
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error(`Timeout after ${timeoutMs}ms (${parsed.protocol}//${parsed.host}${parsed.pathname})`));
        });
        req.end();
      });

      return data;
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !isRetryableFetchError(err)) break;
      const backoffMs = Math.round(500 * Math.pow(1.8, attempt - 1) + Math.random() * 250);
      await sleep(backoffMs);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "IBGE request failed"));
}

export async function getMunicipalitiesByUf(
  uf: string,
  ttlMs = DEFAULT_TTL_MS,
): Promise<string[]> {
  const normalizedUf = normalizeUf(uf);
  const now = Date.now();

  const cached = municipalitiesCache.get(normalizedUf);
  if (cached && cached.expiresAt > now) return cached.value;

  try {
    const rows = await db
      .select({ name: municipalitiesTable.name })
      .from(municipalitiesTable)
      .where(eq(municipalitiesTable.uf, normalizedUf))
      .orderBy(asc(municipalitiesTable.name));

    if (rows.length > 0) {
      const names = rows.map((r) => r.name);
      municipalitiesCache.set(normalizedUf, { value: names, expiresAt: now + ttlMs });
      return names;
    }
  } catch {
    // Ignore DB lookup errors and fallback to IBGE.
  }

  try {
    const urlHttps = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(normalizedUf)}/municipios`;
    const urlHttp = `http://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(normalizedUf)}/municipios`;
    let data: Array<{ nome: string }>;
    try {
      data = await fetchJson<Array<{ nome: string }>>(urlHttps);
    } catch {
      data = await fetchJson<Array<{ nome: string }>>(urlHttp);
    }
    const names = data
      .map((m) => m.nome)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "pt-BR"));

    municipalitiesCache.set(normalizedUf, { value: names, expiresAt: now + ttlMs });
    return names;
  } catch {
    if (cached?.value?.length) return cached.value;
    throw new Error("IBGE request failed");
  }
}

export async function validateMunicipalityForUf(
  uf: string,
  municipality: string,
): Promise<boolean> {
  const normalizedUf = normalizeUf(uf);
  const muni = municipality.trim();
  if (!isValidUf(normalizedUf) || muni.length < 2) return false;

  try {
    const [row] = await db
      .select({ ibgeCode: municipalitiesTable.ibgeCode })
      .from(municipalitiesTable)
      .where(and(
        eq(municipalitiesTable.uf, normalizedUf),
        eq(municipalitiesTable.name, muni),
      ))
      .limit(1);
    if (row) return true;
  } catch {
    // Ignore DB lookup errors and fallback to IBGE.
  }

  const municipalities = await getMunicipalitiesByUf(normalizedUf);
  return municipalities.includes(muni);
}
