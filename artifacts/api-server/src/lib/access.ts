import { db, userCoordinatorsTable, usersTable, ticketsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import type { JwtPayload } from "../middlewares/auth";
import { logger } from "./logger";

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
  if (user.role === "ADMIN" || user.role === "ANALYST") return true;

  if (user.role === "USER") {
    return ticket.createdById === user.userId && ticket.status === "OPEN";
  }

  if (user.role === "COORDINATOR") {
    if (ticket.createdById === user.userId) return true;
    const responsibleCoordinatorId = await getResponsibleCoordinatorIdForUser(ticket.createdById);
    return responsibleCoordinatorId === user.userId;
  }

  return false;
}

export async function enforceTicketAccess(
  user: JwtPayload,
  ticket: TicketRow,
  action: string,
): Promise<boolean> {
  const allowed = await canReadTicket(user, ticket);
  if (!allowed) {
    logger.warn(
      {
        action,
        ticketId: ticket.id,
        ticketOwnerId: ticket.createdById,
        actorUserId: user.userId,
        actorRole: user.role,
      },
      "Tentativa de acesso não autorizado ao chamado",
    );
  }
  return allowed;
}
