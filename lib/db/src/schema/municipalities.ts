import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const municipalitiesTable = pgTable("municipalities", {
  ibgeCode: integer("ibge_code").primaryKey(),
  name: text("name").notNull(),
  nameNormalized: text("name_normalized").notNull(),
  uf: text("uf").notNull(),
  ufCode: integer("uf_code").notNull(),
  region: text("region").notNull(),
  regionCode: integer("region_code").notNull(),
  population: integer("population"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const municipalitiesSyncStateTable = pgTable("municipalities_sync_state", {
  id: integer("id").primaryKey(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  nextDueAt: timestamp("next_due_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMunicipalitySchema = createInsertSchema(municipalitiesTable);
export type InsertMunicipality = z.infer<typeof insertMunicipalitySchema>;
