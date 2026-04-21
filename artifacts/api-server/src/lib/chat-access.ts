import { db, usersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import type { JwtPayload } from "../middlewares/auth";
import { logger } from "./logger";
import {
  canCoordinatorAccessTargetRole,
  hasChatModuleAccess,
  hasFullChatAccess,
} from "./chat-permissions";

type ChatUser = {
  id: number;
  role: string;
  status: string;
};

export async function getVisibleParticipantIds(actor: JwtPayload): Promise<number[]> {
  if (hasFullChatAccess(actor.role)) {
    const rows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        eq(usersTable.status, "ACTIVE"),
        inArray(usersTable.role, ["ADMIN", "ANALYST", "COORDINATOR"] as any[]),
      ));
    return rows.map(row => row.id);
  }

  if (actor.role !== "COORDINATOR") return [];

  const staff = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.status, "ACTIVE"),
      inArray(usersTable.role, ["ADMIN", "ANALYST"] as any[]),
    ));

  const ids = new Set<number>([actor.userId]);
  staff.forEach(s => ids.add(s.id));
  return Array.from(ids);
}

export async function getVisibleParticipants(actor: JwtPayload) {
  const ids = await getVisibleParticipantIds(actor);
  if (ids.length === 0) return [];
  return db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      role: usersTable.role,
      uf: usersTable.uf,
      municipality: usersTable.municipality,
    })
    .from(usersTable)
    .where(and(eq(usersTable.status, "ACTIVE"), inArray(usersTable.id, ids)));
}

export async function canInteractWithChatUser(actor: JwtPayload, targetUserId: number): Promise<boolean> {
  if (!hasChatModuleAccess(actor.role)) return false;

  const [target] = await db
    .select({ id: usersTable.id, role: usersTable.role, status: usersTable.status })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));
  if (!target || target.status !== "ACTIVE") return false;
  if (target.role === "USER") return false;

  if (hasFullChatAccess(actor.role)) return true;
  if (actor.role !== "COORDINATOR") return false;

  return canCoordinatorAccessTargetRole(target.role);
}

export function enforceChatModuleAccess(actor: JwtPayload, action: string): boolean {
  const allowed = hasChatModuleAccess(actor.role);
  if (!allowed) {
    logger.warn(
      { action, actorUserId: actor.userId, actorRole: actor.role },
      "Tentativa de acesso não autorizado ao módulo de chat",
    );
  }
  return allowed;
}

export function auditChatDenied(actor: JwtPayload, action: string, details?: Record<string, unknown>): void {
  logger.warn(
    { action, actorUserId: actor.userId, actorRole: actor.role, ...details },
    "Tentativa de acesso não autorizado no chat",
  );
}
