import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function tryLoadDotEnv(): void {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, "../../..");
    const envPath = path.join(repoRoot, ".env");
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, "utf-8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (!key) continue;
      if (
        (value.startsWith("\"") && value.endsWith("\""))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] == null || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  } catch {
  }
}

if (!process.env.DATABASE_URL) {
  tryLoadDotEnv();
}

if (!process.env.PORT && process.env.API_PORT) {
  process.env.PORT = process.env.API_PORT;
}

function ensureUploadsDir(): void {
  const dir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.resolve(process.cwd(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, ".probe_write");
  fs.writeFileSync(probe, "");
  fs.unlinkSync(probe);
}

async function main() {
  const rawPort = process.env["PORT"] ?? "3001";

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const [{ default: app }, { logger }, { startMunicipalitiesSyncScheduler }] = await Promise.all([
    import("./app"),
    import("./lib/logger"),
    import("./lib/municipalities-sync"),
  ]);

  try {
    ensureUploadsDir();
  } catch (err) {
    console.error("Falha ao preparar UPLOADS_DIR:", err);
    process.exit(1);
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startMunicipalitiesSyncScheduler();
  });
}

main();
