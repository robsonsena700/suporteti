import {
  useState,
  useEffect,
  useRef,
  useCallback,
  KeyboardEvent,
} from "react";
import type { EmojiClickData } from "emoji-picker-react";
import { Suspense, lazy } from "react";
import { useAuth } from "@/lib/auth";
import { useChatNotifications } from "@/lib/chat-notifications";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { Button } from "@/components/ui/button";
import { Send, Users, Smile, BellOff, Bell, X, Lock, ArrowLeft, Paperclip, Download, Trash2, FileText, FileImage, Music, Eye, EyeOff, Reply, Pencil } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { UserAvatar } from "@/components/user/user-avatar";
import { getRoleLabel } from "@/lib/role-labels";

const EmojiPicker = lazy(() => import("emoji-picker-react"));

const CHAT_STATE_STORAGE_KEY = "suporte-ti:chat:state:v1";
const CHAT_MESSAGES_CACHE_KEY = "suporte-ti:chat:messages-cache:v1";

type PersistedConversation =
  | { type: "group" }
  | { type: "dm"; participantId: number };

type PersistedChatState = {
  actorUserId: number;
  conversation: PersistedConversation;
  scrollTop: number | null;
  focusedMessageId: number | null;
  draftMessage: string;
  savedAt: number;
};

function isPersistedDmConversation(conv: PersistedConversation): conv is Extract<PersistedConversation, { type: "dm" }> {
  return conv.type === "dm";
}

function loadChatState(actorUserId: number | null | undefined): PersistedChatState | null {
  if (typeof window === "undefined") return null;
  if (!actorUserId) return null;
  try {
    const raw = window.localStorage.getItem(CHAT_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedChatState>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.actorUserId !== actorUserId) return null;
    if (!parsed.conversation || typeof parsed.conversation !== "object") return null;
    if (parsed.conversation.type !== "group" && parsed.conversation.type !== "dm") return null;
    if (parsed.scrollTop != null && typeof parsed.scrollTop !== "number") return null;
    if (parsed.focusedMessageId != null && typeof parsed.focusedMessageId !== "number") return null;
    if (parsed.draftMessage != null && typeof parsed.draftMessage !== "string") return null;
    if (parsed.savedAt != null && typeof parsed.savedAt !== "number") return null;
    return {
      actorUserId: parsed.actorUserId as number,
      conversation: parsed.conversation as PersistedConversation,
      scrollTop: (parsed.scrollTop ?? null) as number | null,
      focusedMessageId: (parsed.focusedMessageId ?? null) as number | null,
      draftMessage: (parsed.draftMessage ?? "") as string,
      savedAt: (parsed.savedAt ?? Date.now()) as number,
    };
  } catch {
    return null;
  }
}

function saveChatState(next: PersistedChatState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAT_STATE_STORAGE_KEY, JSON.stringify(next));
  } catch {
  }
}

type CachedMessages = {
  savedAt: number;
  group: GroupMsg[] | null;
  dms: Record<number, DM[]>;
};

function loadCachedMessages(actorUserId: number | null | undefined): CachedMessages | null {
  if (typeof window === "undefined") return null;
  if (!actorUserId) return null;
  try {
    const raw = window.localStorage.getItem(CHAT_MESSAGES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedMessages & { actorUserId?: number };
    if (!parsed || typeof parsed !== "object") return null;
    if ((parsed as any).actorUserId && (parsed as any).actorUserId !== actorUserId) return null;
    if (!parsed.savedAt || typeof parsed.savedAt !== "number") return null;
    if (!("group" in parsed) || !("dms" in parsed)) return null;
    if (parsed.dms && typeof parsed.dms !== "object") return null;
    return { savedAt: parsed.savedAt, group: parsed.group ?? null, dms: parsed.dms ?? {} };
  } catch {
    return null;
  }
}

function saveCachedMessages(actorUserId: number, next: Omit<CachedMessages, "savedAt">): void {
  if (typeof window === "undefined") return;
  const value: CachedMessages & { actorUserId: number } = {
    actorUserId,
    savedAt: Date.now(),
    group: next.group,
    dms: next.dms,
  };
  try {
    window.localStorage.setItem(CHAT_MESSAGES_CACHE_KEY, JSON.stringify(value));
  } catch {
  }
}

function debounce<T extends (...args: any[]) => void>(fn: T, waitMs: number): T {
  let t: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), waitMs);
  }) as T;
}

function throttle<T extends (...args: any[]) => void>(fn: T, waitMs: number): T {
  let last = 0;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: any[] | null = null;
  return ((...args: any[]) => {
    const now = Date.now();
    const remaining = waitMs - (now - last);
    lastArgs = args;
    if (remaining <= 0) {
      if (trailing) clearTimeout(trailing);
      trailing = null;
      last = now;
      fn(...args);
      return;
    }
    if (trailing) return;
    trailing = setTimeout(() => {
      trailing = null;
      last = Date.now();
      if (lastArgs) fn(...lastArgs);
      lastArgs = null;
    }, remaining);
  }) as T;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface GroupMsg {
  id: number;
  senderId: number;
  message: string;
  replyTo: ReplyRef | null;
  editedAt?: string | null;
  editHistory?: Array<{ message: string; editedAt: string }>;
  createdAt: string;
  sender: { id: number; name: string; role: string };
  attachments: ChatAttachment[];
}

interface DM {
  id: number;
  senderId: number;
  receiverId: number;
  message: string;
  replyTo: ReplyRef | null;
  editedAt?: string | null;
  editHistory?: Array<{ message: string; editedAt: string }>;
  createdAt: string;
  sender: { id: number; name: string; role: string };
  receiver: { id: number; name: string; role: string };
  attachments: ChatAttachment[];
}

interface ReplyRef {
  id: number;
  senderId: number;
  message: string;
  createdAt: string;
  sender: { id: number; name: string; role: string };
}

interface ChatAttachment {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
  uploaderId: number;
  createdAt: string;
}

type AttachmentPreviewState = {
  open: boolean;
  loading: boolean;
  url: string | null;
  error: string | null;
};

interface Participant {
  id: number;
  name: string;
  role: string;
  uf: string;
  municipality: string;
}

interface DMPreview {
  partnerId: number;
  partnerName: string;
  partnerRole: string;
  lastMessage: string;
  lastMessageAt: string;
  fromMe: boolean;
}

type Conversation =
  | { type: "group" }
  | { type: "dm"; participant: Participant };

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  ADMIN: getRoleLabel("ADMIN"),
  COORDINATOR: getRoleLabel("COORDINATOR"),
  ANALYST: getRoleLabel("ANALYST"),
  GESTOR: getRoleLabel("GESTOR"),
  USER: getRoleLabel("USER"),
};

const ROLE_COLOR: Record<string, string> = {
  ADMIN: "#e11d48",
  COORDINATOR: "#7c3aed",
  ANALYST: "#0284c7",
  GESTOR: "#0f766e",
};

const ROLE_PILL: Record<string, string> = {
  ADMIN: "bg-rose-100 text-rose-700",
  COORDINATOR: "bg-violet-100 text-violet-700",
  ANALYST: "bg-sky-100 text-sky-700",
  GESTOR: "bg-emerald-100 text-emerald-700",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (same(d, today)) return "Hoje";
  if (same(d, yesterday)) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatPreviewTime(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const same = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (same(d, today)) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function fetchGroupMessages(afterId?: number): Promise<GroupMsg[]> {
  const qs = afterId && afterId > 0 ? `&afterId=${encodeURIComponent(String(afterId))}` : "";
  return customFetch<GroupMsg[]>(`/api/chat/messages?limit=200${qs}`);
}

async function fetchDMs(userId: number, afterId?: number): Promise<DM[]> {
  const qs = afterId && afterId > 0 ? `?afterId=${encodeURIComponent(String(afterId))}` : "";
  return customFetch<DM[]>(`/api/chat/dm/${userId}${qs}`);
}

async function fetchParticipants(): Promise<Participant[]> {
  return customFetch<Participant[]>("/api/chat/participants");
}

async function postGroupMessage(message: string, attachmentIds: number[], replyToId: number | null): Promise<GroupMsg> {
  return customFetch<GroupMsg>("/api/chat/messages", {
    method: "POST",
    body: JSON.stringify({ message, attachmentIds, replyToId }),
  });
}

async function postDM(userId: number, message: string, attachmentIds: number[], replyToId: number | null): Promise<DM> {
  return customFetch<DM>(`/api/chat/dm/${userId}`, {
    method: "POST",
    body: JSON.stringify({ message, attachmentIds, replyToId }),
  });
}

async function patchGroupMessage(messageId: number, message: string): Promise<GroupMsg> {
  return customFetch<GroupMsg>(`/api/chat/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ message }),
  });
}

async function patchDMMessage(messageId: number, message: string): Promise<DM> {
  return customFetch<DM>(`/api/chat/dm/message/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ message }),
  });
}

