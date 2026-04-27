import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilPath = path.resolve(__dirname, "../../artifacts/api-server/src/lib/ticket-access-policy.ts");
const mod = await import(pathToFileURL(utilPath).href);

const { computeTicketAccess } = mod as {
  computeTicketAccess: (args: any) => { canView: boolean; canInteract: boolean; canAssign: boolean };
};

{
  const a = computeTicketAccess({ actorRole: "USER", actorUserId: 1, ticketCreatedById: 2, ticketAssignedToId: null });
  assert.equal(a.canView, false);
  assert.equal(a.canInteract, false);
  assert.equal(a.canAssign, false);
}

{
  const a = computeTicketAccess({
    actorRole: "USER",
    actorUserId: 1,
    ticketCreatedById: 2,
    ticketAssignedToId: null,
    isCollaborator: true,
  });
  assert.equal(a.canView, true);
  assert.equal(a.canInteract, true);
  assert.equal(a.canAssign, false);
}

{
  const a = computeTicketAccess({ actorRole: "ADMIN", actorUserId: 1, ticketCreatedById: 2, ticketAssignedToId: null });
  assert.equal(a.canView, true);
  assert.equal(a.canInteract, false);
  assert.equal(a.canAssign, true);
}

{
  const a = computeTicketAccess({ actorRole: "ANALYST", actorUserId: 10, ticketCreatedById: 2, ticketAssignedToId: 10 });
  assert.equal(a.canView, true);
  assert.equal(a.canInteract, true);
  assert.equal(a.canAssign, true);
}

{
  const a = computeTicketAccess({ actorRole: "COORDINATOR", actorUserId: 10, ticketCreatedById: 2, ticketAssignedToId: 11 });
  assert.equal(a.canView, false);
  assert.equal(a.canInteract, false);
  assert.equal(a.canAssign, false);
}

{
  const a = computeTicketAccess({
    actorRole: "COORDINATOR",
    actorUserId: 10,
    ticketCreatedById: 2,
    ticketAssignedToId: null,
    isCoordinatorOfOwner: true,
  });
  assert.equal(a.canView, true);
  assert.equal(a.canInteract, false);
}

console.log("Teste unitário de política de acesso ao ticket concluído com sucesso.");
