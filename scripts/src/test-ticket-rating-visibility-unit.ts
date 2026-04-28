import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilsPath = path.resolve(__dirname, "../../artifacts/suporte-ti/src/lib/tickets-utils.ts");
const mod = await import(pathToFileURL(utilsPath).href);

const { canViewResolvedTicketRating, canCreateTicketMessage } = mod as {
  canViewResolvedTicketRating: (opts: {
    isAuthenticated: boolean;
    role?: string | null;
    status?: string | null;
  }) => boolean;
  canCreateTicketMessage: (opts: { canInteract: boolean; status?: string | null }) => boolean;
};

assert.equal(
  canViewResolvedTicketRating({ isAuthenticated: false, role: "ADMIN", status: "RESOLVED" }),
  false,
);

assert.equal(
  canViewResolvedTicketRating({ isAuthenticated: true, role: "ADMIN", status: "RESOLVED" }),
  true,
);

assert.equal(
  canViewResolvedTicketRating({ isAuthenticated: true, role: "USER", status: "RESOLVED" }),
  true,
);

assert.equal(
  canViewResolvedTicketRating({ isAuthenticated: true, role: "ANALYST", status: "RESOLVED" }),
  false,
);

assert.equal(
  canViewResolvedTicketRating({ isAuthenticated: true, role: "COORDINATOR", status: "RESOLVED" }),
  false,
);

assert.equal(
  canViewResolvedTicketRating({ isAuthenticated: true, role: "USER", status: "OPEN" }),
  false,
);

assert.equal(
  canViewResolvedTicketRating({ isAuthenticated: true, role: null, status: "RESOLVED" }),
  false,
);

assert.equal(canCreateTicketMessage({ canInteract: true, status: "OPEN" }), true);
assert.equal(canCreateTicketMessage({ canInteract: true, status: "CLOSED" }), false);
assert.equal(canCreateTicketMessage({ canInteract: true, status: "RESOLVED" }), false);
assert.equal(canCreateTicketMessage({ canInteract: false, status: "OPEN" }), false);

console.log("Teste unitário de visibilidade da avaliação por perfil concluído com sucesso.");
