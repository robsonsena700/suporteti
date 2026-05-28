import { relations } from "drizzle-orm";
import { usersTable } from "./users";
import { ticketsTable, ticketAttachmentsTable } from "./tickets";
import { messagesTable } from "./messages";
import { ticketRatingsTable } from "./ratings";
import { chatMessagesTable } from "./chat";
import { directMessagesTable } from "./direct-messages";
import { chatAttachmentsTable } from "./chat-attachments";
import { userCoordinatorsTable } from "./user-coordinators";
import { gestorCoordinatorsTable } from "./gestor-coordinators";
import { gestorAllowedUsersTable } from "./gestor-allowed-users";
import { ticketAuditLogsTable } from "./ticket-audit";
import { ticketCollaboratorsTable } from "./ticket-collaborators";
import { ticketMessageAttachmentsTable } from "./ticket-message-attachments";
import { passwordResetTokensTable } from "./password-reset-tokens";
import { securityAuditLogsTable } from "./security-audit-logs";
import { userPasswordHistoryTable } from "./user-password-history";

export const usersRelations = relations(usersTable, ({ many }) => ({
  createdTickets: many(ticketsTable, { relationName: "createdBy" }),
  assignedTickets: many(ticketsTable, { relationName: "assignedTo" }),
  messages: many(messagesTable),
  ticketAuditLogs: many(ticketAuditLogsTable),
  ticketCollaborations: many(ticketCollaboratorsTable, { relationName: "ticketCollaborator_user" }),
  addedCollaborations: many(ticketCollaboratorsTable, { relationName: "ticketCollaborator_addedBy" }),
  chatMessages: many(chatMessagesTable),
  chatAttachments: many(chatAttachmentsTable),
  sentDirectMessages: many(directMessagesTable, { relationName: "dmSender" }),
  receivedDirectMessages: many(directMessagesTable, { relationName: "dmReceiver" }),
  coordinatorsLinks: many(userCoordinatorsTable, { relationName: "userCoordinator_user" }),
  coordinatedUsersLinks: many(userCoordinatorsTable, { relationName: "userCoordinator_coordinator" }),
  gestorCoordinatorLinks: many(gestorCoordinatorsTable, { relationName: "gestorCoordinator_gestor" }),
  coordinatedGestorsLinks: many(gestorCoordinatorsTable, { relationName: "gestorCoordinator_coordinator" }),
  gestorAllowedUsersLinks: many(gestorAllowedUsersTable, { relationName: "gestorAllowed_gestor" }),
  allowedByGestorsLinks: many(gestorAllowedUsersTable, { relationName: "gestorAllowed_user" }),
  passwordResetTokens: many(passwordResetTokensTable),
  securityAuditLogs: many(securityAuditLogsTable),
  passwordHistory: many(userPasswordHistoryTable),
}));

export const userCoordinatorsRelations = relations(userCoordinatorsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [userCoordinatorsTable.userId],
    references: [usersTable.id],
    relationName: "userCoordinator_user",
  }),
  coordinator: one(usersTable, {
    fields: [userCoordinatorsTable.coordinatorId],
    references: [usersTable.id],
    relationName: "userCoordinator_coordinator",
  }),
}));

export const gestorCoordinatorsRelations = relations(gestorCoordinatorsTable, ({ one }) => ({
  gestor: one(usersTable, {
    fields: [gestorCoordinatorsTable.gestorId],
    references: [usersTable.id],
    relationName: "gestorCoordinator_gestor",
  }),
  coordinator: one(usersTable, {
    fields: [gestorCoordinatorsTable.coordinatorId],
    references: [usersTable.id],
    relationName: "gestorCoordinator_coordinator",
  }),
}));

export const gestorAllowedUsersRelations = relations(gestorAllowedUsersTable, ({ one }) => ({
  gestor: one(usersTable, {
    fields: [gestorAllowedUsersTable.gestorId],
    references: [usersTable.id],
    relationName: "gestorAllowed_gestor",
  }),
  user: one(usersTable, {
    fields: [gestorAllowedUsersTable.userId],
    references: [usersTable.id],
    relationName: "gestorAllowed_user",
  }),
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

export const chatAttachmentsRelations = relations(chatAttachmentsTable, ({ one }) => ({
  uploader: one(usersTable, {
    fields: [chatAttachmentsTable.uploaderId],
    references: [usersTable.id],
  }),
  dmReceiver: one(usersTable, {
    fields: [chatAttachmentsTable.dmReceiverId],
    references: [usersTable.id],
  }),
  chatMessage: one(chatMessagesTable, {
    fields: [chatAttachmentsTable.chatMessageId],
    references: [chatMessagesTable.id],
  }),
  directMessage: one(directMessagesTable, {
    fields: [chatAttachmentsTable.directMessageId],
    references: [directMessagesTable.id],
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
  rating: one(ticketRatingsTable, {
    fields: [ticketsTable.id],
    references: [ticketRatingsTable.ticketId],
  }),
  attachments: many(ticketAttachmentsTable),
  auditLogs: many(ticketAuditLogsTable),
  collaborators: many(ticketCollaboratorsTable),
}));

export const ticketCollaboratorsRelations = relations(ticketCollaboratorsTable, ({ one }) => ({
  ticket: one(ticketsTable, {
    fields: [ticketCollaboratorsTable.ticketId],
    references: [ticketsTable.id],
  }),
  user: one(usersTable, {
    fields: [ticketCollaboratorsTable.userId],
    references: [usersTable.id],
    relationName: "ticketCollaborator_user",
  }),
  addedBy: one(usersTable, {
    fields: [ticketCollaboratorsTable.addedByUserId],
    references: [usersTable.id],
    relationName: "ticketCollaborator_addedBy",
  }),
}));

export const ticketAttachmentsRelations = relations(ticketAttachmentsTable, ({ one }) => ({
  ticket: one(ticketsTable, {
    fields: [ticketAttachmentsTable.ticketId],
    references: [ticketsTable.id],
  }),
}));

export const messagesRelations = relations(messagesTable, ({ one, many }) => ({
  ticket: one(ticketsTable, {
    fields: [messagesTable.ticketId],
    references: [ticketsTable.id],
  }),
  sender: one(usersTable, {
    fields: [messagesTable.senderId],
    references: [usersTable.id],
  }),
  attachments: many(ticketMessageAttachmentsTable),
}));

export const ticketMessageAttachmentsRelations = relations(ticketMessageAttachmentsTable, ({ one }) => ({
  message: one(messagesTable, {
    fields: [ticketMessageAttachmentsTable.messageId],
    references: [messagesTable.id],
  }),
  ticket: one(ticketsTable, {
    fields: [ticketMessageAttachmentsTable.ticketId],
    references: [ticketsTable.id],
  }),
}));

export const ticketRatingsRelations = relations(ticketRatingsTable, ({ one }) => ({
  ticket: one(ticketsTable, {
    fields: [ticketRatingsTable.ticketId],
    references: [ticketsTable.id],
  }),
}));
