import { setTimeout as delay } from "node:timers/promises";

type Result = { ok: boolean; ms: number };

function envInt(name: string, def: number): number {
  const raw = process.env[name];
  const v = raw ? parseInt(raw, 10) : def;
  return Number.isFinite(v) ? v : def;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function timedFetch(url: string, token: string): Promise<Result> {
  const t0 = performance.now();
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const ms = performance.now() - t0;
    return { ok: resp.ok, ms };
  } catch {
    const ms = performance.now() - t0;
    return { ok: false, ms };
  }
}

const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const token = process.env.TOKEN ?? "";
if (!token) {
  throw new Error("Defina TOKEN (Bearer token) no ambiente, ex.: TOKEN=... pnpm run test:chat:load");
}

const durationSec = envInt("DURATION_SEC", 30);
const concurrency = envInt("CONCURRENCY", 10);
const pauseMs = envInt("PAUSE_MS", 0);

const until = Date.now() + durationSec * 1000;
const endpoints = [
  `${baseUrl}/api/chat/messages?limit=10&afterId=0`,
  `${baseUrl}/api/chat/dm-inbox`,
];

const results: Record<string, Result[]> = Object.fromEntries(endpoints.map((e) => [e, []]));

async function worker(workerId: number) {
  let i = 0;
  while (Date.now() < until) {
    const url = endpoints[i % endpoints.length];
    const r = await timedFetch(url, token);
    results[url].push(r);
    i += 1;
    if (pauseMs > 0) await delay(pauseMs);
  }
  return workerId;
}

await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));

for (const url of endpoints) {
  const all = results[url];
  const ok = all.filter((r) => r.ok);
  const ms = ok.map((r) => r.ms).sort((a, b) => a - b);
  const total = all.length;
  const okCount = ok.length;
  const failCount = total - okCount;
  const avg = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0;

  console.log("\n", url);
  console.log({
    total,
    ok: okCount,
    fail: failCount,
    avgMs: Math.round(avg),
    p50Ms: Math.round(percentile(ms, 50)),
    p90Ms: Math.round(percentile(ms, 90)),
    p95Ms: Math.round(percentile(ms, 95)),
    p99Ms: Math.round(percentile(ms, 99)),
  });
}
