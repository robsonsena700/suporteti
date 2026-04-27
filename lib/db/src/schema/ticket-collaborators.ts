import { integer, pgTable, primaryKey, timestamp } from "drizzle-orm/pg-core";
import { ticketsTable } from "./tickets";
import { usersTable } from "./users";

export const ticketCollaboratorsTable = pgTable(
  "ticket_collaborators",
  {
    ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    addedByUserId: integer("added_by_user_id").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    pk: primaryKey({ columns: [table.ticketId, table.userId] }),
  }),
);
