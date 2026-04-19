import { relations } from "drizzle-orm";
import { usersTable } from "./users";
import { ticketsTable, ticketAttachmentsTable } from "./tickets";
import { messagesTable } from "./messages";
import { ratingsTable } from "./ratings";
import { chatMessagesTable } from "./chat";
import { directMessagesTable } from "./direct-messages";

export const usersRelations = relations(usersTable, ({ many }) => ({
  createdTickets: many(ticketsTable, { relationName: "createdBy" }),
  assignedTickets: many(ticketsTable, { relationName: "assignedTo" }),
  messages: many(messagesTable),
  ratings: many(ratingsTable),
  chatMessages: many(chatMessagesTable),
  sentDirectMessages: many(directMessagesTable, { relationName: "dmSender" }),
  receivedDirectMessages: many(directMessagesTable, { relationName: "dmReceiver" }),
}));

export const directMessagesRelations = relations(directMessagesTable, ({ one }) => ({
  sender: one(usersTable, {
    fields: [directMessagesTable.senderId],
    references: [usersTable.id],
    relationName: "dmSender",
  }),
  receiver: one(usersTable, {
    fields: [directMessagesTable.receiverId],
    references: [usersTable.id],
    relationName: "dmReceiver",
  }),
}));

export const chatMessagesRelations = relations(chatMessagesTable, ({ one }) => ({
  sender: one(usersTable, {
    fields: [chatMessagesTable.senderId],
    references: [usersTable.id],
  }),
}));

export const ticketsRelations = relations(ticketsTable, ({ one, many }) => ({
  createdBy: one(usersTable, {
    fields: [ticketsTable.createdById],
    references: [usersTable.id],
    relationName: "createdBy",
  }),
  assignedTo: one(usersTable, {
    fields: [ticketsTable.assignedToId],
    references: [usersTable.id],
    relationName: "assignedTo",
  }),
  messages: many(messagesTable),
  rating: one(ratingsTable, {
    fields: [ticketsTable.id],
    references: [ratingsTable.ticketId],
  }),
  attachments: many(ticketAttachmentsTable),
}));

export const ticketAttachmentsRelations = relations(ticketAttachmentsTable, ({ one }) => ({
  ticket: one(ticketsTable, {
    fields: [ticketAttachmentsTable.ticketId],
    references: [ticketsTable.id],
  }),
}));

export const messagesRelations = relations(messagesTable, ({ one }) => ({
  ticket: one(ticketsTable, {
    fields: [messagesTable.ticketId],
    references: [ticketsTable.id],
  }),
  sender: one(usersTable, {
    fields: [messagesTable.senderId],
    references: [usersTable.id],
  }),
}));

export const ratingsRelations = relations(ratingsTable, ({ one }) => ({
  ticket: one(ticketsTable, {
    fields: [ratingsTable.ticketId],
    references: [ticketsTable.id],
  }),
  user: one(usersTable, {
    fields: [ratingsTable.userId],
    references: [usersTable.id],
  }),
}));
