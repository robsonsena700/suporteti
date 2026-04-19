import { pgEnum, pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ticketsTable } from "./tickets";
import { usersTable } from "./users";
import { messagesTable } from "./messages";

export const ticketAuditTypeEnum = pgEnum("ticket_audit_type", [
  "MESSAGE_SENT",
  "AUTO_ASSIGN",
  "MANUAL_ASSIGN",
]);

export const ticketAuditLogsTable = pgTable("ticket_audit_logs", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  actorUserId: integer("actor_user_id").notNull().references(() => usersTable.id),
  type: ticketAuditTypeEnum("type").notNull(),
  messageId: integer("message_id").references(() => messagesTable.id, { onDelete: "set null" }),
  fromAssignedToId: integer("from_assigned_to_id").references(() => usersTable.id),
  toAssignedToId: integer("to_assigned_to_id").references(() => usersTable.id),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTicketAuditLogSchema = createInsertSchema(ticketAuditLogsTable).omit({ id: true, createdAt: true });
export type InsertTicketAuditLog = z.infer<typeof insertTicketAuditLogSchema>;
export type TicketAuditLog = typeof ticketAuditLogsTable.$inferSelect;

