import type { Response } from "express";
import { logger } from "./logger";

type ChatRole = string;

export type ChatStreamEvent =
  | { type: "group_message"; payload: { id: number; senderId: number; senderName: string; senderRole: string; message: string; createdAt: string; replyTo: null | { id: number; senderId: number; message: string; createdAt: string; sender: { id: number; name: string; role: string } }; attachments: Array<{ id: number; filename: string; mimeType: string; size: number; uploaderId: number; createdAt: string }> } }
  | { type: "group_message_edited"; payload: { id: number; senderId: number; message: string; editedAt: string; editHistory: Array<{ message: string; editedAt: string }> } }
  | { type: "dm_message"; payload: { id: number; senderId: number; senderName: string; senderRole: string; receiverId: number; receiverName: string; receiverRole: string; message: string; createdAt: string; replyTo: null | { id: number; senderId: number; receiverId: number; message: string; createdAt: string; sender: { id: number; name: string; role: string } }; attachments: Array<{ id: number; filename: string; mimeType: string; size: number; uploaderId: number; createdAt: string }> } }
  | { type: "dm_message_edited"; payload: { id: number; senderId: number; receiverId: number; message: string; editedAt: string; editHistory: Array<{ message: string; editedAt: string }> } }
  | { type: "typing"; payload: { scope: "group"; senderId: number; senderName: string; senderRole: string; isTyping: boolean; at: string } }
  | { type: "typing"; payload: { scope: "dm"; senderId: number; senderName: string; senderRole: string; receiverId: number; isTyping: boolean; at: string } }
  | { type: "dm_read"; payload: { readerId: number; otherUserId: number; messageId: number; at: string } };

type Client = {
  clientId: string;
  userId: number;
  role: ChatRole;
  res: Response;
  heartbeatId: ReturnType<typeof setInterval>;
};

let nextClientId = 1;
let nextEventId = 1;
const clientsByUser = new Map<number, Map<string, Client>>();
const metrics = {
  group: { events: 0, avgLagMs: 0 },
  dm: { events: 0, avgLagMs: 0 },
};

function recordLag(kind: "group" | "dm", lagMs: number) {
  const m = metrics[kind];
  m.events += 1;
  m.avgLagMs = m.avgLagMs === 0 ? lagMs : (m.avgLagMs * 0.9 + lagMs * 0.1);
}

setInterval(() => {
  const groupEvents = metrics.group.events;
  const dmEvents = metrics.dm.events;
  if (groupEvents + dmEvents === 0) return;
  metrics.group.events = 0;
  metrics.dm.events = 0;
  logger.info(
    {
      chatStream: getChatStreamStats(),
      metrics: {
        group: { events: groupEvents, avgLagMs: Math.round(metrics.group.avgLagMs) },
        dm: { events: dmEvents, avgLagMs: Math.round(metrics.dm.avgLagMs) },
      },
    },
    "chat stream metrics",
  );
}, 60_000);

export function canReceiveGroupMessage(args: { receiverRole: string; receiverId: number; senderRole: string; senderId: number }): boolean {
  if (args.receiverRole === "ADMIN" || args.receiverRole === "ANALYST") return true;
  if (args.receiverRole !== "COORDINATOR") return false;
  if (args.receiverId === args.senderId) return true;
  return args.senderRole === "ADMIN" || args.senderRole === "ANALYST";
}

