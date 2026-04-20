import { pgEnum, pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { chatMessagesTable } from "./chat";
import { directMessagesTable } from "./direct-messages";

export const chatAttachmentScopeEnum = pgEnum("chat_attachment_scope", ["GROUP", "DM"]);

export const chatAttachmentsTable = pgTable("chat_attachments", {
  id: serial("id").primaryKey(),
  scope: chatAttachmentScopeEnum("scope").notNull(),
  uploaderId: integer("uploader_id").notNull().references(() => usersTable.id),
  dmReceiverId: integer("dm_receiver_id").references(() => usersTable.id),
  chatMessageId: integer("chat_message_id").references(() => chatMessagesTable.id, { onDelete: "cascade" }),
  directMessageId: integer("direct_message_id").references(() => directMessagesTable.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertChatAttachmentSchema = createInsertSchema(chatAttachmentsTable).omit({ id: true, createdAt: true });
export type InsertChatAttachment = z.infer<typeof insertChatAttachmentSchema>;
export type ChatAttachment = typeof chatAttachmentsTable.$inferSelect;

