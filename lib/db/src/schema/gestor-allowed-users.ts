import { pgTable, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const gestorAllowedUsersTable = pgTable(
  "gestor_allowed_users",
  {
    gestorId: integer("gestor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    pk: primaryKey({ columns: [table.gestorId, table.userId] }),
  }),
);
