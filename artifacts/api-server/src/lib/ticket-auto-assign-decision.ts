type AssignDecision = {
  shouldAssign: boolean;
  nextAssignedToId: number | null;
  nextStatus: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" | null;
};

export function computeAutoAssignDecision(args: {
  actorRole: string;
  actorUserId: number;
  currentAssignedToId: number | null;
  currentStatus: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
}): AssignDecision {
  const { actorRole, actorUserId, currentAssignedToId, currentStatus } = args;

  if (currentStatus === "CLOSED") {
    return { shouldAssign: false, nextAssignedToId: null, nextStatus: null };
  }

  const normalizedRole = actorRole.toUpperCase();
  const canBeAssigned = normalizedRole === "ADMIN" || normalizedRole === "ANALYST" || normalizedRole === "COORDINATOR";
  if (!canBeAssigned) {
    return { shouldAssign: false, nextAssignedToId: null, nextStatus: null };
  }

  if (currentAssignedToId === actorUserId) {
    return { shouldAssign: false, nextAssignedToId: null, nextStatus: null };
  }

  const nextStatus = currentStatus === "OPEN" ? "IN_PROGRESS" : null;
  return { shouldAssign: true, nextAssignedToId: actorUserId, nextStatus };
}
