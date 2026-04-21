import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.resolve(__dirname, "../../artifacts/api-server/src/lib/chat-message-rules.ts");
const rules = await import(pathToFileURL(rulesPath).href);
const realtimePath = path.resolve(__dirname, "../../artifacts/api-server/src/lib/chat-realtime.ts");
const realtime = await import(pathToFileURL(realtimePath).href);

const { getEditWindow, appendEditHistory } = rules as {
  getEditWindow: (args: { createdAt: Date; now?: Date; windowMs?: number }) => { canEdit: boolean; remainingMs: number };
  appendEditHistory: (args: { existingJson: string | null | undefined; previousMessage: string; now: Date }) => { history: Array<{ message: string; editedAt: string }>; json: string };
};

const { canReceiveGroupMessage } = realtime as {
  canReceiveGroupMessage: (args: { receiverRole: string; receiverId: number; senderRole: string; senderId: number }) => boolean;
};

{
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const now = new Date("2026-01-01T00:01:00.000Z");
  const w = getEditWindow({ createdAt, now });
  assert.equal(w.canEdit, true);
  assert.ok(w.remainingMs > 0);
}

{
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const now = new Date("2026-01-01T00:02:01.000Z");
  const w = getEditWindow({ createdAt, now });
  assert.equal(w.canEdit, false);
  assert.equal(w.remainingMs, 0);
}

{
  const now = new Date("2026-01-01T00:00:00.000Z");
  const r = appendEditHistory({ existingJson: null, previousMessage: "old", now });
  assert.equal(Array.isArray(r.history), true);
  assert.equal(r.history.length, 1);
  assert.equal(r.history[0].message, "old");
  assert.equal(typeof r.history[0].editedAt, "string");
  assert.equal(typeof r.json, "string");
}

{
  const now = new Date("2026-01-01T00:00:00.000Z");
  const existing = JSON.stringify([{ message: "v1", editedAt: "2025-01-01T00:00:00.000Z" }]);
  const r = appendEditHistory({ existingJson: existing, previousMessage: "v2", now });
  assert.equal(r.history.length, 2);
  assert.equal(r.history[0].message, "v1");
  assert.equal(r.history[1].message, "v2");
}

{
  const now = new Date("2026-01-01T00:00:00.000Z");
  const r = appendEditHistory({ existingJson: "not-json", previousMessage: "x", now });
  assert.equal(r.history.length, 1);
  assert.equal(r.history[0].message, "x");
}

{
  assert.equal(
    canReceiveGroupMessage({ receiverRole: "ADMIN", receiverId: 1, senderRole: "COORDINATOR", senderId: 2 }),
    true,
  );
  assert.equal(
    canReceiveGroupMessage({ receiverRole: "ANALYST", receiverId: 1, senderRole: "COORDINATOR", senderId: 2 }),
    true,
  );
  assert.equal(
    canReceiveGroupMessage({ receiverRole: "COORDINATOR", receiverId: 10, senderRole: "ADMIN", senderId: 2 }),
    true,
  );
  assert.equal(
    canReceiveGroupMessage({ receiverRole: "COORDINATOR", receiverId: 10, senderRole: "ANALYST", senderId: 2 }),
    true,
  );
  assert.equal(
    canReceiveGroupMessage({ receiverRole: "COORDINATOR", receiverId: 10, senderRole: "COORDINATOR", senderId: 11 }),
    false,
  );
  assert.equal(
    canReceiveGroupMessage({ receiverRole: "COORDINATOR", receiverId: 10, senderRole: "COORDINATOR", senderId: 10 }),
    true,
  );
}

console.log("Teste unitário de regras de mensagens do chat concluído com sucesso.");
