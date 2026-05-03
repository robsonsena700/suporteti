import { db, userCoordinatorsTable, usersTable, ticketsTable, ticketCollaboratorsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import type { JwtPayload } from "../middlewares/auth";
import { logger } from "./logger";
import { computeTicketAccess } from "./ticket-access-policy";

type TicketRow = typeof ticketsTable.$inferSelect;

async function isTicketCollaborator(userId: number, ticketId: number): Promise<boolean> {
  const [row] = await db
    .select({ ticketId: ticketCollaboratorsTable.ticketId })
    .from(ticketCollaboratorsTable)
    .where(and(eq(ticketCollaboratorsTable.ticketId, ticketId), eq(ticketCollaboratorsTable.userId, userId)));
  return Boolean(row?.ticketId);
}

export async function getCoordinatorIdsForUser(userId: number): Promise<number[]> {
  const links = await db
    .select({ coordinatorId: userCoordinatorsTable.coordinatorId })
    .from(userCoordinatorsTable)
    .where(eq(userCoordinatorsTable.userId, userId));
  return links.map(link => link.coordinatorId);
}

export async function getManagedUserIdsByCoordinator(coordinatorId: number): Promise<number[]> {
  const links = await db
    .select({ userId: userCoordinatorsTable.userId })
    .from(userCoordinatorsTable)
    .where(eq(userCoordinatorsTable.coordinatorId, coordinatorId));
  return links.map(link => link.userId);
}

export async function getResponsibleCoordinatorIdForUser(userId: number): Promise<number | null> {
  const [link] = await db
    .select({ coordinatorId: userCoordinatorsTable.coordinatorId })
    .from(userCoordinatorsTable)
    .where(eq(userCoordinatorsTable.userId, userId));
  return link?.coordinatorId ?? null;
}

async function ownerHasNoCoordinator(userId: number): Promise<boolean> {
  const [link] = await db
    .select({ coordinatorId: userCoordinatorsTable.coordinatorId })
    .from(userCoordinatorsTable)
    .where(eq(userCoordinatorsTable.userId, userId));
  return !link?.coordinatorId;
}

export async function listCoordinatorsForUser(userId: number) {
  const coordinatorIds = await getCoordinatorIdsForUser(userId);
  if (coordinatorIds.length === 0) return [];
  return db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, coordinatorIds));
}

export async function canReadTicket(user: JwtPayload, ticket: TicketRow): Promise<boolean> {
  const base = computeTicketAccess({
    actorRole: user.role,
    actorUserId: user.userId,
    ticketCreatedById: ticket.createdById,
    ticketAssignedToId: ticket.assignedToId ?? null,
  });
  if (base.canView) return true;

  if (user.role === "COORDINATOR") {
    const responsibleCoordinatorId = await getResponsibleCoordinatorIdForUser(ticket.createdById);
    const viaCoordinator = computeTicketAccess({
      actorRole: user.role,
      actorUserId: user.userId,
      ticketCreatedById: ticket.createdById,
      ticketAssignedToId: ticket.assignedToId ?? null,
      isCoordinatorOfOwner: responsibleCoordinatorId === user.userId,
    }).canView;
    if (viaCoordinator) return true;
  }

  return isTicketCollaborator(user.userId, ticket.id);
}

export async function enforceTicketAccess(
  user: JwtPayload,
  ticket: TicketRow,
  action: string,
): Promise<boolean> {
  const coordinatorFlag = user.role === "COORDINATOR"
    ? (await getResponsibleCoordinatorIdForUser(ticket.createdById)) === user.userId
    : false;
  const collaboratorFlag = await isTicketCollaborator(user.userId, ticket.id);
  const requiresInteract =
    action === "messages:create"
    || action === "attachments:create"
    || action === "attachments:delete"
    || action === "tickets:update";
  const noCoordinatorFlag =
    (user.role === "ADMIN" || user.role === "ANALYST")
    && requiresInteract
    ? await ownerHasNoCoordinator(ticket.createdById)
    : false;

  const access = computeTicketAccess({
    actorRole: user.role,
    actorUserId: user.userId,
    ticketCreatedById: ticket.createdById,
    ticketAssignedToId: ticket.assignedToId ?? null,
    isCoordinatorOfOwner: coordinatorFlag,
    isCollaborator: collaboratorFlag,
    ownerHasNoCoordinator: noCoordinatorFlag,
  });

  const allowed = action === "tickets:assign"
    ? access.canAssign && access.canView
    : action === "tickets:collaborators"
      ? access.canAssign && access.canView
    : action === "tickets:update"
      ? (
        access.canInteract
        || (access.canView && (user.role === "ADMIN" || user.role === "ANALYST" || user.role === "COORDINATOR"))
      )
      : requiresInteract
        ? access.canInteract
        : access.canView;

  if (!allowed) {
    logger.warn(
      {
        action,
        ticketId: ticket.id,
        ticketOwnerId: ticket.createdById,
        ticketAssignedToId: ticket.assignedToId ?? null,
        actorUserId: user.userId,
        actorRole: user.role,
      },
      "Tentativa de acesso não autorizado ao chamado",
    );
  }
  return allowed;
}
