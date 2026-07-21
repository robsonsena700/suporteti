import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilPath = path.resolve(__dirname, "../../artifacts/api-server/src/lib/user-approval-policy.ts");
const mod = await import(pathToFileURL(utilPath).href);

const {
  hasMatchingMunicipalityScope,
  buildCoordinatorApprovalAuditDetail,
} = mod as {
  hasMatchingMunicipalityScope: (actor: { uf?: string | null; municipality?: string | null }, candidate: { uf?: string | null; municipality?: string | null }) => boolean;
  buildCoordinatorApprovalAuditDetail: (args: {
    actorUf?: string | null;
    actorMunicipality?: string | null;
    candidateUf?: string | null;
    candidateMunicipality?: string | null;
    requestedRole?: string | null;
    reason?: string | null;
  }) => string;
};

assert.equal(
  hasMatchingMunicipalityScope(
    { uf: "SP", municipality: "São Paulo" },
    { uf: "SP", municipality: "São Paulo" },
  ),
  true,
  "Deve permitir aprovação quando UF e município são idênticos",
);

assert.equal(
  hasMatchingMunicipalityScope(
    { uf: "SP", municipality: "São Paulo" },
    { uf: "RJ", municipality: "São Paulo" },
  ),
  false,
  "Não deve permitir aprovação quando a UF diverge",
);

assert.equal(
  hasMatchingMunicipalityScope(
    { uf: "SP", municipality: "São Paulo" },
    { uf: "SP", municipality: "Campinas" },
  ),
  false,
  "Não deve permitir aprovação quando o município diverge",
);

assert.equal(
  hasMatchingMunicipalityScope(
    { uf: "SP", municipality: " São Paulo " },
    { uf: "SP", municipality: "São Paulo" },
  ),
  true,
  "Deve desconsiderar espaços acidentais nas extremidades",
);

const detail = JSON.parse(
  buildCoordinatorApprovalAuditDetail({
    actorUf: "SP",
    actorMunicipality: "São Paulo",
    candidateUf: "RJ",
    candidateMunicipality: "Rio de Janeiro",
    requestedRole: "USER",
    reason: "candidate_outside_coordinator_scope",
  }),
);

assert.deepEqual(detail, {
  actorUf: "SP",
  actorMunicipality: "São Paulo",
  candidateUf: "RJ",
  candidateMunicipality: "Rio de Janeiro",
  requestedRole: "USER",
  reason: "candidate_outside_coordinator_scope",
});
