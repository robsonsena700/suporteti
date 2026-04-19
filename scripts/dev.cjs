const { spawn } = require("node:child_process");

function getPnpmRunner() {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      baseArgs: [process.env.npm_execpath],
    };
  }

  return process.platform === "win32"
    ? { command: "pnpm.cmd", baseArgs: [] }
    : { command: "pnpm", baseArgs: [] };
}

function spawnPnpm(args, extraEnv) {
  const runner = getPnpmRunner();
  return spawn(runner.command, [...runner.baseArgs, ...args], {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    shell: false,
  });
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  fail(
    "DATABASE_URL não está definido. Exemplo:\n" +
      '  $env:DATABASE_URL = "postgresql://postgres:senha@localhost:5445/suporteti"\n',
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