function writeEvent(res: Response, event: ChatStreamEvent["type"] | "hello" | "ping", data: unknown): void {
  const id = nextEventId++;
  res.write(`id: ${id}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function getUserClients(userId: number): Map<string, Client> {
  const existing = clientsByUser.get(userId);
  if (existing) return existing;
  const created = new Map<string, Client>();
  clientsByUser.set(userId, created);
  return created;
}

export function subscribeToChatStream(args: { userId: number; role: string; res: Response }): () => void {
  const clientId = String(nextClientId++);
  args.res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  (args.res as any).flushHeaders?.();

  const heartbeatId = setInterval(() => {
    try {
      writeEvent(args.res, "ping", { t: new Date().toISOString() });
    } catch {
      cleanup();
    }
  }, 25_000);

  const client: Client = { clientId, userId: args.userId, role: args.role, res: args.res, heartbeatId };
  getUserClients(args.userId).set(clientId, client);

  try {
    writeEvent(args.res, "hello", { serverTime: new Date().toISOString() });
  } catch {
    cleanup();
  }

  function cleanup() {
    clearInterval(heartbeatId);
    const map = clientsByUser.get(args.userId);
    map?.delete(clientId);
    if (map && map.size === 0) clientsByUser.delete(args.userId);
  }

  return cleanup;
}

function sendToUser(userId: number, event: ChatStreamEvent): void {
  const map = clientsByUser.get(userId);
  if (!map || map.size === 0) return;
  for (const c of map.values()) {
    try {
      writeEvent(c.res, event.type, event.payload);
    } catch {
      clearInterval(c.heartbeatId);
      map.delete(c.clientId);
    }
  }
  if (map.size === 0) clientsByUser.delete(userId);
}

export function emitGroupMessage(args: {
  senderId: number;
  senderName: string;
  senderRole: string;
  messageId: number;
  message: string;
  createdAt: Date;
  replyTo: null | { id: number; senderId: number; message: string; createdAt: Date; sender: { id: number; name: string; role: string } };
  attachments: Array<{ id: number; filename: string; mimeType: string; size: number; uploaderId: number; createdAt: Date }>;
}): void {
  recordLag("group", Date.now() - args.createdAt.getTime());
  const event: ChatStreamEvent = {
    type: "group_message",
    payload: {
      id: args.messageId,
      senderId: args.senderId,
      senderName: args.senderName,
      senderRole: args.senderRole,
      message: args.message,
      createdAt: args.createdAt.toISOString(),
      replyTo: args.replyTo
        ? {
          id: args.replyTo.id,
          senderId: args.replyTo.senderId,
          message: args.replyTo.message,
          createdAt: args.replyTo.createdAt.toISOString(),
          sender: args.replyTo.sender,
        }
        : null,
      attachments: (args.attachments ?? []).map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        uploaderId: a.uploaderId,
        createdAt: a.createdAt.toISOString(),
      })),
    },
  };

  for (const [userId, userClients] of clientsByUser.entries()) {
    for (const c of userClients.values()) {
      if (!canReceiveGroupMessage({ receiverRole: c.role, receiverId: c.userId, senderRole: args.senderRole, senderId: args.senderId })) continue;
      try {
        writeEvent(c.res, event.type, event.payload);
      } catch {
        clearInterval(c.heartbeatId);
        userClients.delete(c.clientId);
      }
    }
    if (userClients.size === 0) clientsByUser.delete(userId);
  }
}

export function emitGroupMessageEdited(args: {
  senderId: number;
  senderRole: string;
  senderName: string;
  messageId: number;
  message: string;
  editedAt: Date;
  editHistory: Array<{ message: string; editedAt: string }>;
}): void {
  recordLag("group", Date.now() - args.editedAt.getTime());
  const event: ChatStreamEvent = {
    type: "group_message_edited",
    payload: {
      id: args.messageId,
      senderId: args.senderId,
      message: args.message,
      editedAt: args.editedAt.toISOString(),
      editHistory: args.editHistory ?? [],
    },
  };
  for (const [userId, userClients] of clientsByUser.entries()) {
    for (const c of userClients.values()) {
      if (!canReceiveGroupMessage({ receiverRole: c.role, receiverId: c.userId, senderRole: args.senderRole, senderId: args.senderId })) continue;
      try {
        writeEvent(c.res, event.type, event.payload);
      } catch {
        clearInterval(c.heartbeatId);
        userClients.delete(c.clientId);
      }
    }
    if (userClients.size === 0) clientsByUser.delete(userId);
  }
}

export function emitDirectMessage(args: {
  messageId: number;
  message: string;
  createdAt: Date;
  senderId: number;
  senderName: string;
  senderRole: string;
  receiverId: number;
  receiverName: string;
  receiverRole: string;
  replyTo: null | { id: number; senderId: number; receiverId: number; message: string; createdAt: Date; sender: { id: number; name: string; role: string } };
  attachments: Array<{ id: number; filename: string; mimeType: string; size: number; uploaderId: number; createdAt: Date }>;
}): void {
  recordLag("dm", Date.now() - args.createdAt.getTime());
  const event: ChatStreamEvent = {
    type: "dm_message",
    payload: {
      id: args.messageId,
      senderId: args.senderId,
      senderName: args.senderName,
      senderRole: args.senderRole,
      receiverId: args.receiverId,
      receiverName: args.receiverName,
      receiverRole: args.receiverRole,
      message: args.message,
      createdAt: args.createdAt.toISOString(),
      replyTo: args.replyTo
        ? {
          id: args.replyTo.id,
          senderId: args.replyTo.senderId,
          receiverId: args.replyTo.receiverId,
          message: args.replyTo.message,
          createdAt: args.replyTo.createdAt.toISOString(),
          sender: args.replyTo.sender,
        }
        : null,
      attachments: (args.attachments ?? []).map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        uploaderId: a.uploaderId,
        createdAt: a.createdAt.toISOString(),
      })),
    },
  };
  sendToUser(args.senderId, event);
  sendToUser(args.receiverId, event);
}

export function emitDirectMessageEdited(args: { messageId: number; senderId: number; receiverId: number; editedAt: Date; message: string; editHistory: Array<{ message: string; editedAt: string }> }): void {
  recordLag("dm", Date.now() - args.editedAt.getTime());
  const event: ChatStreamEvent = {
    type: "dm_message_edited",
    payload: {
      id: args.messageId,
      senderId: args.senderId,
      receiverId: args.receiverId,
      message: args.message,
      editedAt: args.editedAt.toISOString(),
      editHistory: args.editHistory ?? [],
    },
  };
  sendToUser(args.senderId, event);
  sendToUser(args.receiverId, event);
}

export function emitTyping(args: {
  scope: "group" | "dm";
  senderId: number;
  senderName: string;
  senderRole: string;
  receiverId?: number;
  isTyping: boolean;
  at: Date;
}): void {
  const payloadBase = {
    senderId: args.senderId,
    senderName: args.senderName,
    senderRole: args.senderRole,
    isTyping: args.isTyping,
    at: args.at.toISOString(),
  };
  if (args.scope === "dm") {
    if (typeof args.receiverId !== "number") return;
    const event: ChatStreamEvent = {
      type: "typing",
      payload: { scope: "dm", ...payloadBase, receiverId: args.receiverId },
    };
    sendToUser(args.senderId, event);
    sendToUser(args.receiverId, event);
    return;
  }

  const event: ChatStreamEvent = {
    type: "typing",
    payload: { scope: "group", ...payloadBase },
  };
  for (const [userId, userClients] of clientsByUser.entries()) {
    for (const c of userClients.values()) {
      if (c.userId === args.senderId) continue;
      if (!canReceiveGroupMessage({ receiverRole: c.role, receiverId: c.userId, senderRole: args.senderRole, senderId: args.senderId })) continue;
      try {
        writeEvent(c.res, event.type, event.payload);
      } catch {
        clearInterval(c.heartbeatId);
        userClients.delete(c.clientId);
      }
    }
    if (userClients.size === 0) clientsByUser.delete(userId);
  }
}

export function emitDmRead(args: { readerId: number; otherUserId: number; messageId: number; at: Date }): void {
  const event: ChatStreamEvent = {
    type: "dm_read",
    payload: {
      readerId: args.readerId,
      otherUserId: args.otherUserId,
      messageId: args.messageId,
      at: args.at.toISOString(),
    },
  };
  sendToUser(args.readerId, event);
  sendToUser(args.otherUserId, event);
}

export function getChatStreamStats(): { connections: number; users: number } {
  let connections = 0;
  for (const m of clientsByUser.values()) connections += m.size;
  return { connections, users: clientsByUser.size };
}

export function logChatStreamStats(): void {
  const s = getChatStreamStats();
  logger.debug({ chatStream: s }, "chat stream stats");
}
