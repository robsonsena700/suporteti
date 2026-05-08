import { pgTable, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const gestorCoordinatorsTable = pgTable(
  "gestor_coordinators",
  {
    gestorId: integer("gestor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    coordinatorId: integer("coordinator_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => ({
    pk: primaryKey({ columns: [table.gestorId] }),
  }),
);
