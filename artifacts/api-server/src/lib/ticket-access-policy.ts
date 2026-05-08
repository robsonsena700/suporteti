export type TicketAccessDecision = {
  canView: boolean;
  canInteract: boolean;
  canAssign: boolean;
};

export function canCreateTicketMessage(args: { ticketStatus: string }): boolean {
  return args.ticketStatus !== "CLOSED" && args.ticketStatus !== "RESOLVED";
}

export function computeTicketAccess(args: {
  actorRole: string;
  actorUserId: number;
  ticketCreatedById: number;
  ticketAssignedToId: number | null;
  isCoordinatorOfOwner?: boolean;
  isCollaborator?: boolean;
  ownerHasNoCoordinator?: boolean;
}): TicketAccessDecision {
  const role = args.actorRole.toUpperCase();
  const isOwner = args.ticketCreatedById === args.actorUserId;

  if (role === "USER") {
    return { canView: isOwner, canInteract: isOwner, canAssign: false };
  }

  const isAssignee = args.ticketAssignedToId === args.actorUserId;
  const isCollaborator = args.isCollaborator === true;

  const canView = isOwner
    || isAssignee
    || isCollaborator
    || role === "ADMIN"
    || role === "ANALYST"
    || ((role === "COORDINATOR" || role === "GESTOR") && args.isCoordinatorOfOwner === true);
  const canInteract = isOwner
    || isAssignee
    || isCollaborator
    || ((role === "ADMIN" || role === "ANALYST") && args.ownerHasNoCoordinator === true);
  const canAssign = (role === "ADMIN" || role === "ANALYST" || role === "COORDINATOR") && canView;

  return { canView, canInteract, canAssign };
}
