import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilPath = path.resolve(__dirname, "../../artifacts/api-server/src/lib/ticket-reassign-policy.ts");
const mod = await import(pathToFileURL(utilPath).href);

const { canActorReassign, canReceiveReassign, requiresStaffAssigneeForStatus } = mod as {
  canActorReassign: (role: string) => boolean;
  canReceiveReassign: (role: string, status: string) => boolean;
  requiresStaffAssigneeForStatus: (status: string) => boolean;
};

assert.equal(canActorReassign("ADMIN"), true);
assert.equal(canActorReassign("ANALYST"), true);
assert.equal(canActorReassign("COORDINATOR"), true);
assert.equal(canActorReassign("USER"), false);

assert.equal(canReceiveReassign("ADMIN", "ACTIVE"), true);
assert.equal(canReceiveReassign("ANALYST", "ACTIVE"), true);
assert.equal(canReceiveReassign("COORDINATOR", "ACTIVE"), true);
assert.equal(canReceiveReassign("ANALYST", "INACTIVE"), false);
assert.equal(canReceiveReassign("USER", "ACTIVE"), false);

assert.equal(requiresStaffAssigneeForStatus("OPEN"), false);
assert.equal(requiresStaffAssigneeForStatus("IN_PROGRESS"), true);
assert.equal(requiresStaffAssigneeForStatus("AWAITING_CUSTOMER"), true);
assert.equal(requiresStaffAssigneeForStatus("RESOLVED"), true);
assert.equal(requiresStaffAssigneeForStatus("CLOSED"), true);

console.log("Teste unitário da política de reatribuição concluído com sucesso.");

