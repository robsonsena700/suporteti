import { pgTable, text, serial, timestamp, integer, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").notNull().references(() => usersTable.id),
  message: text("message").notNull(),
  replyToId: integer("reply_to_id").references((): AnyPgColumn => chatMessagesTable.id, { onDelete: "set null" }),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  editHistory: text("edit_history"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessagesTable).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
