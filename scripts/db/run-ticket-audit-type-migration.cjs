const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

function loadDatabaseUrlFromDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return null;
  const content = fs.readFileSync(envPath, "utf8");
  const line = content.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  if (!line) return null;
  return line.slice("DATABASE_URL=".length).trim();
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || loadDatabaseUrlFromDotEnv();
  if (!databaseUrl) {
    process.stderr.write("DATABASE_URL não encontrado no ambiente nem no .env\n");
    process.exit(1);
  }

  const sql = "ALTER TYPE ticket_audit_type ADD VALUE IF NOT EXISTS 'TICKET_UPDATED';";
  const fallback = "DO $$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='ticket_audit_type' AND e.enumlabel='TICKET_UPDATED') THEN ALTER TYPE ticket_audit_type ADD VALUE 'TICKET_UPDATED'; END IF; END$$;";

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(sql);
    process.stdout.write("OK\n");
  } catch (err) {
    const msg = String(err && err.message ? err.message : "");
    if (msg.includes("syntax error") && msg.includes("IF")) {
      await client.query(fallback);
      process.stdout.write("OK_FALLBACK\n");
    } else if (msg.includes("already exists")) {
      process.stdout.write("OK_ALREADY\n");
    } else {
      process.stderr.write(`${msg}\n`);
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  process.stderr.write(`${err && err.message ? err.message : err}\n`);
  process.exit(1);
});

