import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const securityAuditLogsTable = pgTable("security_audit_logs", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  targetUserId: integer("target_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  targetEmail: text("target_email"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SecurityAuditLog = typeof securityAuditLogsTable.$inferSelect;
