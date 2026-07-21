export type ApprovalLocationScope = {
  uf?: string | null;
  municipality?: string | null;
};

function normalizeScopeValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMunicipalityKey(value: unknown): string {
  return normalizeScopeValue(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeUfKey(value: unknown): string {
  return normalizeScopeValue(value).toUpperCase();
}

export function normalizeMunicipalityScopeKey(value: unknown): string {
  return normalizeMunicipalityKey(value);
}

export function hasMatchingMunicipalityScope(
  actor: ApprovalLocationScope,
  candidate: ApprovalLocationScope,
): boolean {
  const actorUf = normalizeUfKey(actor.uf);
  const actorMunicipality = normalizeMunicipalityKey(actor.municipality);
  const candidateUf = normalizeUfKey(candidate.uf);
  const candidateMunicipality = normalizeMunicipalityKey(candidate.municipality);

  if (!actorUf || !actorMunicipality || !candidateUf || !candidateMunicipality) {
    return false;
  }

  return actorUf === candidateUf && actorMunicipality === candidateMunicipality;
}

export function buildCoordinatorApprovalAuditDetail(args: {
  actorUf?: string | null;
  actorMunicipality?: string | null;
  candidateUf?: string | null;
  candidateMunicipality?: string | null;
  requestedRole?: string | null;
  reason?: string | null;
}): string {
  return JSON.stringify({
    actorUf: normalizeScopeValue(args.actorUf) || null,
    actorMunicipality: normalizeScopeValue(args.actorMunicipality) || null,
    candidateUf: normalizeScopeValue(args.candidateUf) || null,
    candidateMunicipality: normalizeScopeValue(args.candidateMunicipality) || null,
    requestedRole: normalizeScopeValue(args.requestedRole) || null,
    reason: normalizeScopeValue(args.reason) || null,
  });
}
