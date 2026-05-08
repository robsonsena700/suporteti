import { db, userCoordinatorsTable, usersTable, ticketsTable, ticketCollaboratorsTable, gestorAllowedUsersTable, gestorCoordinatorsTable } from "@workspace/db";
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

export async function getMunicipalityUserIdsForCoordinator(coordinatorId: number): Promise<number[]> {
  const [coordinator] = await db
    .select({ uf: usersTable.uf, municipality: usersTable.municipality })
    .from(usersTable)
    .where(eq(usersTable.id, coordinatorId));

  const uf = coordinator?.uf;
  const municipality = coordinator?.municipality;
  if (!uf || !municipality) return [];

  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.status, "ACTIVE" as any),
      eq(usersTable.role, "USER" as any),
      eq(usersTable.uf, uf),
      eq(usersTable.municipality, municipality),
    ));

  return rows.map(r => r.id);
}

export async function getVisibleOwnerIdsForCoordinator(coordinatorId: number): Promise<number[]> {
  const managedUserIds = await getManagedUserIdsByCoordinator(coordinatorId);
  const municipalityUserIds = await getMunicipalityUserIdsForCoordinator(coordinatorId);
  return Array.from(new Set([coordinatorId, ...managedUserIds, ...municipalityUserIds]));
}

export async function getCoordinatorIdForGestor(gestorId: number): Promise<number | null> {
  const [link] = await db
    .select({ coordinatorId: gestorCoordinatorsTable.coordinatorId })
    .from(gestorCoordinatorsTable)
    .where(eq(gestorCoordinatorsTable.gestorId, gestorId));
  return link?.coordinatorId ?? null;
}

export async function getAllowedUserIdsForGestor(gestorId: number): Promise<number[]> {
  const links = await db
    .select({ userId: gestorAllowedUsersTable.userId })
    .from(gestorAllowedUsersTable)
    .where(eq(gestorAllowedUsersTable.gestorId, gestorId));
  return links.map((l) => l.userId);
}

export async function getVisibleOwnerIdsForGestor(gestorId: number): Promise<{ coordinatorId: number | null; ownerIds: number[] }> {
  const coordinatorId = await getCoordinatorIdForGestor(gestorId);
  if (coordinatorId == null) return { coordinatorId: null, ownerIds: [] };
  const allowedUserIds = await getAllowedUserIdsForGestor(gestorId);
  const coordinatorOwnerIds = await getVisibleOwnerIdsForCoordinator(coordinatorId);
  const ownerIds = Array.from(new Set([gestorId, ...coordinatorOwnerIds, ...allowedUserIds]));
  return { coordinatorId, ownerIds };
}

async function isCoordinatorOfOwnerViaMunicipality(args: { coordinatorId: number; ownerUserId: number }): Promise<boolean> {
  const [coordinator] = await db
    .select({ uf: usersTable.uf, municipality: usersTable.municipality })
    .from(usersTable)
    .where(eq(usersTable.id, args.coordinatorId));
  if (!coordinator?.uf || !coordinator?.municipality) return false;

  const [owner] = await db
    .select({ uf: usersTable.uf, municipality: usersTable.municipality, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, args.ownerUserId));
  if (!owner) return false;
  if (String(owner.role).toUpperCase() !== "USER") return false;

  return owner.uf === coordinator.uf && owner.municipality === coordinator.municipality;
}

async function canGestorViewTicket(user: JwtPayload, ticket: TicketRow): Promise<boolean> {
  const { coordinatorId, ownerIds } = await getVisibleOwnerIdsForGestor(user.userId);
  if (coordinatorId == null) return false;
  if (ownerIds.includes(ticket.createdById)) return true;
  if (ticket.assignedToId === coordinatorId) return true;
  const [row] = await db
    .select({ ticketId: ticketCollaboratorsTable.ticketId })
    .from(ticketCollaboratorsTable)
    .where(and(eq(ticketCollaboratorsTable.ticketId, ticket.id), eq(ticketCollaboratorsTable.userId, coordinatorId)));
  return Boolean(row?.ticketId);
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
    const municipalityFlag = await isCoordinatorOfOwnerViaMunicipality({ coordinatorId: user.userId, ownerUserId: ticket.createdById });
    const viaCoordinator = computeTicketAccess({
      actorRole: user.role,
      actorUserId: user.userId,
      ticketCreatedById: ticket.createdById,
      ticketAssignedToId: ticket.assignedToId ?? null,
      isCoordinatorOfOwner: responsibleCoordinatorId === user.userId || municipalityFlag,
    }).canView;
    if (viaCoordinator) return true;
  }
  if (user.role === "GESTOR") {
    if (await canGestorViewTicket(user, ticket)) return true;
  }

  if (user.role === "USER") return false;
  return isTicketCollaborator(user.userId, ticket.id);
}

export async function enforceTicketAccess(
  user: JwtPayload,
  ticket: TicketRow,
  action: string,
): Promise<boolean> {
  const coordinatorFlag = user.role === "COORDINATOR"
    ? (
      (await getResponsibleCoordinatorIdForUser(ticket.createdById)) === user.userId
      || (await isCoordinatorOfOwnerViaMunicipality({ coordinatorId: user.userId, ownerUserId: ticket.createdById }))
    )
    : user.role === "GESTOR"
      ? await canGestorViewTicket(user, ticket)
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
        || (access.canView && (user.role === "ADMIN" || user.role === "ANALYST" || user.role === "COORDINATOR" || user.role === "GESTOR"))
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
