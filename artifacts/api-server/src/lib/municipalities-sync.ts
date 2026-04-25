import { db, municipalitiesSyncStateTable, municipalitiesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import http from "node:http";
import https from "node:https";
import { logger } from "./logger";

type Cadence = "quarterly" | "semiannual";

type IbgeState = {
  id: number;
  sigla: string;
  regiao?: {
    id: number;
    nome: string;
  };
};

type IbgeMunicipality = {
  id: number;
  nome: string;
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function getCadence(): Cadence {
  const raw = String(process.env.MUNICIPALITIES_SYNC_CADENCE ?? "semiannual").trim().toLowerCase();
  return raw === "quarterly" ? "quarterly" : "semiannual";
}

function isEnabled(): boolean {
  const raw = String(process.env.MUNICIPALITIES_SYNC_ENABLED ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

function getIbgeTimeoutMs(): number {
  const raw = String(process.env.MUNICIPALITIES_SYNC_TIMEOUT_MS ?? process.env.IBGE_FETCH_TIMEOUT_MS ?? "60000").trim();
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

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
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
            reject(new Error(`IBGE HTTP ${status} (${parsed.protocol}//${parsed.host}${parsed.pathname})`));
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
}

async function fetchJsonWithRetry<T>(url: string): Promise<T> {
  const timeoutMs = getIbgeTimeoutMs();
  const attempts = 4;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetchJson<T>(url, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !isRetryableFetchError(err)) break;
      const backoffMs = Math.round(700 * Math.pow(1.8, attempt - 1) + Math.random() * 350);
      await sleep(backoffMs);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "Falha ao buscar dados no IBGE"));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (true) {
        const current = index++;
        if (current >= items.length) break;
        results[current] = await fn(items[current], current);
      }
    }),
  );

  return results;
}

function isUndefinedTableError(err: unknown): boolean {
  const anyErr = err as any;
  const code = anyErr?.code ?? anyErr?.cause?.code ?? anyErr?.error?.code;
  if (code === "42P01") return true;
  const msg = String(anyErr?.message ?? anyErr?.cause?.message ?? "");
  return msg.includes("municipalities_sync_state") && (msg.includes("does not exist") || msg.includes("não existe") || msg.includes("nao existe"));
}

async function ensureMunicipalitiesTablesExist(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS public.municipalities (
      ibge_code integer PRIMARY KEY,
      name text NOT NULL,
      name_normalized text NOT NULL,
      uf text NOT NULL,
      uf_code integer NOT NULL,
      region text NOT NULL,
      region_code integer NOT NULL,
      population integer NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS municipalities_uf_idx ON public.municipalities (uf);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS municipalities_uf_code_idx ON public.municipalities (uf_code);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS municipalities_name_normalized_idx ON public.municipalities (name_normalized);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS municipalities_uf_name_normalized_idx ON public.municipalities (uf, name_normalized);`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS public.municipalities_sync_state (
      id integer PRIMARY KEY,
      last_sync_at timestamptz NULL,
      last_success_at timestamptz NULL,
      next_due_at timestamptz NULL,
      last_error text NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    INSERT INTO public.municipalities_sync_state (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING;
  `);
}

async function ensureSyncStateRow(): Promise<void> {
  try {
    await db
      .insert(municipalitiesSyncStateTable)
      .values({ id: 1 })
      .onConflictDoNothing();
  } catch (err) {
    if (!isUndefinedTableError(err)) throw err;
    await ensureMunicipalitiesTablesExist();
    await db
      .insert(municipalitiesSyncStateTable)
      .values({ id: 1 })
      .onConflictDoNothing();
  }
}

async function getMunicipalitiesCount(): Promise<number | null> {
  try {
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(municipalitiesTable);
    return Number(row?.count ?? 0);
  } catch {
    return null;
  }
}

