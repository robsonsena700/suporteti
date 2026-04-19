import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilPath = path.resolve(__dirname, "../../artifacts/api-server/src/lib/ticket-auto-assign-decision.ts");
const mod = await import(pathToFileURL(utilPath).href);

const { computeAutoAssignDecision } = mod as {
  computeAutoAssignDecision: (args: any) => any;
};

{
  const d = computeAutoAssignDecision({
    actorRole: "USER",
    actorUserId: 10,
    currentAssignedToId: null,
    currentStatus: "OPEN",
  });
  assert.equal(d.shouldAssign, false);
}

{
  const d = computeAutoAssignDecision({
    actorRole: "ANALYST",
    actorUserId: 10,
    currentAssignedToId: null,
    currentStatus: "OPEN",
  });
  assert.equal(d.shouldAssign, true);
  assert.equal(d.nextAssignedToId, 10);
  assert.equal(d.nextStatus, "IN_PROGRESS");
}

{
  const d = computeAutoAssignDecision({
    actorRole: "COORDINATOR",
    actorUserId: 10,
    currentAssignedToId: 11,
    currentStatus: "IN_PROGRESS",
  });
  assert.equal(d.shouldAssign, true);
  assert.equal(d.nextAssignedToId, 10);
  assert.equal(d.nextStatus, null);
}

{
  const d = computeAutoAssignDecision({
    actorRole: "ADMIN",
    actorUserId: 10,
    currentAssignedToId: 10,
    currentStatus: "IN_PROGRESS",
  });
  assert.equal(d.shouldAssign, false);
}

{
  const d = computeAutoAssignDecision({
    actorRole: "ANALYST",
    actorUserId: 10,
    currentAssignedToId: null,
    currentStatus: "CLOSED",
  });
  assert.equal(d.shouldAssign, false);
}

console.log("Teste unitário de auto-atribuição do chamado concluído com sucesso.");
