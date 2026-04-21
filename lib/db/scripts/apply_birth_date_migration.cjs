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
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const envPath = path.join(repoRoot, ".env");
  const fromFile = readDotEnv(envPath);
  const databaseUrl = process.env.DATABASE_URL || fromFile.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write("DATABASE_URL não encontrado no ambiente nem no .env\n");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await pool.query("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS birth_date date;");
    process.stdout.write("MIGRATION_OK\n");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
