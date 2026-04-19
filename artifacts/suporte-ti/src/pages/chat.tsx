import {
  useState,
  useEffect,
  useRef,
  useCallback,
  KeyboardEvent,
} from "react";
import EmojiPicker, { EmojiClickData, Theme } from "emoji-picker-react";
import { useAuth } from "@/lib/auth";
import { useChatNotifications } from "@/lib/chat-notifications";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { Button } from "@/components/ui/button";
import { Send, Users, Smile, BellOff, Bell, X, Lock, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface GroupMsg {
  id: number;
  senderId: number;
  message: string;
  createdAt: string;
  sender: { id: number; name: string; role: string };
}

interface DM {
  id: number;
  senderId: number;
  receiverId: number;
  message: string;
  createdAt: string;
  sender: { id: number; name: string; role: string };
  receiver: { id: number; name: string; role: string };
}

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
  ADMIN: "Admin",
  COORDINATOR: "Coordenador",
  ANALYST: "Analista",
};

const AVATAR_BG: Record<string, string> = {
  ADMIN: "bg-rose-500",
  COORDINATOR: "bg-violet-500",
  ANALYST: "bg-sky-500",
};

const ROLE_COLOR: Record<string, string> = {
  ADMIN: "#e11d48",
  COORDINATOR: "#7c3aed",
  ANALYST: "#0284c7",
};

