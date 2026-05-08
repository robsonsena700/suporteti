import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { messagesTable } from "./messages";
import { ticketsTable } from "./tickets";

export const ticketMessageAttachmentsTable = pgTable("ticket_message_attachments", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().references(() => messagesTable.id, { onDelete: "cascade" }),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  storagePath: text("storage_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

