import { pgTable, text, serial, timestamp, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", ["USER", "COORDINATOR", "ANALYST", "ADMIN"]);
export const userStatusEnum = pgEnum("user_status", ["PENDING", "ACTIVE", "INACTIVE"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("USER"),
  status: userStatusEnum("status").notNull().default("PENDING"),
  cpf: text("cpf").unique(),
  establishment: text("establishment"),
  contactPhone: text("contact_phone"),
  prefersWhatsapp: boolean("prefers_whatsapp").notNull().default(false),
  prefersTelegram: boolean("prefers_telegram").notNull().default(false),
  termsAccepted: boolean("terms_accepted").notNull().default(false),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  uf: text("uf").notNull(),
  municipality: text("municipality").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
