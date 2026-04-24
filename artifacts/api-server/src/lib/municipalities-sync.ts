import { db, municipalitiesSyncStateTable, municipalitiesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

type Cadence = "quarterly" | "semiannual";

type IbgeMunicipality = {
  id: number;
  nome: string;
  microrregiao?: {
    mesorregiao?: {
      UF?: {
        id: number;
        sigla: string;
        regiao?: {
          id: number;
          nome: string;
        };
      };
    };
  };
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

async function ensureSyncStateRow(): Promise<void> {
  await db
    .insert(municipalitiesSyncStateTable)
    .values({ id: 1 })
    .onConflictDoNothing();
}

async function fetchMunicipalitiesFromIbge(): Promise<IbgeMunicipality[]> {
  const url = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios";
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`IBGE HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error("Resposta do IBGE inválida");
  return data as IbgeMunicipality[];
}

async function syncNow(cadence: Cadence): Promise<void> {
  const now = new Date();
  const nextDueAt = cadence === "quarterly" ? addMonths(now, 3) : addMonths(now, 6);

  await db
    .update(municipalitiesSyncStateTable)
    .set({ lastSyncAt: now, lastError: null, updatedAt: now })
    .where(eq(municipalitiesSyncStateTable.id, 1));

  const raw = await fetchMunicipalitiesFromIbge();
  const rows = raw
    .map((m) => {
      const uf = m.microrregiao?.mesorregiao?.UF;
      const region = uf?.regiao;
      if (!m.id || typeof m.nome !== "string") return null;
      if (!uf?.sigla || !uf.id || !region?.id || !region.nome) return null;
      return {
        ibgeCode: m.id,
        name: m.nome,
        nameNormalized: normalizeText(m.nome),
        uf: uf.sigla,
        ufCode: uf.id,
        region: region.nome,
        regionCode: region.id,
        population: null as number | null,
        updatedAt: now,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  if (rows.length !== 5570) {
    throw new Error(`Esperado 5570 municípios, obtido: ${rows.length}`);
  }

  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
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

  const dueAt = state?.nextDueAt ? new Date(state.nextDueAt) : null;
  if (dueAt && dueAt.getTime() > Date.now()) return;

  const cadence = getCadence();
  try {
    await syncNow(cadence);
    logger.info({ cadence }, "Municipalities sync succeeded");
  } catch (err: any) {
    const msg = String(err?.message || err);
    try {
      await db
        .update(municipalitiesSyncStateTable)
        .set({ lastError: msg, updatedAt: new Date() })
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

