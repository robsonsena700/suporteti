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
  const isAssignee = args.ticketAssignedToId === args.actorUserId;
  const isCollaborator = args.isCollaborator === true;

  const canView = isOwner
    || isAssignee
    || isCollaborator
    || role === "ADMIN"
    || role === "ANALYST"
    || (role === "COORDINATOR" && args.isCoordinatorOfOwner === true);
  const canInteract = isOwner
    || isAssignee
    || isCollaborator
    || ((role === "ADMIN" || role === "ANALYST") && args.ownerHasNoCoordinator === true);
  const canAssign = (role === "ADMIN" || role === "ANALYST" || role === "COORDINATOR") && canView;

  return { canView, canInteract, canAssign };
}
