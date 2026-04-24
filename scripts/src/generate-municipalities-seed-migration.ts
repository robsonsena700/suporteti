import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function csvEscape(value: string): string {
  const safe = value.replaceAll("\"", "\"\"");
  return `"${safe}"`;
}

async function fetchMunicipalitiesFromIbge(): Promise<IbgeMunicipality[]> {
  const url = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios";
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`IBGE HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error("Resposta do IBGE inválida");
  return data as IbgeMunicipality[];
}

function buildMigrationSql(rows: Array<{
  ibgeCode: number;
  name: string;
  nameNormalized: string;
  uf: string;
  ufCode: number;
  region: string;
  regionCode: number;
  population: number | null;
}>): string {
  const header =
    "BEGIN;\n"
    + "CREATE TEMP TABLE municipalities_import (\n"
    + "  ibge_code integer,\n"
    + "  name text,\n"
    + "  name_normalized text,\n"
    + "  uf text,\n"
    + "  uf_code integer,\n"
    + "  region text,\n"
    + "  region_code integer,\n"
    + "  population integer\n"
    + ");\n"
    + "COPY municipalities_import (ibge_code, name, name_normalized, uf, uf_code, region, region_code, population) FROM STDIN WITH (FORMAT csv, NULL '');\n";

  const body = rows
    .map((r) => {
      const pop = r.population == null ? "" : String(r.population);
      return [
        String(r.ibgeCode),
        csvEscape(r.name),
        csvEscape(r.nameNormalized),
        csvEscape(r.uf),
        String(r.ufCode),
        csvEscape(r.region),
        String(r.regionCode),
        pop,
      ].join(",");
    })
    .join("\n");

  const footer =
    "\n\\.\n"
    + "INSERT INTO public.municipalities (\n"
    + "  ibge_code,\n"
    + "  name,\n"
    + "  name_normalized,\n"
    + "  uf,\n"
    + "  uf_code,\n"
    + "  region,\n"
    + "  region_code,\n"
    + "  population,\n"
    + "  created_at,\n"
    + "  updated_at\n"
    + ")\n"
    + "SELECT\n"
    + "  ibge_code,\n"
    + "  name,\n"
    + "  name_normalized,\n"
    + "  uf,\n"
    + "  uf_code,\n"
    + "  region,\n"
    + "  region_code,\n"
    + "  population,\n"
    + "  now(),\n"
    + "  now()\n"
    + "FROM municipalities_import\n"
    + "ON CONFLICT (ibge_code) DO UPDATE SET\n"
    + "  name = EXCLUDED.name,\n"
    + "  name_normalized = EXCLUDED.name_normalized,\n"
    + "  uf = EXCLUDED.uf,\n"
    + "  uf_code = EXCLUDED.uf_code,\n"
    + "  region = EXCLUDED.region,\n"
    + "  region_code = EXCLUDED.region_code,\n"
    + "  population = EXCLUDED.population,\n"
    + "  updated_at = now();\n"
    + "UPDATE public.municipalities_sync_state\n"
    + "SET last_sync_at = now(), last_success_at = now(), next_due_at = now() + interval '6 months', last_error = NULL, updated_at = now()\n"
    + "WHERE id = 1;\n"
    + "COMMIT;\n";

  return header + body + footer;
}

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const migrationsDir = path.join(repoRoot, "lib", "db", "migrations");
  const outPath = path.join(migrationsDir, "0007_seed_municipalities.sql");

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
        population: null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  rows.sort((a, b) => a.ibgeCode - b.ibgeCode);

  if (rows.length !== 5570) {
    throw new Error(`Esperado 5570 municípios, obtido: ${rows.length}`);
  }

  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.writeFileSync(outPath, buildMigrationSql(rows), "utf8");
  process.stdout.write(`OK: gerado ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + "\n");
  process.exit(1);
});