const ROLE_PILL: Record<string, string> = {
  ADMIN: "bg-rose-100 text-rose-700",
  COORDINATOR: "bg-violet-100 text-violet-700",
  ANALYST: "bg-sky-100 text-sky-700",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

function Avatar({ name, role, size = "md" }: { name: string; role: string; size?: "sm" | "md" | "lg" }) {
  const sz = size === "sm" ? "h-8 w-8 text-xs" : size === "lg" ? "h-12 w-12 text-base" : "h-10 w-10 text-sm";
  return (
    <div className={cn("shrink-0 rounded-full flex items-center justify-center font-bold text-white select-none", sz, AVATAR_BG[role] ?? "bg-slate-500")}>
      {initials(name)}
    </div>
  );
}

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

async function fetchGroupMessages(): Promise<GroupMsg[]> {
  return customFetch<GroupMsg[]>("/api/chat/messages?limit=200");
}

async function fetchDMs(userId: number): Promise<DM[]> {
  return customFetch<DM[]>(`/api/chat/dm/${userId}`);
}

async function fetchParticipants(): Promise<Participant[]> {
  return customFetch<Participant[]>("/api/chat/participants");
}

async function fetchDMInbox(): Promise<DMPreview[]> {
  return customFetch<DMPreview[]>("/api/chat/dm-inbox");
}

async function postGroupMessage(message: string): Promise<GroupMsg> {
  return customFetch<GroupMsg>("/api/chat/messages", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

async function postDM(userId: number, message: string): Promise<DM> {
  return customFetch<DM>(`/api/chat/dm/${userId}`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

// ── Message bubble (generic) ───────────────────────────────────────────────────

function MessageBubble({
  isOwn,
  senderName,
  senderRole,
  message,
  createdAt,
  showSender,
}: {
  isOwn: boolean;
  senderName: string;
  senderRole: string;
  message: string;
  createdAt: string;
  showSender: boolean;
}) {
  return (
    <div className={cn("flex items-end gap-2 mb-1.5", isOwn ? "flex-row-reverse" : "flex-row")}>
      {!isOwn && <Avatar name={senderName} role={senderRole} size="sm" />}
      {isOwn && <div className="w-8 shrink-0" />}

      <div
        className={cn(
          "relative max-w-[65%] rounded-2xl px-3 py-2 shadow-sm",
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
        <p className="text-[13px] leading-snug break-words whitespace-pre-wrap pr-10">
          {message}
        </p>
        <span className="absolute bottom-1.5 right-2.5 text-[10px] text-gray-400">
          {formatTime(createdAt)}
        </span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Chat() {
  const { user } = useAuth();
  const { markAllRead, requestPermission, notifPermission } = useChatNotifications();

  const [conversation, setConversation] = useState<Conversation>({ type: "group" });
  const [groupMessages, setGroupMessages] = useState<GroupMsg[]>([]);
  const [dmMessages, setDmMessages] = useState<DM[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [dmInbox, setDmInbox] = useState<DMPreview[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatDenied, setChatDenied] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastGroupIdRef = useRef<number>(0);
  const lastDmIdRef = useRef<number>(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  // ── Data loading ─────────────────────────────────────────────────────────

  const loadGroupMessages = useCallback(async (initial = false) => {
    try {
      const data = await fetchGroupMessages();
      setGroupMessages(data);
      const lastId = data.length > 0 ? data[data.length - 1].id : 0;
      if (initial) scrollToBottom("instant");
      else if (lastId !== lastGroupIdRef.current) scrollToBottom("smooth");
      lastGroupIdRef.current = lastId;
    } catch (e) {
      if (typeof e === "object" && e && "status" in e && (e as { status: number }).status === 403) {
        setChatDenied(true);
      }
    }
  }, [scrollToBottom]);

  const loadDMMessages = useCallback(async (userId: number, initial = false) => {
    try {
      const data = await fetchDMs(userId);
      setDmMessages(data);
      const lastId = data.length > 0 ? data[data.length - 1].id : 0;
      if (initial) scrollToBottom("instant");
      else if (lastId !== lastDmIdRef.current) scrollToBottom("smooth");
      lastDmIdRef.current = lastId;
    } catch (e) {
      if (typeof e === "object" && e && "status" in e && (e as { status: number }).status === 403) {
        setError("Você não tem permissão para visualizar esta conversa.");
      }
    }
  }, [scrollToBottom]);

  const refreshInbox = useCallback(() => {
    fetchDMInbox().then(setDmInbox).catch(() => {});
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
    refreshInbox();
  }, [markAllRead, refreshInbox]);

  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    if (conversation.type === "group") {
      loadGroupMessages(true);
      pollingRef.current = setInterval(() => {
        loadGroupMessages();
        refreshInbox();
      }, 4000);
    } else {
      const uid = conversation.participant.id;
      lastDmIdRef.current = 0;
      loadDMMessages(uid, true);
      pollingRef.current = setInterval(() => {
        loadDMMessages(uid);
        refreshInbox();
      }, 4000);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [conversation, loadGroupMessages, loadDMMessages, refreshInbox]);

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

  // ── Handlers ─────────────────────────────────────────────────────────────

  const selectConversation = (conv: Conversation) => {
    setInput("");
    setError(null);
    setShowEmoji(false);
    setConversation(conv);
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

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      if (conversation.type === "group") {
        const msg = await postGroupMessage(text);
        setGroupMessages((p) => [...p, msg]);
        lastGroupIdRef.current = msg.id;
      } else {
        const msg = await postDM(conversation.participant.id, text);
        setDmMessages((p) => [...p, msg]);
        lastDmIdRef.current = msg.id;
        refreshInbox();
      }
      setInput("");
      setTimeout(() => scrollToBottom("smooth"), 50);
      inputRef.current?.focus();
    } catch {
      setError("Não foi possível enviar. Tente novamente.");
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

  // ── Derived state ─────────────────────────────────────────────────────────

  const inboxByPartner = new Map(dmInbox.map((d) => [d.partnerId, d]));

  const lastGroupMessage = groupMessages.length > 0 ? groupMessages[groupMessages.length - 1] : null;

  const isGroupSelected = conversation.type === "group";
  const selectedParticipantId = conversation.type === "dm" ? conversation.participant.id : null;

  const currentMessages: { id: number; senderId: number; message: string; createdAt: string; senderName: string; senderRole: string }[] =
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
      <div className="w-[300px] flex flex-col bg-white dark:bg-[#1f2c34] border-r border-border shrink-0">

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
                    <Avatar name={p.name} role={p.role} size="lg" />
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
      <div className="flex flex-1 flex-col min-w-0">

        {/* Chat header */}
        <div className="flex items-center gap-3 px-4 h-16 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-border shrink-0">
          {!isGroupSelected && (
            <button
              onClick={() => selectConversation({ type: "group" })}
              className="p-1.5 rounded-full hover:bg-muted transition-colors shrink-0 md:hidden"
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
              <Avatar name={conversation.participant.name} role={conversation.participant.role} size="md" />
            ) : null}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-none truncate">{headerTitle}</p>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              {!isGroupSelected && <Lock className="h-3 w-3 shrink-0" />}
              {headerSub}
            </p>
          </div>
        </div>

        {/* Messages area */}
        <div
          className="flex-1 overflow-y-auto px-4 py-3"
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
              return (
                <div key={msg.id}>
                  {showDate && (
                    <div className="flex justify-center my-3">
                      <span className="bg-white/80 dark:bg-[#182229]/80 text-xs text-gray-600 px-3 py-1 rounded-full shadow-sm">
                        {dateLabel}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    isOwn={isOwn}
                    senderName={msg.senderName}
                    senderRole={msg.senderRole}
                    message={msg.message}
                    createdAt={msg.createdAt}
                    showSender={isGroupSelected}
                  />
                </div>
              );
            });
          })()}
          <div ref={bottomRef} />
        </div>

        {/* Input footer */}
        <div className="relative px-3 py-3 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-border shrink-0">

          {/* Emoji Picker */}
          {showEmoji && (
            <div ref={emojiPickerRef} className="absolute bottom-full mb-2 left-3 z-50 shadow-xl rounded-xl overflow-hidden">
              <EmojiPicker
                onEmojiClick={handleEmojiClick}
                theme={Theme.LIGHT}
                lazyLoadEmojis
                searchPlaceholder="Pesquisar emoji..."
                height={380}
                width={300}
              />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 mb-2 bg-destructive/10 border border-destructive/20 text-destructive text-xs px-3 py-2 rounded-lg">
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)}><X className="h-3 w-3" /></button>
            </div>
          )}

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
                  isGroupSelected
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
              disabled={!input.trim() || sending}
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
