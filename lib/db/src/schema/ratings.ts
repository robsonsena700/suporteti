import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { ticketsTable } from "./tickets";

export const ratingsTable = pgTable("ratings", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }).unique(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  score: integer("score").notNull(),
  feedback: text("feedback"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRatingSchema = createInsertSchema(ratingsTable).omit({ id: true, createdAt: true });
export type InsertRating = z.infer<typeof insertRatingSchema>;
export type Rating = typeof ratingsTable.$inferSelect;
