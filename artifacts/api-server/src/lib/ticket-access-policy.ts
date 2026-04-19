export type TicketAccessDecision = {
  canView: boolean;
  canInteract: boolean;
  canAssign: boolean;
};

export function computeTicketAccess(args: {
  actorRole: string;
  actorUserId: number;
  ticketCreatedById: number;
  ticketAssignedToId: number | null;
}): TicketAccessDecision {
  const role = args.actorRole.toUpperCase();
  const isOwner = args.ticketCreatedById === args.actorUserId;
  const isAssignee = args.ticketAssignedToId === args.actorUserId;

  const canView = isOwner || isAssignee || role === "ADMIN" || role === "ANALYST";
  const canInteract = isOwner || isAssignee;
  const canAssign = (role === "ADMIN" || role === "ANALYST" || role === "COORDINATOR")
    && (args.ticketAssignedToId == null || isAssignee);

  return { canView, canInteract, canAssign };
}

