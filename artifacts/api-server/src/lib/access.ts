import { db, userCoordinatorsTable, usersTable, ticketsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import type { JwtPayload } from "../middlewares/auth";
import { logger } from "./logger";
import { computeTicketAccess } from "./ticket-access-policy";

type TicketRow = typeof ticketsTable.$inferSelect;

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
    return computeTicketAccess({
      actorRole: user.role,
      actorUserId: user.userId,
      ticketCreatedById: ticket.createdById,
      ticketAssignedToId: ticket.assignedToId ?? null,
      isCoordinatorOfOwner: responsibleCoordinatorId === user.userId,
    }).canView;
  }

  return false;
}

export async function enforceTicketAccess(
  user: JwtPayload,
  ticket: TicketRow,
  action: string,
): Promise<boolean> {
  const coordinatorFlag = user.role === "COORDINATOR"
    ? (await getResponsibleCoordinatorIdForUser(ticket.createdById)) === user.userId
    : false;

  const access = computeTicketAccess({
    actorRole: user.role,
    actorUserId: user.userId,
    ticketCreatedById: ticket.createdById,
    ticketAssignedToId: ticket.assignedToId ?? null,
    isCoordinatorOfOwner: coordinatorFlag,
  });

  const requiresInteract =
    action === "messages:create"
    || action === "attachments:create"
    || action === "attachments:delete"
    || action === "tickets:update";

  const allowed = action === "tickets:assign"
    ? access.canAssign && access.canView
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
