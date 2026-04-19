import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilPath = path.resolve(__dirname, "../../artifacts/api-server/src/lib/ticket-reopen-policy.ts");
const mod = await import(pathToFileURL(utilPath).href);

const { canReopenClosedTicket } = mod as {
  canReopenClosedTicket: (args: { role: string; closedAt: Date; now?: Date }) => boolean;
};

const now = new Date("2026-04-20T10:00:00.000Z");

assert.equal(
  canReopenClosedTicket({
    role: "ADMIN",
    closedAt: new Date("2026-04-20T09:00:00.000Z"),
    now,
  }),
  true,
);

assert.equal(
  canReopenClosedTicket({
    role: "ANALYST",
    closedAt: new Date("2026-04-19T10:00:00.000Z"),
    now,
  }),
  true,
);

assert.equal(
  canReopenClosedTicket({
    role: "ANALYST",
    closedAt: new Date("2026-04-19T09:59:59.000Z"),
    now,
  }),
  false,
);

assert.equal(
  canReopenClosedTicket({
    role: "COORDINATOR",
    closedAt: new Date("2026-04-20T09:00:00.000Z"),
    now,
  }),
  false,
);

console.log("Teste unitário de política de reabertura concluído com sucesso.");

