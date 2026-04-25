import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === "\"") {
      i++;
      let value = "";
      while (i < line.length) {
        const ch = line[i];
        if (ch === "\"") {
          if (line[i + 1] === "\"") {
            value += "\"";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += ch;
        i++;
      }
      if (line[i] === ",") i++;
      out.push(value);
      continue;
    }

    let value = "";
    while (i < line.length && line[i] !== ",") {
      value += line[i];
      i++;
    }
    if (line[i] === ",") i++;
    out.push(value);
  }
  if (line.endsWith(",")) out.push("");
  return out;
}

function getCopyBlockLines(sql: string): string[] {
  const lines = sql.split(/\r?\n/);
  const copyIdx = lines.findIndex((l) => l.startsWith("COPY municipalities_import "));
  assert.ok(copyIdx >= 0, "COPY municipalities_import não encontrado");
  const endIdx = lines.findIndex((l, idx) => idx > copyIdx && l.trim() === "\\.");
  assert.ok(endIdx >= 0, "terminador \\. não encontrado");
  return lines.slice(copyIdx + 1, endIdx).filter((l) => l.trim().length > 0);
}

function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const migrationPath = path.join(repoRoot, "lib", "db", "migrations", "0007_seed_municipalities.sql");
  assert.ok(fs.existsSync(migrationPath), "migration 0007_seed_municipalities.sql não encontrada");

  const sql = fs.readFileSync(migrationPath, "utf8");
  const lines = getCopyBlockLines(sql);

  assert.equal(lines.length, 5570, "quantidade de municípios diferente de 5570");

  const seenCodes = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fields = parseCsvLine(line);
    assert.equal(fields.length, 8, `CSV com ${fields.length} colunas na linha ${i + 1}`);

    const ibgeCode = Number(fields[0]);
    assert.ok(Number.isInteger(ibgeCode) && ibgeCode > 0, `ibge_code inválido na linha ${i + 1}`);
    assert.ok(!seenCodes.has(ibgeCode), `ibge_code duplicado: ${ibgeCode}`);
    seenCodes.add(ibgeCode);

    const name = fields[1];
    const nameNormalized = fields[2];
    const uf = fields[3];
    const ufCode = Number(fields[4]);
    const region = fields[5];
    const regionCode = Number(fields[6]);
    const population = fields[7];

    assert.ok(typeof name === "string" && name.length > 1, `name inválido para ${ibgeCode}`);
    assert.ok(typeof nameNormalized === "string" && nameNormalized.length > 1, `name_normalized inválido para ${ibgeCode}`);
    assert.ok(/^[A-Z]{2}$/.test(uf), `UF inválida para ${ibgeCode}: ${uf}`);
    assert.ok(Number.isInteger(ufCode) && ufCode >= 11 && ufCode <= 53, `uf_code inválido para ${ibgeCode}: ${ufCode}`);
    assert.ok(typeof region === "string" && region.length > 2, `region inválida para ${ibgeCode}`);
    assert.ok(Number.isInteger(regionCode) && regionCode >= 1 && regionCode <= 5, `region_code inválido para ${ibgeCode}: ${regionCode}`);
    assert.ok(population === "", `population deveria estar vazia (NULL), recebida: ${population}`);
  }

  process.stdout.write("OK\n");
}

main();
