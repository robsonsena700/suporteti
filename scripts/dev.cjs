const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function getPnpmRunner() {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      baseArgs: [process.env.npm_execpath],
      useShell: false,
    };
  }

  return process.platform === "win32"
    ? { command: "pnpm.cmd", baseArgs: [], useShell: true }
    : { command: "pnpm", baseArgs: [], useShell: false };
}

function spawnPnpm(args, extraEnv) {
  const runner = getPnpmRunner();
  return spawn(runner.command, [...runner.baseArgs, ...args], {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    shell: runner.useShell,
  });
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readDotEnvFile(envPath) {
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function tryLoadEnvFromDotEnv() {
  const repoRoot = path.resolve(__dirname, "..");
  const envPath = path.join(repoRoot, ".env");
  const loaded = readDotEnvFile(envPath);
  for (const [k, v] of Object.entries(loaded)) {
    if (process.env[k] == null || process.env[k] === "") {
      process.env[k] = String(v);
    }
  }
}

if (!process.env.DATABASE_URL) {
  tryLoadEnvFromDotEnv();
}

if (!process.env.DATABASE_URL) {
  fail(
    "DATABASE_URL não está definido. Exemplo:\n" +
      '  $env:DATABASE_URL = "postgresql://postgres:senha@localhost:5445/suporteti"\n' +
      "Ou defina DATABASE_URL no arquivo .env na raiz do repositório.\n",
  );
}

const apiPort = process.env.API_PORT ?? "3001";
const webPort = process.env.WEB_PORT ?? "5174";

const api = spawnPnpm(["--filter", "@workspace/api-server", "run", "dev"], {
  PORT: apiPort,
});

const web = spawnPnpm(["--filter", "@workspace/suporte-ti", "run", "dev"], {
  PORT: webPort,
  BASE_PATH: process.env.BASE_PATH ?? "/",
  VITE_API_PROXY_TARGET: process.env.VITE_API_PROXY_TARGET ?? `http://localhost:${apiPort}`,
});

let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    api.kill();
  } catch {}
  try {
    web.kill();
  } catch {}

  process.exit(code);
}

api.on("exit", (code) => shutdown(code ?? 0));
web.on("exit", (code) => shutdown(code ?? 0));

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
