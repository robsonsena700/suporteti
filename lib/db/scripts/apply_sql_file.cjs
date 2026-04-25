const fs = require("node:fs");
const path = require("node:path");
const pg = require("pg");

function readDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, "utf8");
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2] ?? "";
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === "\"") {
        const next = line[i + 1];
        if (next === "\"") {
          current += "\"";
          i++;
          continue;
        }
        inQuotes = false;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === "\"") {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      fields.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  fields.push(current);
  return fields;
}

function extractCopyBlock(sql) {
  const lines = sql.split(/\r?\n/);
  const copyIdx = lines.findIndex((l) => l.startsWith("COPY municipalities_import "));
  if (copyIdx === -1) return null;
  const endIdx = lines.findIndex((l, idx) => idx > copyIdx && l.trim() === "\\.");
  if (endIdx === -1) return null;

  const dataLines = lines.slice(copyIdx + 1, endIdx).filter((l) => l.trim().length > 0);
  return { lines, copyIdx, endIdx, dataLines };
}

async function applyMunicipalitiesSeedMigration(client, sql) {
  const block = extractCopyBlock(sql);
  if (!block) {
    throw new Error("Migração não contém bloco COPY municipalities_import");
  }

  const dataLines = block.dataLines;
  if (dataLines.length !== 5570) {
    throw new Error(`Esperado 5570 municípios no seed, obtido: ${dataLines.length}`);
  }

  await client.query("BEGIN");
  try {
    const columns = [
      "ibge_code",
      "name",
      "name_normalized",
      "uf",
      "uf_code",
      "region",
      "region_code",
      "population",
    ];

    const batchSize = 500;
    for (let i = 0; i < dataLines.length; i += batchSize) {
      const batch = dataLines.slice(i, i + batchSize);
      const values = [];
      const placeholders = [];

      for (let r = 0; r < batch.length; r++) {
        const fields = parseCsvLine(batch[r]);
        if (fields.length !== 8) {
          throw new Error(`Linha CSV inválida (colunas=${fields.length}) na linha ${i + r + 1}`);
        }

        const ibgeCode = Number(fields[0]);
        const name = fields[1];
        const nameNormalized = fields[2];
        const uf = fields[3];
        const ufCode = Number(fields[4]);
        const region = fields[5];
        const regionCode = Number(fields[6]);
        const population = fields[7] === "" ? null : Number(fields[7]);

        values.push(ibgeCode, name, nameNormalized, uf, ufCode, region, regionCode, population);

        const base = r * 8;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`,
        );
      }

      const insertSql =
        `INSERT INTO public.municipalities (${columns.join(", ")}, created_at, updated_at)\n`
        + `VALUES ${placeholders.map((p) => p.replace(/\)$/, ", now(), now())")).join(",\n")}\n`
        + "ON CONFLICT (ibge_code) DO UPDATE SET\n"
        + "  name = EXCLUDED.name,\n"
        + "  name_normalized = EXCLUDED.name_normalized,\n"
        + "  uf = EXCLUDED.uf,\n"
        + "  uf_code = EXCLUDED.uf_code,\n"
        + "  region = EXCLUDED.region,\n"
        + "  region_code = EXCLUDED.region_code,\n"
        + "  population = EXCLUDED.population,\n"
        + "  updated_at = now();";

      await client.query(insertSql, values);
    }

    await client.query(
      "UPDATE public.municipalities_sync_state "
      + "SET last_sync_at = now(), last_success_at = now(), next_due_at = now() + interval '6 months', last_error = NULL, updated_at = now() "
      + "WHERE id = 1;",
    );

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
    }
    throw err;
  }
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    process.stderr.write("Uso: node lib/db/scripts/apply_sql_file.cjs <arquivo.sql>\n");
    process.exit(1);
  }
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const abs = path.resolve(repoRoot, filePath);
  if (!fs.existsSync(abs)) {
    process.stderr.write(`Arquivo não encontrado: ${abs}\n`);
    process.exit(1);
  }

  const envPath = path.join(repoRoot, ".env");
  const envFromFile = readDotEnv(envPath);
  const databaseUrl = process.env.DATABASE_URL || envFromFile.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write("DATABASE_URL não encontrado no ambiente nem no .env\n");
    process.exit(1);
  }

  const sql = fs.readFileSync(abs, "utf8");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const isMunicipalitiesSeed = filePath.replace(/\\/g, "/").endsWith("/lib/db/migrations/0007_seed_municipalities.sql")
      || abs.replace(/\\/g, "/").endsWith("/lib/db/migrations/0007_seed_municipalities.sql");

    if (isMunicipalitiesSeed && extractCopyBlock(sql)) {
      await applyMunicipalitiesSeedMigration(client, sql);
    } else {
      await client.query(sql);
    }
    process.stdout.write("SQL_OK\n");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  process.stderr.write(`${err && err.message ? err.message : err}\n`);
  process.exit(1);
});

