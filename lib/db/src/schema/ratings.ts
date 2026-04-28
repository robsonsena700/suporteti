import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ticketsTable } from "./tickets";

export const ticketRatingsTable = pgTable("ticket_ratings", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }).unique(),
  rating: integer("rating").notNull(),
  reasonLowRating: text("reason_low_rating"),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTicketRatingSchema = createInsertSchema(ticketRatingsTable).omit({ id: true, createdAt: true });
export type InsertTicketRating = z.infer<typeof insertTicketRatingSchema>;
export type TicketRating = typeof ticketRatingsTable.$inferSelect;