async function fetchMunicipalitiesFromIbge(): Promise<Array<{
  ibgeCode: number;
  name: string;
  nameNormalized: string;
  uf: string;
  ufCode: number;
  region: string;
  regionCode: number;
  population: null;
}>> {
  const statesUrl = "https://servicodados.ibge.gov.br/api/v1/localidades/estados";
  const municipalitiesByStateId = (stateId: number) =>
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${stateId}/municipios`;

  const states = await fetchJsonWithRetry<IbgeState[]>(statesUrl);
  const validStates = states
    .filter((s) => Boolean(s?.id) && Boolean(s?.sigla) && Boolean(s?.regiao?.id) && Boolean(s?.regiao?.nome))
    .map((s) => ({
      id: s.id,
      sigla: String(s.sigla).trim().toUpperCase(),
      regiao: {
        id: s.regiao!.id,
        nome: String(s.regiao!.nome),
      },
    }));

  validStates.sort((a, b) => a.sigla.localeCompare(b.sigla, "pt-BR"));

  const batches = await mapWithConcurrency(validStates, 3, async (state) => {
    const data = await fetchJsonWithRetry<IbgeMunicipality[]>(municipalitiesByStateId(state.id));
    return { state, municipalities: Array.isArray(data) ? data : [] };
  });

  const rows = batches
    .flatMap(({ state, municipalities }) =>
      municipalities
        .map((m) => {
          if (!m?.id || typeof m?.nome !== "string") return null;
          return {
            ibgeCode: m.id,
            name: m.nome,
            nameNormalized: normalizeText(m.nome),
            uf: state.sigla,
            ufCode: state.id,
            region: state.regiao.nome,
            regionCode: state.regiao.id,
            population: null,
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x)),
    )
    .sort((a, b) => a.ibgeCode - b.ibgeCode);

  const unique = new Set(rows.map((r) => r.ibgeCode));
  if (rows.length !== 5570 || unique.size !== 5570) {
    throw new Error(`Esperado 5570 municípios, obtido: ${rows.length} (únicos: ${unique.size})`);
  }

  return rows;
}

async function syncNow(cadence: Cadence): Promise<void> {
  const now = new Date();
  const nextDueAt = cadence === "quarterly" ? addMonths(now, 3) : addMonths(now, 6);

  await db
    .update(municipalitiesSyncStateTable)
    .set({ lastSyncAt: now, lastError: null, updatedAt: now })
    .where(eq(municipalitiesSyncStateTable.id, 1));

  const statesUrlHttps = "https://servicodados.ibge.gov.br/api/v1/localidades/estados";
  const statesUrlHttp = "http://servicodados.ibge.gov.br/api/v1/localidades/estados";
  let states: IbgeState[];

  try {
    states = await fetchJsonWithRetry<IbgeState[]>(statesUrlHttps);
  } catch {
    states = await fetchJsonWithRetry<IbgeState[]>(statesUrlHttp);
  }

  const validStates = states
    .filter((s) => Boolean(s?.id) && Boolean(s?.sigla) && Boolean(s?.regiao?.id) && Boolean(s?.regiao?.nome))
    .map((s) => ({
      id: s.id,
      sigla: String(s.sigla).trim().toUpperCase(),
      regiao: {
        id: s.regiao!.id,
        nome: String(s.regiao!.nome),
      },
    }))
    .sort((a, b) => a.sigla.localeCompare(b.sigla, "pt-BR"));

  const failures: Array<{ uf: string; error: string }> = [];
  let fetchedCount = 0;

  for (const state of validStates) {
    const urlHttps = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state.id}/municipios`;
    const urlHttp = `http://servicodados.ibge.gov.br/api/v1/localidades/estados/${state.id}/municipios`;

    let municipalities: IbgeMunicipality[];
    try {
      municipalities = await fetchJsonWithRetry<IbgeMunicipality[]>(urlHttps);
    } catch (err1: any) {
      try {
        municipalities = await fetchJsonWithRetry<IbgeMunicipality[]>(urlHttp);
      } catch (err2: any) {
        failures.push({ uf: state.sigla, error: String(err2?.message ?? err2 ?? err1?.message ?? err1) });
        continue;
      }
    }

    const baseRows = (Array.isArray(municipalities) ? municipalities : [])
      .map((m) => {
        if (!m?.id || typeof m?.nome !== "string") return null;
        return {
          ibgeCode: m.id,
          name: m.nome,
          nameNormalized: normalizeText(m.nome),
          uf: state.sigla,
          ufCode: state.id,
          region: state.regiao.nome,
          regionCode: state.regiao.id,
          population: null as number | null,
          updatedAt: now,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    fetchedCount += baseRows.length;

    const batchSize = 500;
    for (let i = 0; i < baseRows.length; i += batchSize) {
      const batch = baseRows.slice(i, i + batchSize);
      await db
        .insert(municipalitiesTable)
        .values(batch)
        .onConflictDoUpdate({
          target: municipalitiesTable.ibgeCode,
          set: {
            name: sql`excluded.name`,
            nameNormalized: sql`excluded.name_normalized`,
            uf: sql`excluded.uf`,
            ufCode: sql`excluded.uf_code`,
            region: sql`excluded.region`,
            regionCode: sql`excluded.region_code`,
            population: sql`excluded.population`,
            updatedAt: now,
          },
        });
    }
  }

  const countAfter = await getMunicipalitiesCount();
  if ((countAfter ?? 0) < 5570 || failures.length > 0) {
    const sample = failures.slice(0, 6).map((f) => `${f.uf}: ${f.error}`).join(" | ");
    throw new Error(
      `Carga incompleta: total_no_banco=${countAfter ?? "?"}, baixados_agora=${fetchedCount}, falhas=${failures.length}${sample ? ` (${sample})` : ""}`,
    );
  }

  await db
    .update(municipalitiesSyncStateTable)
    .set({ lastSuccessAt: now, nextDueAt, lastError: null, updatedAt: now })
    .where(eq(municipalitiesSyncStateTable.id, 1));
}

export async function maybeSyncMunicipalities(): Promise<void> {
  if (!isEnabled()) return;

  try {
    await ensureSyncStateRow();
  } catch (err) {
    logger.warn({ err }, "Municipalities sync state unavailable");
    return;
  }

  let state: { nextDueAt: Date | null } | undefined;
  try {
    [state] = await db
      .select({ nextDueAt: municipalitiesSyncStateTable.nextDueAt })
      .from(municipalitiesSyncStateTable)
      .where(eq(municipalitiesSyncStateTable.id, 1))
      .limit(1);
  } catch (err) {
    logger.warn({ err }, "Failed to read municipalities sync state");
    return;
  }

  const count = await getMunicipalitiesCount();
  const needsBootstrap = typeof count === "number" && count < 5500;

  const dueAt = state?.nextDueAt ? new Date(state.nextDueAt) : null;
  if (!needsBootstrap && dueAt && dueAt.getTime() > Date.now()) return;

  const cadence = getCadence();
  try {
    await syncNow(cadence);
    logger.info({ cadence }, "Municipalities sync succeeded");
  } catch (err: any) {
    const msg = String(err?.message || err);
    try {
      const retryMs = needsBootstrap ? 30 * 60 * 1000 : 6 * 60 * 60 * 1000;
      const retryAt = new Date(Date.now() + retryMs);
      await db
        .update(municipalitiesSyncStateTable)
        .set({ lastError: msg, nextDueAt: retryAt, updatedAt: new Date() })
        .where(eq(municipalitiesSyncStateTable.id, 1));
    } catch {
      // ignore
    }
    logger.warn({ err, cadence }, "Municipalities sync failed");
  }
}

export function startMunicipalitiesSyncScheduler(): () => void {
  void maybeSyncMunicipalities();
  const ms = 1000 * 60 * 60 * 24;
  const handle = setInterval(() => {
    void maybeSyncMunicipalities();
  }, ms);
  return () => clearInterval(handle);
}

