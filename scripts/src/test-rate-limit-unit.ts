import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilPath = path.resolve(__dirname, "../../artifacts/api-server/src/lib/rate-limit.ts");
const mod = await import(pathToFileURL(utilPath).href);

const { createInMemoryRateLimiter } = mod as { createInMemoryRateLimiter: (opts: { windowMs: number; max: number }) => any };

const limiter = createInMemoryRateLimiter({ windowMs: 1000, max: 2 });

assert.equal(limiter.check("k", 0).allowed, true);
assert.equal(limiter.check("k", 10).allowed, true);
const third = limiter.check("k", 20);
assert.equal(third.allowed, false);
assert.ok(third.retryAfterSeconds >= 1);

assert.equal(limiter.check("k", 2000).allowed, true);

