import { db, ticketsTable, ticketAuditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { JwtPayload } from "../middlewares/auth";
import { logger } from "./logger";
import { computeAutoAssignDecision } from "./ticket-auto-assign-decision";

export async function autoAssignTicketOnMessageInteraction(args: {
  actor: JwtPayload;
  ticketId: number;
  messageId: number;
  messagePreview: string;
}): Promise<{ reassigned: boolean; fromAssignedToId: number | null; toAssignedToId: number | null }> {
  const { actor, ticketId, messageId, messagePreview } = args;

  const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId));
  if (!ticket) return { reassigned: false, fromAssignedToId: null, toAssignedToId: null };

  const decision = computeAutoAssignDecision({
    actorRole: actor.role,
    actorUserId: actor.userId,
    currentAssignedToId: ticket.assignedToId ?? null,
    currentStatus: ticket.status,
  });

  await db.insert(ticketAuditLogsTable).values({
    ticketId,
    actorUserId: actor.userId,
    type: "MESSAGE_SENT",
    messageId,
    fromAssignedToId: ticket.assignedToId ?? null,
    toAssignedToId: ticket.assignedToId ?? null,
    detail: messagePreview,
  });

  if (!decision.shouldAssign || decision.nextAssignedToId == null) {
    return { reassigned: false, fromAssignedToId: ticket.assignedToId ?? null, toAssignedToId: ticket.assignedToId ?? null };
  }

  const patch: Record<string, unknown> = { assignedToId: decision.nextAssignedToId };
  if (decision.nextStatus) patch.status = decision.nextStatus;

  const [updated] = await db.update(ticketsTable).set(patch).where(eq(ticketsTable.id, ticketId)).returning();

  await db.insert(ticketAuditLogsTable).values({
    ticketId,
    actorUserId: actor.userId,
    type: "AUTO_ASSIGN",
    messageId,
    fromAssignedToId: ticket.assignedToId ?? null,
    toAssignedToId: decision.nextAssignedToId,
    detail: `Auto-atribuição após interação: ${messagePreview}`,
  });

  logger.info(
    {
      ticketId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      fromAssignedToId: ticket.assignedToId ?? null,
      toAssignedToId: decision.nextAssignedToId,
      nextStatus: updated?.status,
    },
    "Ticket reatribuído automaticamente após mensagem",
  );

  return { reassigned: true, fromAssignedToId: ticket.assignedToId ?? null, toAssignedToId: decision.nextAssignedToId };
}
