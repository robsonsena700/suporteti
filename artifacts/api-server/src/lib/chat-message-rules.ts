export function getEditWindow(args: { createdAt: Date; now?: Date; windowMs?: number }): { canEdit: boolean; remainingMs: number } {
  const now = args.now ?? new Date();
  const windowMs = args.windowMs ?? 2 * 60 * 1000;
  const remainingMs = args.createdAt.getTime() + windowMs - now.getTime();
  return { canEdit: remainingMs > 0, remainingMs: Math.max(0, remainingMs) };
}

export type EditHistoryEntry = { message: string; editedAt: string };

export function appendEditHistory(args: { existingJson: string | null | undefined; previousMessage: string; now: Date }): { history: EditHistoryEntry[]; json: string } {
  let history: EditHistoryEntry[] = [];
  if (args.existingJson) {
    try {
      const parsed = JSON.parse(args.existingJson);
      if (Array.isArray(parsed)) {
        history = parsed.filter((v) => v && typeof v.message === "string" && typeof v.editedAt === "string");
      }
    } catch {
      history = [];
    }
  }
  history.push({ message: args.previousMessage, editedAt: args.now.toISOString() });
  return { history, json: JSON.stringify(history) };
}