// ── Message bubble (generic) ───────────────────────────────────────────────────

function MessageBubble({
  isOwn,
  highlighted,
  senderId,
  senderName,
  senderRole,
  message,
  replyTo,
  editedAt,
  editHistory,
  createdAt,
  showSender,
  attachments,
  onDownloadAttachment,
  onDeleteAttachment,
  canDeleteAttachment,
  isDeletingAttachment,
  getPreviewState,
  onTogglePreview,
  onReply,
  onJumpToReply,
  canEdit,
  editRemainingLabel,
  onEdit,
  showEditHistory,
  onToggleEditHistory,
}: {
  isOwn: boolean;
  highlighted: boolean;
  senderId: number;
  senderName: string;
  senderRole: string;
  message: string;
  replyTo: ReplyRef | null;
  editedAt?: string | null;
  editHistory?: Array<{ message: string; editedAt: string }>;
  createdAt: string;
  showSender: boolean;
  attachments: ChatAttachment[];
  onDownloadAttachment: (att: ChatAttachment) => void;
  onDeleteAttachment: (att: ChatAttachment) => void;
  canDeleteAttachment: (att: ChatAttachment) => boolean;
  isDeletingAttachment: (att: ChatAttachment) => boolean;
  getPreviewState: (id: number) => AttachmentPreviewState | undefined;
  onTogglePreview: (att: ChatAttachment) => void;
  onReply: () => void;
  onJumpToReply: (() => void) | null;
  canEdit: boolean;
  editRemainingLabel: string | null;
  onEdit: () => void;
  showEditHistory: boolean;
  onToggleEditHistory: () => void;
}) {
  return (
    <div className={cn("flex items-end gap-2 mb-1.5", isOwn ? "flex-row-reverse" : "flex-row")}>
      {!isOwn && <UserAvatar userId={senderId} name={senderName} className="h-8 w-8" />}
      {isOwn && <div className="w-8 shrink-0" />}

      <div
        className={cn(
          "relative max-w-[65%] rounded-2xl px-3 py-2 shadow-sm",
          highlighted ? "ring-2 ring-primary/50 ring-offset-2 ring-offset-transparent" : "",
          isOwn
            ? "bg-[#d9fdd3] dark:bg-[#005c4b] rounded-br-sm text-gray-800 dark:text-white"
            : "bg-white dark:bg-[#202c33] rounded-bl-sm text-gray-800 dark:text-white"
        )}
      >
        {showSender && !isOwn && (
          <p className="text-[11px] font-semibold mb-0.5" style={{ color: ROLE_COLOR[senderRole] ?? "#1B3B6E" }}>
            {senderName}
            <span className="ml-1.5 font-normal text-[10px] text-gray-400">
              ({ROLE_LABELS[senderRole] ?? senderRole})
            </span>
          </p>
        )}
        {replyTo ? (
          <button
            type="button"
            onClick={onJumpToReply ?? undefined}
            className={cn(
              "mb-2 w-full text-left rounded-lg border-l-4 border-primary/60 bg-black/5 px-2 py-1.5 dark:bg-white/5",
              onJumpToReply ? "cursor-pointer hover:bg-black/10 dark:hover:bg-white/10" : "cursor-default"
            )}
            aria-label={onJumpToReply ? "Ir para a mensagem original" : "Mensagem original"}
            disabled={!onJumpToReply}
          >
            <p className="text-[11px] font-semibold leading-none" style={{ color: ROLE_COLOR[replyTo.sender.role] ?? "#1B3B6E" }}>
              {replyTo.sender.name}
              <span className="ml-1.5 font-normal text-[10px] text-gray-500 dark:text-gray-400">
                ({ROLE_LABELS[replyTo.sender.role] ?? replyTo.sender.role})
              </span>
            </p>
            <p className="mt-1 text-[11px] text-gray-700 dark:text-gray-200 line-clamp-2">
              {replyTo.message || "(sem texto)"}
            </p>
          </button>
        ) : null}
        {message ? (
          <p className="text-[13px] leading-snug break-words whitespace-pre-wrap pr-24">
            {message}
          </p>
        ) : null}
        {editedAt ? (
          editHistory ? (
            <button
              type="button"
              className="mt-1 text-[10px] text-muted-foreground hover:underline underline-offset-2"
              onClick={onToggleEditHistory}
              aria-label={showEditHistory ? "Ocultar histórico de edições" : "Ver histórico de edições"}
            >
              editada
            </button>
          ) : (
            <span className="mt-1 block text-[10px] text-muted-foreground">editada</span>
          )
        ) : null}

        {showEditHistory && editHistory && editHistory.length > 0 ? (
          <div className="mt-2 rounded-lg border border-black/5 bg-white/60 p-2 text-[11px] dark:border-white/10 dark:bg-white/5">
            <p className="font-semibold text-[11px] mb-1">Histórico de edições</p>
            <div className="grid gap-1">
              {editHistory.slice().reverse().map((h, idx) => (
                <div key={`${createdAt}_${idx}`} className="text-muted-foreground">
                  <span className="font-medium">{new Date(h.editedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="ml-2">{h.message}</span>
                </div>
              ))}
            </div>
          </div>
        ) : showEditHistory ? (
          <div className="mt-2 rounded-lg border border-black/5 bg-white/60 p-2 text-[11px] text-muted-foreground dark:border-white/10 dark:bg-white/5">
            Histórico indisponível.
          </div>
        ) : null}

        {attachments.length > 0 ? (
          <div className={cn("mt-2 grid gap-2", message ? "" : "pr-24")}>
            {attachments.map((att) => {
              const isImage = att.mimeType.startsWith("image/");
              const isAudio = att.mimeType.startsWith("audio/");
              const Icon = isImage ? FileImage : isAudio ? Music : FileText;
              const canInlinePreview = isImage || isAudio;
              const preview = getPreviewState(att.id);
              const deleting = isDeletingAttachment(att);
              return (
                <div
                  key={att.id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border border-black/5 bg-black/5 px-2 py-1.5",
                    "dark:border-white/10 dark:bg-white/5"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-gray-600 dark:text-gray-300" />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left text-[12px] font-medium underline-offset-2 hover:underline"
                    onClick={() => onDownloadAttachment(att)}
                    aria-label={`Baixar ${att.filename}`}
                  >
                    <span className="block truncate">{att.filename}</span>
                  </button>
                  {canInlinePreview ? (
                    <button
                      type="button"
                      className="rounded-md p-1 text-gray-600 hover:bg-black/10 dark:text-gray-200 dark:hover:bg-white/10"
                      onClick={() => onTogglePreview(att)}
                      aria-label={preview?.open ? `Ocultar pré-visualização de ${att.filename}` : `Pré-visualizar ${att.filename}`}
                      title={preview?.open ? "Ocultar" : "Pré-visualizar"}
                    >
                      {preview?.open ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  ) : null}
                  {isAudio ? (
                    <button
                      type="button"
                      className="rounded-md p-1 text-gray-600 hover:bg-black/10 dark:text-gray-200 dark:hover:bg-white/10"
                      onClick={() => onDownloadAttachment(att)}
                      aria-label={`Baixar áudio ${att.filename}`}
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rounded-md p-1 text-gray-600 hover:bg-black/10 dark:text-gray-200 dark:hover:bg-white/10"
                      onClick={() => onDownloadAttachment(att)}
                      aria-label={`Baixar ${att.filename}`}
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  )}
                  {canDeleteAttachment(att) ? (
                    <button
                      type="button"
                      className={cn(
                        "rounded-md p-1 text-rose-600 hover:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-400/10",
                        deleting ? "opacity-60 pointer-events-none" : ""
                      )}
                      onClick={() => onDeleteAttachment(att)}
                      disabled={deleting}
                      aria-label={`Excluir ${att.filename}`}
                    >
                      {deleting ? <Spinner className="h-4 w-4 text-rose-600 dark:text-rose-300" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {attachments.some((a) => a.mimeType.startsWith("image/") || a.mimeType.startsWith("audio/")) ? (
          <div className="mt-2 space-y-2">
            {attachments.map((att) => {
              const isImage = att.mimeType.startsWith("image/");
              const isAudio = att.mimeType.startsWith("audio/");
              if (!isImage && !isAudio) return null;
              const preview = getPreviewState(att.id);
              if (!preview?.open) return null;
              return (
                <div key={`preview_${att.id}`} className="rounded-lg border border-black/5 bg-white/60 p-2 dark:border-white/10 dark:bg-white/5">
                  {preview.loading ? (
                    <p className="text-xs text-muted-foreground">Carregando pré-visualização…</p>
                  ) : preview.error ? (
                    <p className="text-xs text-destructive">{preview.error}</p>
                  ) : preview.url ? (
                    isImage ? (
                      <img src={preview.url} alt={att.filename} className="max-h-64 w-full rounded-md object-contain" />
                    ) : (
                      <audio controls src={preview.url} className="w-full" />
                    )
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="absolute bottom-1.5 right-2.5 z-20 flex items-center gap-4">
          {editRemainingLabel ? (
            <span className="text-[10px] text-gray-400" aria-label={`Tempo restante para edição ${editRemainingLabel}`}>
              {editRemainingLabel}
            </span>
          ) : null}
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-md p-1 text-gray-600 hover:bg-black/10 dark:text-gray-200 dark:hover:bg-white/10"
              onClick={onReply}
              aria-label="Responder"
              title="Responder"
            >
              <Reply className="h-4 w-4" />
            </button>
            {canEdit ? (
              <button
                type="button"
                className="rounded-md p-1 text-gray-600 hover:bg-black/10 dark:text-gray-200 dark:hover:bg-white/10"
                onClick={onEdit}
                aria-label="Editar"
                title="Editar"
              >
                <Pencil className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <span className="text-[10px] text-gray-400">
            {formatTime(createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Chat() {
  const { user, token } = useAuth();
  const { markAllRead, requestPermission, notifPermission, dmInbox, realtimeStatus, subscribeRealtime } = useChatNotifications();
  const isMobile = useIsMobile();
  const [mobilePanel, setMobilePanel] = useState<"list" | "chat">("list");

  const [conversation, setConversation] = useState<Conversation>({ type: "group" });
  const [groupMessages, setGroupMessages] = useState<GroupMsg[]>([]);
  const [dmMessages, setDmMessages] = useState<DM[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatDenied, setChatDenied] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [replyDraft, setReplyDraft] = useState<ReplyRef | null>(null);
  const [editingDraft, setEditingDraft] = useState<{ type: "group" | "dm"; messageId: number; original: string } | null>(null);
  const [openEditHistory, setOpenEditHistory] = useState<Record<number, boolean>>({});
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [draftAttachments, setDraftAttachments] = useState<Array<{
    localId: string;
    file: File;
    kind: "IMAGE" | "AUDIO" | "FILE";
    previewUrl: string | null;
    status: "ready" | "uploading" | "uploaded" | "error";
    progress: number;
    serverId: number | null;
    error: string | null;
  }>>([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<number, AttachmentPreviewState>>({});
  const [deletingAttachmentIds, setDeletingAttachmentIds] = useState<Record<number, boolean>>({});

  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGroupIdRef = useRef<number>(0);
  const lastDmIdRef = useRef<number>(0);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollTopRef = useRef<number>(0);
  const pendingRestoreRef = useRef<PersistedChatState | null>(null);
  const restoreInFlightRef = useRef<boolean>(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageCacheRef = useRef<CachedMessages | null>(null);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentAtRef = useRef(0);
  const typingSentRef = useRef(false);
  const lastReadSentAtRef = useRef(0);
  const lastReadMessageIdRef = useRef(0);

  const [typingByUserId, setTypingByUserId] = useState<Record<number, { name: string; at: number; scope: "group" | "dm"; partnerId?: number }>>({});
  const [dmReadByPartnerId, setDmReadByPartnerId] = useState<Record<number, number>>({});

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  const isNearBottom = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return true;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    return remaining < 180;
  }, []);

  const jumpToMessage = useCallback((messageId: number) => {
    const el = document.getElementById(`chat_msg_${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(messageId);
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedMessageId((prev) => (prev === messageId ? null : prev));
    }, 1500);
  }, []);

  // ── Data loading ─────────────────────────────────────────────────────────

  const loadGroupMessages = useCallback(async (initial = false): Promise<boolean> => {
    try {
      if (initial) {
        const data = await fetchGroupMessages();
        setGroupMessages(data);
        const lastId = data.length > 0 ? data[data.length - 1].id : 0;
        lastGroupIdRef.current = lastId;
        if (user) {
          const existing = messageCacheRef.current ?? loadCachedMessages(user.id) ?? { savedAt: Date.now(), group: null, dms: {} };
          messageCacheRef.current = { ...existing, group: data };
          saveCachedMessages(user.id, { group: data, dms: existing.dms });
        }
        scrollToBottom("instant");
        return true;
      } else {
        const data = await fetchGroupMessages(lastGroupIdRef.current);
        if (data.length > 0) {
          const shouldStick = isNearBottom();
          setGroupMessages((prev) => [...prev, ...data]);
          lastGroupIdRef.current = data[data.length - 1].id;
          if (user) {
            const existing = messageCacheRef.current ?? loadCachedMessages(user.id) ?? { savedAt: Date.now(), group: null, dms: {} };
            const merged = [...(existing.group ?? []), ...data].slice(-200);
            messageCacheRef.current = { ...existing, group: merged };
            saveCachedMessages(user.id, { group: merged, dms: existing.dms });
          }
          if (shouldStick) scrollToBottom("smooth");
        }
        return true;
      }
    } catch (e) {
      if (typeof e === "object" && e && "status" in e && (e as { status: number }).status === 403) {
        setChatDenied(true);
      }
      return false;
    }
  }, [scrollToBottom, user, isNearBottom]);

  const loadDMMessages = useCallback(async (userId: number, initial = false): Promise<boolean> => {
    try {
      if (initial) {
        const data = await fetchDMs(userId);
        setDmMessages(data);
        const lastId = data.length > 0 ? data[data.length - 1].id : 0;
        lastDmIdRef.current = lastId;
        if (user) {
          const existing = messageCacheRef.current ?? loadCachedMessages(user.id) ?? { savedAt: Date.now(), group: null, dms: {} };
          const nextDms = { ...existing.dms, [userId]: data.slice(-200) };
          messageCacheRef.current = { ...existing, dms: nextDms };
          saveCachedMessages(user.id, { group: existing.group, dms: nextDms });
        }
        scrollToBottom("instant");
        return true;
      } else {
        const data = await fetchDMs(userId, lastDmIdRef.current);
        if (data.length > 0) {
          const shouldStick = isNearBottom();
          setDmMessages((prev) => [...prev, ...data]);
          lastDmIdRef.current = data[data.length - 1].id;
          if (user) {
            const existing = messageCacheRef.current ?? loadCachedMessages(user.id) ?? { savedAt: Date.now(), group: null, dms: {} };
            const merged = [...(existing.dms[userId] ?? []), ...data].slice(-200);
            const nextDms = { ...existing.dms, [userId]: merged };
            messageCacheRef.current = { ...existing, dms: nextDms };
            saveCachedMessages(user.id, { group: existing.group, dms: nextDms });
          }
          if (shouldStick) scrollToBottom("smooth");
        }
        return true;
      }
    } catch (e) {
      if (typeof e === "object" && e && "status" in e && (e as { status: number }).status === 403) {
        setError("Você não tem permissão para visualizar esta conversa.");
      }
      return false;
    }
  }, [scrollToBottom, user, isNearBottom]);

  const applyConversation = useCallback((conv: Conversation, opts?: { preserveInput?: boolean }) => {
    if (!opts?.preserveInput) setInput("");
    setError(null);
    setShowEmoji(false);
    setConversation(conv);
    if (isMobile) setMobilePanel("chat");
  }, [isMobile]);

  const buildPersistedState = useCallback((): PersistedChatState | null => {
    if (!user) return null;
    const nextConversation =
      conversation.type === "group"
        ? { type: "group" as const }
        : { type: "dm" as const, participantId: conversation.participant.id };
    const scrollTop = messagesScrollRef.current?.scrollTop ?? lastScrollTopRef.current ?? null;
    return {
      actorUserId: user.id,
      conversation: nextConversation,
      scrollTop,
      focusedMessageId: highlightedMessageId,
      draftMessage: input,
      savedAt: Date.now(),
    };
  }, [user, conversation, highlightedMessageId, input]);

  const saveNow = useCallback(() => {
    const next = buildPersistedState();
    if (!next) return;
    saveChatState(next);
  }, [buildPersistedState]);

  const applyPersisted = useCallback((next: PersistedChatState | null) => {
    if (!next) return;
    setInput(next.draftMessage || "");
    pendingRestoreRef.current = next;
    restoreInFlightRef.current = true;

    const conv = next.conversation;
    if (conv.type === "group") {
      applyConversation({ type: "group" }, { preserveInput: true });
      return;
    }

    if (!isPersistedDmConversation(conv)) return;
    const participant = participants.find((p) => p.id === conv.participantId);
    if (participant) {
      applyConversation({ type: "dm", participant }, { preserveInput: true });
    }
  }, [applyConversation, participants]);

  const attemptRestoreUi = useCallback(() => {
    const start = performance.now();
    const run = () => {
      const state = pendingRestoreRef.current;
      if (!state) {
        restoreInFlightRef.current = false;
        return;
      }

      const scroller = messagesScrollRef.current;
      if (scroller && state.scrollTop != null) {
        scroller.scrollTop = state.scrollTop;
        lastScrollTopRef.current = state.scrollTop;
      }

      let focusDone = true;
      if (state.focusedMessageId) {
        const el = document.getElementById(`chat_msg_${state.focusedMessageId}`);
        if (el) {
          el.scrollIntoView({ behavior: "auto", block: "center" });
          setHighlightedMessageId(state.focusedMessageId);
        } else {
          focusDone = false;
        }
      }

      const elapsed = performance.now() - start;
      if ((scroller && (state.scrollTop == null || scroller.scrollTop === state.scrollTop) && focusDone) || elapsed >= 500) {
        restoreInFlightRef.current = false;
        return;
      }

      requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
  }, []);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    markAllRead();
    fetchParticipants()
      .then((data) => {
        setParticipants(data);
        setChatDenied(false);
      })
      .catch((e) => {
        if (typeof e === "object" && e && "status" in e && (e as { status: number }).status === 403) {
          setChatDenied(true);
        }
      });
  }, [markAllRead]);

  useEffect(() => {
    if (!user) return;
    const state = loadChatState(user.id);
    if (!state) return;
    applyPersisted(state);
    attemptRestoreUi();
  }, [user, applyPersisted, attemptRestoreUi]);

  useEffect(() => {
    if (!user) return;
    if (!restoreInFlightRef.current) return;
    const pending = pendingRestoreRef.current;
    if (!pending) return;
    const conv = pending.conversation;
    if (!isPersistedDmConversation(conv)) return;
    const has = participants.some((p) => p.id === conv.participantId);
    if (!has) return;
    applyPersisted(pending);
  }, [user, participants, applyPersisted]);

  useEffect(() => {
    if (!user) return;
    const cached = loadCachedMessages(user.id);
    if (!cached) return;
    if (Date.now() - cached.savedAt > 5 * 60_000) return;
    messageCacheRef.current = cached;
    if (cached.group && cached.group.length > 0) {
      setGroupMessages(cached.group);
      lastGroupIdRef.current = cached.group[cached.group.length - 1].id;
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        saveNow();
        return;
      }
      if (document.visibilityState !== "visible") return;
      const state = loadChatState(user.id);
      if (!state) return;
      applyPersisted(state);
      attemptRestoreUi();
    };

    window.addEventListener("beforeunload", saveNow);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", saveNow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user, saveNow, applyPersisted, attemptRestoreUi]);

  useEffect(() => {
    if (!user) return;
    const id = setTimeout(() => saveNow(), 200);
    return () => clearTimeout(id);
  }, [user, conversation, highlightedMessageId, saveNow]);

  useEffect(() => {
    if (!user) return;
    if (pollingRef.current) clearTimeout(pollingRef.current);

    if (conversation.type === "dm") {
      const cached = messageCacheRef.current ?? loadCachedMessages(user.id);
      const cachedDm = cached?.dms?.[conversation.participant.id] ?? null;
      if (cachedDm && cachedDm.length > 0) {
        setDmMessages(cachedDm);
        lastDmIdRef.current = cachedDm[cachedDm.length - 1].id;
      }
    }

    let stopped = false;
    let first = true;
    let backoffMs = realtimeStatus === "connected" ? 60_000 : 2_000;

    const loop = async () => {
      if (stopped) return;
      const isHidden = document.visibilityState !== "visible";
      const baseMs = realtimeStatus === "connected" ? 60_000 : (isHidden ? 10_000 : 2_000);

      let ok = true;
      if (conversation.type === "group") {
        ok = await loadGroupMessages(first);
      } else {
        const uid = conversation.participant.id;
        if (first) lastDmIdRef.current = 0;
        ok = await loadDMMessages(uid, first);
      }
      first = false;
      if (stopped) return;

      if (realtimeStatus === "connected") {
        backoffMs = baseMs;
      } else {
        backoffMs = ok ? baseMs : Math.min(30_000, Math.round(backoffMs * 1.6));
      }

      pollingRef.current = setTimeout(loop, backoffMs);
    };

    void loop();

    return () => {
      stopped = true;
      if (pollingRef.current) clearTimeout(pollingRef.current);
      pollingRef.current = null;
    };
  }, [conversation, loadGroupMessages, loadDMMessages, realtimeStatus, user]);

  useEffect(() => {
    if (realtimeStatus !== "connected") return;
    if (!user) return;
    const unsub = subscribeRealtime(({ type, payload }) => {
      if (!payload || typeof payload !== "object") return;
      if (type === "group_message") {
        const id = Number((payload as any).id);
        if (!Number.isInteger(id) || id <= 0) return;
        const msg: GroupMsg = {
          id,
          senderId: Number((payload as any).senderId),
          message: String((payload as any).message ?? ""),
          replyTo: (payload as any).replyTo ?? null,
          editedAt: null,
          editHistory: undefined,
          createdAt: String((payload as any).createdAt ?? new Date().toISOString()),
          sender: { id: Number((payload as any).senderId), name: String((payload as any).senderName ?? ""), role: String((payload as any).senderRole ?? "") },
          attachments: Array.isArray((payload as any).attachments) ? (payload as any).attachments : [],
        };
        setGroupMessages((prev) => {
          if (prev.some((p) => p.id === msg.id)) return prev;
          const next = [...prev, msg];
          if (user) {
            const existing = messageCacheRef.current ?? loadCachedMessages(user.id) ?? { savedAt: Date.now(), group: null, dms: {} };
            const merged = [...(existing.group ?? []), msg].slice(-200);
            messageCacheRef.current = { ...existing, group: merged };
            saveCachedMessages(user.id, { group: merged, dms: existing.dms });
          }
          return next;
        });
        lastGroupIdRef.current = Math.max(lastGroupIdRef.current, msg.id);
        if (isNearBottom()) scrollToBottom("smooth");
        return;
      }

      if (type === "dm_message") {
        if (conversation.type !== "dm") return;
        const id = Number((payload as any).id);
        if (!Number.isInteger(id) || id <= 0) return;
        const senderId = Number((payload as any).senderId);
        const receiverId = Number((payload as any).receiverId);
        const otherId = senderId === user.id ? receiverId : senderId;
        if (otherId !== conversation.participant.id) return;

        const msg: DM = {
          id,
          senderId,
          receiverId,
          message: String((payload as any).message ?? ""),
          replyTo: (payload as any).replyTo ?? null,
          editedAt: null,
          editHistory: undefined,
          createdAt: String((payload as any).createdAt ?? new Date().toISOString()),
          sender: { id: senderId, name: String((payload as any).senderName ?? ""), role: String((payload as any).senderRole ?? "") },
          receiver: { id: receiverId, name: String((payload as any).receiverName ?? ""), role: String((payload as any).receiverRole ?? "") },
          attachments: Array.isArray((payload as any).attachments) ? (payload as any).attachments : [],
        };

        setDmMessages((prev) => {
          if (prev.some((p) => p.id === msg.id)) return prev;
          const next = [...prev, msg];
          if (user) {
            const existing = messageCacheRef.current ?? loadCachedMessages(user.id) ?? { savedAt: Date.now(), group: null, dms: {} };
            const merged = [...(existing.dms[otherId] ?? []), msg].slice(-200);
            const nextDms = { ...existing.dms, [otherId]: merged };
            messageCacheRef.current = { ...existing, dms: nextDms };
            saveCachedMessages(user.id, { group: existing.group, dms: nextDms });
          }
          return next;
        });
        lastDmIdRef.current = Math.max(lastDmIdRef.current, msg.id);
        if (isNearBottom()) scrollToBottom("smooth");
        return;
      }

      if (type === "group_message_edited") {
        const id = Number((payload as any).id);
        if (!Number.isInteger(id) || id <= 0) return;
        const editedAt = typeof (payload as any).editedAt === "string" ? (payload as any).editedAt : null;
        const message = typeof (payload as any).message === "string" ? (payload as any).message : null;
        const editHistory = Array.isArray((payload as any).editHistory) ? (payload as any).editHistory : undefined;
        setGroupMessages((prev) => prev.map((m) => m.id === id ? { ...m, message: message ?? m.message, editedAt: editedAt ?? m.editedAt, editHistory: editHistory ?? m.editHistory } : m));
        return;
      }

      if (type === "dm_message_edited") {
        if (conversation.type !== "dm") return;
        const id = Number((payload as any).id);
        if (!Number.isInteger(id) || id <= 0) return;
        const editedAt = typeof (payload as any).editedAt === "string" ? (payload as any).editedAt : null;
        const message = typeof (payload as any).message === "string" ? (payload as any).message : null;
        const editHistory = Array.isArray((payload as any).editHistory) ? (payload as any).editHistory : undefined;
        setDmMessages((prev) => prev.map((m) => m.id === id ? { ...m, message: message ?? m.message, editedAt: editedAt ?? m.editedAt, editHistory: editHistory ?? m.editHistory } : m));
        return;
      }

      if (type === "typing") {
        const scope = (payload as any).scope;
        const senderId = Number((payload as any).senderId);
        const isTyping = !!(payload as any).isTyping;
        const name = String((payload as any).senderName ?? "");
        const at = Date.now();
        if (!Number.isInteger(senderId) || senderId <= 0 || senderId === user.id) return;

        if (scope === "group") {
          setTypingByUserId((prev) => {
            const next = { ...prev };
            if (!isTyping) {
              delete next[senderId];
              return next;
            }
            next[senderId] = { name, at, scope: "group" };
            return next;
          });
          return;
        }
        if (scope === "dm") {
          const receiverId = Number((payload as any).receiverId);
          if (receiverId !== user.id) return;
          setTypingByUserId((prev) => {
            const next = { ...prev };
            if (!isTyping) {
              delete next[senderId];
              return next;
            }
            next[senderId] = { name, at, scope: "dm", partnerId: senderId };
            return next;
          });
        }
        return;
      }

      if (type === "dm_read") {
        const readerId = Number((payload as any).readerId);
        const otherUserId = Number((payload as any).otherUserId);
        const messageId = Number((payload as any).messageId);
        if (!Number.isInteger(readerId) || !Number.isInteger(otherUserId) || !Number.isInteger(messageId)) return;
        const partnerId = readerId === user.id ? otherUserId : readerId;
        setDmReadByPartnerId((prev) => ({ ...prev, [partnerId]: Math.max(prev[partnerId] ?? 0, messageId) }));
      }
    });
    return unsub;
  }, [realtimeStatus, subscribeRealtime, conversation, user, isNearBottom, scrollToBottom]);

  // Close emoji picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    };
    if (showEmoji) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showEmoji]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setTypingByUserId((prev) => {
      const next: typeof prev = {};
      for (const [k, v] of Object.entries(prev)) {
        const id = Number(k);
        if (Date.now() - v.at > 2500) continue;
        next[id] = v;
      }
      return next;
    });
  }, [nowTick]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const a of draftAttachments) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
    };
  }, [draftAttachments]);

  useEffect(() => {
    return () => {
      for (const p of Object.values(attachmentPreviews)) {
        if (p.url) URL.revokeObjectURL(p.url);
      }
    };
  }, [attachmentPreviews]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const selectConversation = (conv: Conversation) => {
    applyConversation(conv);
  };

  const goBackToList = () => {
    setMobilePanel("list");
    setError(null);
    setShowEmoji(false);
  };

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    const emoji = emojiData.emoji;
    const ta = inputRef.current;
    if (!ta) { setInput((p) => p + emoji); return; }
    const start = ta.selectionStart ?? input.length;
    const end = ta.selectionEnd ?? input.length;
    const newValue = input.slice(0, start) + emoji + input.slice(end);
    setInput(newValue);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + emoji.length;
      ta.focus();
    });
    setShowEmoji(false);
  };

  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const allowedByExt: Record<string, { kind: "IMAGE" | "AUDIO" | "FILE"; accept: string[] }> = {
    jpg: { kind: "IMAGE", accept: ["image/jpeg"] },
    jpeg: { kind: "IMAGE", accept: ["image/jpeg"] },
    png: { kind: "IMAGE", accept: ["image/png"] },
    gif: { kind: "IMAGE", accept: ["image/gif"] },
    webp: { kind: "IMAGE", accept: ["image/webp"] },
    pdf: { kind: "FILE", accept: ["application/pdf"] },
    doc: { kind: "FILE", accept: ["application/msword"] },
    docx: { kind: "FILE", accept: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"] },
    txt: { kind: "FILE", accept: ["text/plain"] },
    zip: { kind: "FILE", accept: ["application/zip"] },
    mp3: { kind: "AUDIO", accept: ["audio/mpeg"] },
    wav: { kind: "AUDIO", accept: ["audio/wav", "audio/x-wav"] },
    m4a: { kind: "AUDIO", accept: ["audio/mp4"] },
    ogg: { kind: "AUDIO", accept: ["audio/ogg"] },
  };

  const getExt = (name: string) => {
    const lower = name.toLowerCase();
    const idx = lower.lastIndexOf(".");
    return idx === -1 ? "" : lower.slice(idx + 1);
  };

  const validateFile = (file: File): { ok: true; kind: "IMAGE" | "AUDIO" | "FILE" } | { ok: false; error: string } => {
    if (file.size > MAX_FILE_BYTES) return { ok: false, error: "Arquivo excede 5MB" };
    const ext = getExt(file.name);
    const cfg = allowedByExt[ext];
    if (!cfg) return { ok: false, error: "Tipo de arquivo não permitido" };
    const declared = (file.type || "").toLowerCase();
    if (declared && declared !== "application/octet-stream" && cfg.accept.length > 0 && !cfg.accept.includes(declared)) {
      if (!(ext === "docx" && file.type === "application/zip")) {
        return { ok: false, error: "Tipo MIME não permitido" };
      }
    }
    return { ok: true, kind: cfg.kind };
  };

  const compressImage = async (file: File): Promise<File> => {
    const ext = getExt(file.name);
    if (ext === "gif") return file;
    if (file.size <= 1024 * 1024) return file;
    if (!("createImageBitmap" in window)) return file;

    const bitmap = await createImageBitmap(file);
    const maxEdge = 1920;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const preferWebp = ext !== "png";
    const mime = preferWebp ? "image/webp" : "image/jpeg";
    const quality = 0.85;

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (!b) reject(new Error("Falha ao comprimir imagem"));
        else resolve(b);
      }, mime, quality);
    });

    if (blob.size > MAX_FILE_BYTES) {
      return file;
    }

    const newName = file.name.replace(/\.[^.]+$/, preferWebp ? ".webp" : ".jpg");
    return new File([blob], newName, { type: blob.type });
  };

  const handlePickFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const next: typeof draftAttachments = [];

    for (const file of Array.from(files)) {
      const validation = validateFile(file);
      if (!validation.ok) {
        next.push({
          localId: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
          file,
          kind: "FILE",
          previewUrl: null,
          status: "error",
          progress: 0,
          serverId: null,
          error: validation.error,
        });
        continue;
      }

      let finalFile = file;
      try {
        if (validation.kind === "IMAGE") {
          finalFile = await compressImage(file);
          const revalidate = validateFile(finalFile);
          if (!revalidate.ok) {
            next.push({
              localId: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
              file,
              kind: validation.kind,
              previewUrl: null,
              status: "error",
              progress: 0,
              serverId: null,
              error: revalidate.error,
            });
            continue;
          }
        }
      } catch {
        finalFile = file;
      }

      const previewUrl = validation.kind === "IMAGE" || validation.kind === "AUDIO"
        ? URL.createObjectURL(finalFile)
        : null;

      next.push({
        localId: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        file: finalFile,
        kind: validation.kind,
        previewUrl,
        status: "ready",
        progress: 0,
        serverId: null,
        error: null,
      });
    }

    setDraftAttachments((prev) => [...prev, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeDraftAttachment = (localId: string) => {
    setDraftAttachments((prev) => {
      const item = prev.find((p) => p.localId === localId);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((p) => p.localId !== localId);
    });
  };

  const uploadOne = (item: (typeof draftAttachments)[number]): Promise<number> => {
    if (!token) return Promise.reject(new Error("Não autenticado"));

    const isGroup = conversation.type === "group";
    const scope = isGroup ? "GROUP" : "DM";
    const receiverId = conversation.type === "dm" ? conversation.participant.id : null;

    const form = new FormData();
    form.append("files", item.file, item.file.name);

    const url = receiverId
      ? `/api/chat/attachments/upload?scope=${encodeURIComponent(scope)}&receiverId=${encodeURIComponent(String(receiverId))}`
      : `/api/chat/attachments/upload?scope=${encodeURIComponent(scope)}`;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (evt) => {
        if (!evt.lengthComputable) return;
        const pct = Math.max(0, Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
        setDraftAttachments((prev) =>
          prev.map((p) => (p.localId === item.localId ? { ...p, progress: pct } : p))
        );
      };
      xhr.onload = () => {
        try {
          const status = xhr.status;
          const text = xhr.responseText || "";
          const json = text ? JSON.parse(text) : null;
          if (status >= 200 && status < 300 && json?.attachments?.[0]?.id) {
            resolve(Number(json.attachments[0].id));
          } else {
            reject(new Error(json?.error || "Falha no upload"));
          }
        } catch {
          reject(new Error("Resposta inválida do servidor"));
        }
      };
      xhr.onerror = () => reject(new Error("Falha de conexão"));
      xhr.ontimeout = () => reject(new Error("Tempo de conexão excedido"));
      xhr.timeout = 60_000;
      xhr.send(form);
    });
  };

  const handleSend = async () => {
    const text = input.trim();
    if (sending) return;
    const hasReady = draftAttachments.some((a) => a.status === "ready" || a.status === "uploaded");
    if (editingDraft && !text) return;
    if (!editingDraft && !text && !hasReady) return;
    if (conversation.type === "dm" && user && conversation.participant.id === user.id) {
      setError("Não é possível enviar mensagem para si mesmo.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      if (editingDraft) {
        if (editingDraft.type === "group") {
          const updated = await patchGroupMessage(editingDraft.messageId, text);
          setGroupMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        } else {
          const updated = await patchDMMessage(editingDraft.messageId, text);
          setDmMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        }
        setEditingDraft(null);
        setInput("");
        setTimeout(() => scrollToBottom("smooth"), 50);
        inputRef.current?.focus();
        return;
      }

      const toUpload = draftAttachments.filter((a) => a.status === "ready" && !a.serverId);
      if (toUpload.length > 0) {
        setDraftAttachments((prev) => prev.map((p) => (p.status === "ready" && !p.serverId ? { ...p, status: "uploading", progress: 0 } : p)));
        for (const item of toUpload) {
          try {
            const id = await uploadOne(item);
            setDraftAttachments((prev) =>
              prev.map((p) => (p.localId === item.localId ? { ...p, status: "uploaded", serverId: id, progress: 100 } : p))
            );
          } catch (e: any) {
            const msg = e?.message || "Falha no upload";
            setDraftAttachments((prev) =>
              prev.map((p) => (p.localId === item.localId ? { ...p, status: "error", error: msg } : p))
            );
            throw new Error(msg);
          }
        }
      }

      const attachmentIds = draftAttachments
        .filter((a) => a.status === "uploaded" && a.serverId)
        .map((a) => a.serverId!) as number[];
      const replyToId = replyDraft?.id ?? null;

      if (conversation.type === "group") {
        const msg = await postGroupMessage(text, attachmentIds, replyToId);
        setGroupMessages((p) => [...p, msg]);
        lastGroupIdRef.current = msg.id;
      } else {
        const msg = await postDM(conversation.participant.id, text, attachmentIds, replyToId);
        setDmMessages((p) => [...p, msg]);
        lastDmIdRef.current = msg.id;
      }
      setInput("");
      setReplyDraft(null);
      setDraftAttachments((prev) => {
        for (const p of prev) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
        return [];
      });
      setTimeout(() => scrollToBottom("smooth"), 50);
      inputRef.current?.focus();
    } catch (e: any) {
      const data = e && typeof e === "object" && "data" in e ? (e as any).data : null;
      const specific = data && typeof data === "object"
        ? (typeof (data as any).error === "string" ? (data as any).error : typeof (data as any).message === "string" ? (data as any).message : null)
        : null;
      const msg = specific ?? (typeof e?.message === "string" ? e.message.replace(/^HTTP\s+\d+\s+[^:]+:\s*/i, "") : null);
      setError(msg || "Não foi possível enviar. Tente novamente.");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const downloadAttachment = async (att: ChatAttachment) => {
    if (!token) return;
    try {
      const resp = await fetch(`/api/chat/attachments/${att.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        setError("Não foi possível baixar o anexo.");
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = att.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Falha de conexão ao baixar o anexo.");
    }
  };

  const canDeleteAttachment = (att: ChatAttachment) => {
    if (!user) return false;
    return att.uploaderId === user.id;
  };

  const deleteAttachment = async (att: ChatAttachment) => {
    if (deletingAttachmentIds[att.id]) return;
    setDeletingAttachmentIds((prev) => ({ ...prev, [att.id]: true }));
    try {
      await customFetch(`/api/chat/attachments/${att.id}`, { method: "DELETE" });
      setAttachmentPreviews((prev) => {
        const existing = prev[att.id];
        if (existing?.url) URL.revokeObjectURL(existing.url);
        const { [att.id]: _removed, ...rest } = prev;
        return rest;
      });
      if (conversation.type === "group") {
        setGroupMessages((prev) =>
          prev.map((m) => (m.attachments.some((a) => a.id === att.id) ? { ...m, attachments: m.attachments.filter((a) => a.id !== att.id) } : m))
        );
      } else {
        setDmMessages((prev) =>
          prev.map((m) => (m.attachments.some((a) => a.id === att.id) ? { ...m, attachments: m.attachments.filter((a) => a.id !== att.id) } : m))
        );
      }
    } catch (e) {
      if (typeof e === "object" && e && "status" in e && (e as { status: number }).status === 403) {
        setError("Você só pode excluir anexos enviados por você.");
      } else {
        setError("Não foi possível excluir o anexo.");
      }
    } finally {
      setDeletingAttachmentIds((prev) => {
        const { [att.id]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const getPreviewState = (id: number) => attachmentPreviews[id];

  const togglePreview = async (att: ChatAttachment) => {
    const canInline = att.mimeType.startsWith("image/") || att.mimeType.startsWith("audio/");
    if (!canInline) return;
    if (!token) return;

    const existing = attachmentPreviews[att.id];
    if (existing?.open) {
      setAttachmentPreviews((prev) => ({ ...prev, [att.id]: { ...(prev[att.id] ?? { open: false, loading: false, url: null, error: null }), open: false } }));
      return;
    }

    if (existing?.url && !existing.loading) {
      setAttachmentPreviews((prev) => ({ ...prev, [att.id]: { ...prev[att.id], open: true } }));
      return;
    }

    setAttachmentPreviews((prev) => ({
      ...prev,
      [att.id]: { open: true, loading: true, url: null, error: null },
    }));

    try {
      const resp = await fetch(`/api/chat/attachments/${att.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        setAttachmentPreviews((prev) => ({
          ...prev,
          [att.id]: { open: true, loading: false, url: null, error: "Não foi possível carregar a pré-visualização." },
        }));
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      setAttachmentPreviews((prev) => ({
        ...prev,
        [att.id]: { open: true, loading: false, url, error: null },
      }));
    } catch {
      setAttachmentPreviews((prev) => ({
        ...prev,
        [att.id]: { open: true, loading: false, url: null, error: "Falha de conexão ao carregar a pré-visualização." },
      }));
    }
  };

  const formatRemaining = (ms: number) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const getEditRemainingLabel = (createdAtIso: string, senderId: number) => {
    if (!user) return null;
    if (senderId !== user.id) return null;
    const created = new Date(createdAtIso).getTime();
    const expires = created + 2 * 60 * 1000;
    const remaining = expires - nowTick;
    if (remaining <= 0) return null;
    return formatRemaining(remaining);
  };

  const handleReplyToMessage = (msg: { id: number; senderId: number; senderName: string; senderRole: string; message: string; createdAt: string }) => {
    setEditingDraft(null);
    setReplyDraft({
      id: msg.id,
      senderId: msg.senderId,
      message: msg.message,
      createdAt: msg.createdAt,
      sender: { id: msg.senderId, name: msg.senderName, role: msg.senderRole },
    });
    inputRef.current?.focus();
  };

  const handleEditMessage = (msg: { id: number; senderId: number; message: string; createdAt: string }) => {
    if (!user) return;
    if (msg.senderId !== user.id) return;
    const created = new Date(msg.createdAt).getTime();
    const expires = created + 2 * 60 * 1000;
    if (nowTick >= expires) {
      setError("Tempo de edição expirado.");
      return;
    }
    setReplyDraft(null);
    setDraftAttachments((prev) => {
      for (const p of prev) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      return [];
    });
    setEditingDraft({ type: conversation.type === "group" ? "group" : "dm", messageId: msg.id, original: msg.message });
    setInput(msg.message);
    inputRef.current?.focus();
  };

  const toggleEditHistory = (messageId: number) => {
    setOpenEditHistory((prev) => ({ ...prev, [messageId]: !prev[messageId] }));
  };

  const sendTypingEvent = useCallback(async (isTyping: boolean) => {
    if (!token || !user) return;
    if (conversation.type === "group") {
      await customFetch("/api/chat/typing", {
        method: "POST",
        body: JSON.stringify({ scope: "group", isTyping }),
      });
      return;
    }
    if (conversation.type === "dm") {
      await customFetch("/api/chat/typing", {
        method: "POST",
        body: JSON.stringify({ scope: "dm", receiverId: conversation.participant.id, isTyping }),
      });
    }
  }, [token, user, conversation]);

  const onInputChange = (text: string) => {
    setInput(text);
    if (!token || !user) return;
    const now = Date.now();
    if (!typingSentRef.current || now - lastTypingSentAtRef.current >= 900) {
      lastTypingSentAtRef.current = now;
      typingSentRef.current = true;
      void sendTypingEvent(true);
    }
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = setTimeout(() => {
      typingSentRef.current = false;
      void sendTypingEvent(false);
    }, 1100);
  };

  const maybeSendReadReceipt = useCallback(() => {
    if (!token || !user) return;
    if (conversation.type !== "dm") return;
    if (document.visibilityState !== "visible") return;
    if (!document.hasFocus()) return;
    if (!isNearBottom()) return;
    const otherId = conversation.participant.id;
    const lastOtherMsg = [...dmMessages].reverse().find((m) => m.senderId === otherId);
    if (!lastOtherMsg) return;

    const now = Date.now();
    if (now - lastReadSentAtRef.current < 1500) return;
    if (lastOtherMsg.id <= lastReadMessageIdRef.current) return;
    lastReadSentAtRef.current = now;
    lastReadMessageIdRef.current = lastOtherMsg.id;
    void customFetch("/api/chat/read", {
      method: "POST",
      body: JSON.stringify({ otherUserId: otherId, messageId: lastOtherMsg.id }),
    });
  }, [token, user, conversation, dmMessages, isNearBottom]);

  // ── Derived state ─────────────────────────────────────────────────────────

  const inboxByPartner = new Map(dmInbox.map((d) => [d.partnerId, d]));

  const lastGroupMessage = groupMessages.length > 0 ? groupMessages[groupMessages.length - 1] : null;

  const isGroupSelected = conversation.type === "group";
  const selectedParticipantId = conversation.type === "dm" ? conversation.participant.id : null;
  const connectionLabel =
    realtimeStatus === "connected"
      ? "Conectado"
      : realtimeStatus === "connecting"
      ? "Conectando…"
      : realtimeStatus === "reconnecting"
      ? "Reconectando…"
      : "Tempo real desativado";
  const connectionDotClass =
    realtimeStatus === "connected"
      ? "bg-green-500"
      : realtimeStatus === "connecting" || realtimeStatus === "reconnecting"
      ? "bg-amber-500"
      : "bg-muted-foreground/50";

  const groupTypers = Object.entries(typingByUserId)
    .filter(([, v]) => v.scope === "group")
    .slice(0, 3)
    .map(([, v]) => v.name.split(" ")[0])
    .filter(Boolean);
  const dmTyping =
    conversation.type === "dm" && typingByUserId[conversation.participant.id]?.scope === "dm"
      ? true
      : false;
  const typingLabel = isGroupSelected
    ? (groupTypers.length === 0 ? "" : groupTypers.length === 1 ? `${groupTypers[0]} digitando…` : `${groupTypers.slice(0, 2).join(", ")} digitando…`)
    : dmTyping
    ? "digitando…"
    : "";

  const dmReadLabel = (() => {
    if (conversation.type !== "dm") return "";
    const partnerId = conversation.participant.id;
    const readId = dmReadByPartnerId[partnerId] ?? 0;
    const lastOwn = [...dmMessages].reverse().find((m) => m.senderId === user?.id);
    if (!lastOwn) return "";
    if (readId >= lastOwn.id) return "Lido";
    return "";
  })();

  const currentMessages: Array<{
    id: number;
    senderId: number;
    message: string;
    replyTo: ReplyRef | null;
    editedAt?: string | null;
    editHistory?: Array<{ message: string; editedAt: string }>;
    createdAt: string;
    senderName: string;
    senderRole: string;
    attachments: ChatAttachment[];
  }> =
    isGroupSelected
      ? groupMessages.map((m) => ({ ...m, senderName: m.sender.name, senderRole: m.sender.role }))
      : dmMessages.map((m) => ({ ...m, senderName: m.sender.name, senderRole: m.sender.role }));

  // ── Render ────────────────────────────────────────────────────────────────

  const headerTitle = isGroupSelected
    ? "Grupo Geral"
    : conversation.type === "dm"
    ? conversation.participant.name
    : "";

  const headerSub = isGroupSelected
    ? `${participants.length} membros`
    : conversation.type === "dm"
    ? ROLE_LABELS[conversation.participant.role] ?? conversation.participant.role
    : "";

  return (
    chatDenied ? (
      <div className="h-full flex items-center justify-center bg-[#f0f2f5] dark:bg-[#111b21]">
        <div className="max-w-md rounded-xl border bg-white dark:bg-[#1f2c34] p-6 text-center">
          <h2 className="text-lg font-semibold">Acesso restrito</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Você não possui permissão para acessar o chat global.
          </p>
        </div>
      </div>
    ) : (
    <div className="flex h-full overflow-hidden bg-[#f0f2f5] dark:bg-[#111b21]">

      {/* ── LEFT PANEL ── */}
      <div
        className={cn(
          "w-full md:w-[320px] flex flex-col bg-white dark:bg-[#1f2c34] border-r border-border shrink-0",
          isMobile && mobilePanel === "chat" ? "hidden" : "flex",
          "md:flex",
        )}
      >

        {/* Header */}
        <div className="flex items-center gap-2 px-3 h-16 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-border shrink-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0">
            <Users className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-none">Equipe Interna</p>
            <p className="text-xs text-muted-foreground mt-0.5">{participants.length} membros</p>
          </div>
          <button
            onClick={requestPermission}
            title={notifPermission === "granted" ? "Notificações ativas" : "Ativar notificações"}
            className="p-1.5 rounded-full hover:bg-muted transition-colors shrink-0"
          >
            {notifPermission === "granted"
              ? <Bell className="h-4 w-4 text-green-500" />
              : notifPermission === "denied"
              ? <BellOff className="h-4 w-4 text-destructive" />
              : <Bell className="h-4 w-4 text-muted-foreground" />}
          </button>
        </div>

        {/* Search visual */}
        <div className="px-3 py-2 border-b border-border">
          <div className="flex items-center gap-2 rounded-lg bg-[#f0f2f5] dark:bg-[#2a3942] px-3 py-1.5">
            <svg className="h-3.5 w-3.5 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-xs text-muted-foreground">Pesquisar conversa</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── Grupo Geral ── */}
          <button
            onClick={() => selectConversation({ type: "group" })}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-3 border-b border-border/50 transition-colors text-left",
              isGroupSelected
                ? "bg-[#e9edef] dark:bg-[#2a3942]"
                : "hover:bg-[#f5f6f6] dark:hover:bg-[#2a3942]"
            )}
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Users className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <p className="text-sm font-semibold truncate">Grupo Geral</p>
                {lastGroupMessage && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatPreviewTime(lastGroupMessage.createdAt)}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {lastGroupMessage
                  ? `${lastGroupMessage.sender.name.split(" ")[0]}: ${lastGroupMessage.message}`
                  : "Nenhuma mensagem ainda"}
              </p>
            </div>
          </button>

          {/* ── Divider ── */}
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground bg-[#f0f2f5]/50">
            Mensagens Diretas
          </p>

          {/* ── DM list ── */}
          {participants
            .filter((p) => p.id !== user?.id)
            .slice()
            .sort((a, b) => {
              const pa = inboxByPartner.get(a.id);
              const pb = inboxByPartner.get(b.id);
              const ta = pa ? new Date(pa.lastMessageAt).getTime() : 0;
              const tb = pb ? new Date(pb.lastMessageAt).getTime() : 0;
              if (ta !== tb) return tb - ta;
              return a.name.localeCompare(b.name);
            })
            .map((p) => {
              const preview = inboxByPartner.get(p.id);
              const isSelected = selectedParticipantId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => selectConversation({ type: "dm", participant: p })}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-3 border-b border-border/30 transition-colors text-left",
                    isSelected
                      ? "bg-[#e9edef] dark:bg-[#2a3942]"
                      : "hover:bg-[#f5f6f6] dark:hover:bg-[#2a3942]"
                  )}
                >
                  <div className="relative shrink-0">
                    <UserAvatar userId={p.id} name={p.name} className="h-12 w-12" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      {preview && (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatPreviewTime(preview.lastMessageAt)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0", ROLE_PILL[p.role] ?? "bg-gray-100 text-gray-600")}>
                        {ROLE_LABELS[p.role] ?? p.role}
                      </span>
                      {preview ? (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {preview.fromMe ? "Você: " : ""}{preview.lastMessage}
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground italic">Iniciar conversa</p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className={cn("flex flex-1 flex-col min-w-0", isMobile && mobilePanel === "list" ? "hidden" : "flex", "md:flex")}>

        {/* Chat header */}
        <div className="flex items-center gap-3 px-4 h-16 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-border shrink-0">
          {isMobile && (
            <button
              onClick={goBackToList}
              className="p-1.5 rounded-full hover:bg-muted transition-colors shrink-0 md:hidden tap-target"
            >
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
          <div className="flex h-10 w-10 items-center justify-center rounded-full shrink-0 overflow-hidden">
            {isGroupSelected ? (
              <div className="h-full w-full flex items-center justify-center bg-primary text-primary-foreground">
                <Users className="h-5 w-5" />
              </div>
            ) : conversation.type === "dm" ? (
              <UserAvatar userId={conversation.participant.id} name={conversation.participant.name} className="h-10 w-10" />
            ) : null}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-none truncate flex items-center gap-2">
              <span className="truncate">{headerTitle}</span>
              <span className="inline-flex items-center gap-1.5 shrink-0">
                <span className={cn("h-2 w-2 rounded-full", connectionDotClass)} />
                <span className="text-[10px] text-muted-foreground">{connectionLabel}</span>
              </span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              {!isGroupSelected && <Lock className="h-3 w-3 shrink-0" />}
              {typingLabel ? `${headerSub} • ${typingLabel}` : headerSub}
            </p>
          </div>
        </div>

        {/* Messages area */}
        <div
          ref={messagesScrollRef}
          className="flex-1 overflow-y-auto px-4 py-3"
          onScroll={(e) => {
            lastScrollTopRef.current = e.currentTarget.scrollTop;
            maybeSendReadReceipt();
          }}
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            backgroundColor: "#e5ddd5",
          }}
        >
          {currentMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <div className="h-16 w-16 rounded-full bg-white/80 flex items-center justify-center shadow">
                {isGroupSelected
                  ? <Users className="h-8 w-8 text-primary/40" />
                  : <Lock className="h-7 w-7 text-primary/40" />}
              </div>
              <p className="text-sm text-gray-600 font-medium">
                {isGroupSelected ? "Nenhuma mensagem ainda" : "Conversa privada"}
              </p>
              <p className="text-xs text-gray-500 max-w-[220px]">
                {isGroupSelected
                  ? "Seja o primeiro a escrever!"
                  : `Inicie uma conversa privada com ${conversation.type === "dm" ? conversation.participant.name.split(" ")[0] : ""}`}
              </p>
            </div>
          )}

          {(() => {
            let renderLastDate = "";
            return currentMessages.map((msg) => {
              const dateLabel = formatDateLabel(msg.createdAt);
              const showDate = dateLabel !== renderLastDate;
              renderLastDate = dateLabel;
              const isOwn = msg.senderId === user?.id;
              const editRemainingLabel = getEditRemainingLabel(msg.createdAt, msg.senderId);
              const canEdit = Boolean(editRemainingLabel);
              const showHistory = Boolean(openEditHistory[msg.id]);
              const replyId = msg.replyTo?.id ?? null;
              return (
                <div key={msg.id} id={`chat_msg_${msg.id}`} className="scroll-mt-24">
                  {showDate && (
                    <div className="flex justify-center my-3">
                      <span className="bg-white/80 dark:bg-[#182229]/80 text-xs text-gray-600 px-3 py-1 rounded-full shadow-sm">
                        {dateLabel}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    isOwn={isOwn}
                    highlighted={highlightedMessageId === msg.id}
                    senderId={msg.senderId}
                    senderName={msg.senderName}
                    senderRole={msg.senderRole}
                    message={msg.message}
                    replyTo={msg.replyTo}
                    editedAt={msg.editedAt}
                    editHistory={msg.editHistory}
                    createdAt={msg.createdAt}
                    showSender={isGroupSelected}
                    attachments={msg.attachments}
                    onDownloadAttachment={downloadAttachment}
                    onDeleteAttachment={deleteAttachment}
                    canDeleteAttachment={canDeleteAttachment}
                    isDeletingAttachment={(att) => Boolean(deletingAttachmentIds[att.id])}
                    getPreviewState={getPreviewState}
                    onTogglePreview={togglePreview}
                    onReply={() => handleReplyToMessage(msg)}
                    onJumpToReply={replyId ? () => jumpToMessage(replyId) : null}
                    canEdit={canEdit}
                    editRemainingLabel={editRemainingLabel}
                    onEdit={() => handleEditMessage(msg)}
                    showEditHistory={showHistory}
                    onToggleEditHistory={() => toggleEditHistory(msg.id)}
                  />
                </div>
              );
            });
          })()}
          <div ref={bottomRef} />
        </div>

        {/* Input footer */}
        <div className="relative px-3 py-3 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-border shrink-0">
          {conversation.type === "dm" && dmReadLabel ? (
            <div className="mb-1 text-[11px] text-muted-foreground">{dmReadLabel}</div>
          ) : null}

          {/* Emoji Picker */}
          {showEmoji && (
            <div ref={emojiPickerRef} className="absolute bottom-full mb-2 left-3 z-50 shadow-xl rounded-xl overflow-hidden">
              <Suspense fallback={<div className="w-[300px] h-[380px] bg-white dark:bg-[#2a3942]" />}>
                <EmojiPicker
                  onEmojiClick={handleEmojiClick}
                  lazyLoadEmojis
                  searchPlaceholder="Pesquisar emoji..."
                  height={380}
                  width={300}
                />
              </Suspense>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 mb-2 bg-destructive/10 border border-destructive/20 text-destructive text-xs px-3 py-2 rounded-lg">
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)}><X className="h-3 w-3" /></button>
            </div>
          )}

          {editingDraft ? (
            <div className="mb-2 rounded-lg border bg-amber-50/80 dark:bg-amber-900/20 px-3 py-2 text-xs flex items-start gap-2">
              <div className="flex-1">
                <p className="font-semibold">Editando mensagem</p>
                <p className="text-muted-foreground mt-0.5 line-clamp-2">{editingDraft.original}</p>
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10"
                onClick={() => { setEditingDraft(null); setInput(""); }}
                aria-label="Cancelar edição"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          {replyDraft ? (
            <div className="mb-2 rounded-lg border bg-blue-50/80 dark:bg-blue-900/20 px-3 py-2 text-xs flex items-start gap-2">
              <div className="flex-1">
                <p className="font-semibold">Respondendo {replyDraft.sender.name}</p>
                <p className="text-muted-foreground mt-0.5 line-clamp-2">{replyDraft.message || "(sem texto)"}</p>
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10"
                onClick={() => setReplyDraft(null)}
                aria-label="Cancelar resposta"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.txt,.zip,.mp3,.wav,.m4a,.ogg"
            className="hidden"
            onChange={(e) => handlePickFiles(e.target.files)}
          />

          {draftAttachments.length > 0 && !editingDraft ? (
            <div className="mb-2 rounded-lg border bg-white/80 dark:bg-[#2a3942] p-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {draftAttachments.map((a) => (
                  <div key={a.localId} className="rounded-lg border border-black/5 dark:border-white/10 bg-white dark:bg-[#1f2c34] p-2">
                    <div className="flex items-start gap-2">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-black/5 dark:bg-white/5 flex items-center justify-center">
                        {a.kind === "IMAGE" && a.previewUrl ? (
                          <img src={a.previewUrl} alt={a.file.name} className="h-full w-full object-cover" />
                        ) : a.kind === "AUDIO" ? (
                          <Music className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <FileText className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{a.file.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {(a.file.size / (1024 * 1024)).toFixed(2)} MB
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeDraftAttachment(a.localId)}
                            className="rounded-md p-1 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10"
                            aria-label={`Remover ${a.file.name}`}
                            disabled={sending || a.status === "uploading"}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        {a.kind === "AUDIO" && a.previewUrl ? (
                          <audio controls src={a.previewUrl} className="mt-2 w-full" />
                        ) : null}

                        {a.status === "uploading" ? (
                          <div className="mt-2">
                            <div className="h-2 w-full rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                              <div className="h-full bg-primary" style={{ width: `${a.progress}%` }} />
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground">{a.progress}%</p>
                          </div>
                        ) : a.status === "error" ? (
                          <p className="mt-2 text-[11px] text-destructive">{a.error || "Erro no anexo"}</p>
                        ) : a.status === "uploaded" ? (
                          <p className="mt-2 text-[11px] text-green-600 dark:text-green-400">Anexo pronto</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => setShowEmoji((v) => !v)}
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors",
                showEmoji
                  ? "bg-primary text-primary-foreground"
                  : "bg-white dark:bg-[#2a3942] text-muted-foreground hover:text-primary shadow-sm"
              )}
              title="Emoji"
            >
              <Smile className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white dark:bg-[#2a3942] text-muted-foreground hover:text-primary shadow-sm"
              title="Anexar arquivo"
              aria-label="Anexar arquivo"
              disabled={sending || Boolean(editingDraft)}
            >
              <Paperclip className="h-5 w-5" />
            </button>

            <div className="flex flex-1 items-end rounded-2xl bg-white dark:bg-[#2a3942] px-4 py-2.5 shadow-sm min-h-[44px]">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                }}
                onKeyDown={handleKeyDown}
                placeholder={
                  editingDraft
                    ? "Edite sua mensagem..."
                    : isGroupSelected
                    ? "Mensagem para o grupo..."
                    : conversation.type === "dm"
                    ? `Mensagem para ${conversation.participant.name.split(" ")[0]}...`
                    : "Digite uma mensagem"
                }
                disabled={sending}
                rows={1}
                maxLength={2000}
                autoComplete="off"
                className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground leading-snug overflow-hidden w-full"
                style={{ height: "24px" }}
              />
            </div>

            <Button
              type="button"
              onClick={handleSend}
              disabled={sending || (editingDraft ? !input.trim() : (!input.trim() && !draftAttachments.some((a) => a.status === "ready" || a.status === "uploaded")))}
              size="icon"
              className="rounded-full h-11 w-11 shrink-0 shadow-sm"
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
    )
  );
}
