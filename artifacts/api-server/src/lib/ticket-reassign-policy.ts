export function canActorReassign(role: string): boolean {
  const r = role.toUpperCase();
  return r === "ADMIN" || r === "ANALYST" || r === "COORDINATOR";
}

export function canReceiveReassign(role: string, status: string): boolean {
  const r = role.toUpperCase();
  if (status !== "ACTIVE") return false;
  return r === "ADMIN" || r === "ANALYST" || r === "COORDINATOR";
}

export function requiresStaffAssigneeForStatus(nextStatus: string): boolean {
  return nextStatus === "IN_PROGRESS"
    || nextStatus === "AWAITING_CUSTOMER"
    || nextStatus === "RESOLVED"
    || nextStatus === "CLOSED";
}

