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
    await client.query(sql);
    process.stdout.write("SQL_OK\n");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  process.stderr.write(`${err && err.message ? err.message : err}\n`);
  process.exit(1);
});

