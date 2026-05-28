import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  purpose: text("purpose").notNull(),
  requestedByUserId: integer("requested_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  requestedIp: text("requested_ip"),
  requestedUserAgent: text("requested_user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedIp: text("used_ip"),
  usedUserAgent: text("used_user_agent"),
});

export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;
