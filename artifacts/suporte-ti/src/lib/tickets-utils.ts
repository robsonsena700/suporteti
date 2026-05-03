export type TicketLikeBase = {
  id: number;
  uf: string;
  municipality: string;
  createdAt: string;
  createdBy?: { name?: string | null } | null;
  assignedTo?: { name?: string | null } | null;
};

export type TicketsSortBy = "createdAt" | "user" | "location" | "responsible";
export type TicketsSortDir = "asc" | "desc";

export function canViewResolvedTicketRating(opts: {
  isAuthenticated: boolean;
  role?: string | null;
  status?: string | null;
}): boolean {
  if (!opts.isAuthenticated) return false;
  if (opts.role !== "USER") return false;
  if (opts.status !== "RESOLVED" && opts.status !== "CLOSED") return false;
  return true;
}

export function canCreateTicketMessage(opts: {
  canInteract: boolean;
  status?: string | null;
}): boolean {
  if (!opts.canInteract) return false;
  return opts.status !== "CLOSED" && opts.status !== "RESOLVED";
}

export function formatUfMunicipality(uf: string, municipality: string): string {
  return `${uf} - ${municipality}`;
}

export function filterAndSortTickets<T extends TicketLikeBase>(
  tickets: T[],
  opts: {
    userFilter?: string;
    locationFilter?: string;
    responsibleFilter?: string;
    sortBy?: TicketsSortBy;
    sortDir?: TicketsSortDir;
  } = {},
): T[] {
  const userQuery = (opts.userFilter ?? "").trim().toLowerCase();
  const locationQuery = (opts.locationFilter ?? "").trim().toLowerCase();
  const responsibleQuery = (opts.responsibleFilter ?? "").trim().toLowerCase();
  const sortBy = opts.sortBy ?? "createdAt";
  const sortDir = opts.sortDir ?? "desc";

  const filtered = tickets.filter(t => {
    const createdByName = (t.createdBy?.name ?? "").toLowerCase();
    const responsibleName = (t.assignedTo?.name ?? "").toLowerCase();
    const locationText = formatUfMunicipality(t.uf, t.municipality).toLowerCase();

    if (userQuery && !createdByName.includes(userQuery)) return false;
    if (responsibleQuery && !responsibleName.includes(responsibleQuery)) return false;
    if (locationQuery && !locationText.includes(locationQuery)) return false;
    return true;
  });

  const factor = sortDir === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => {
    const aUser = a.createdBy?.name ?? "";
    const bUser = b.createdBy?.name ?? "";
    const aLoc = formatUfMunicipality(a.uf, a.municipality);
    const bLoc = formatUfMunicipality(b.uf, b.municipality);
    const aResp = a.assignedTo?.name ?? "";
    const bResp = b.assignedTo?.name ?? "";

    if (sortBy === "user") return aUser.localeCompare(bUser, "pt-BR") * factor;
    if (sortBy === "location") return aLoc.localeCompare(bLoc, "pt-BR") * factor;
    if (sortBy === "responsible") return aResp.localeCompare(bResp, "pt-BR") * factor;
    return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * factor;
  });
}
