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
  // SHA-256 (hex) do conteudo do arquivo no momento do upload. Nullable porque
  // anexos enviados antes desta coluna existir nao tem o hash original; o
  // script de verificacao de integridade (uploads_guard.sh) preenche esses
  // casos retroativamente na primeira verificacao apos o deploy, usando o
  // conteudo atual em disco como base de confianca.
  contentSha256: text("content_sha256"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

