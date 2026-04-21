export const REOPEN_WINDOW_HOURS = 24;

export function canReopenClosedTicket(args: {
  role: string;
  closedAt: Date;
  now?: Date;
}): boolean {
  const role = args.role.toUpperCase();
  if (role !== "ADMIN" && role !== "ANALYST") return false;

  const now = args.now ?? new Date();
  const diffMs = now.getTime() - args.closedAt.getTime();
  if (diffMs < 0) return false;

  return diffMs <= REOPEN_WINDOW_HOURS * 60 * 60 * 1000;
}

