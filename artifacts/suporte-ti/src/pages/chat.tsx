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
import { Send, Users, Smile, BellOff, Bell, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMsg {
  id: number;
  senderId: number;
  message: string;
  createdAt: string;
  sender: { id: number; name: string; role: string };
}

interface Participant {
  id: number;
  name: string;
  role: string;
  uf: string;
  municipality: string;
}

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

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

function Avatar({ name, role, size = "md" }: { name: string; role: string; size?: "sm" | "md" | "lg" }) {
  const sz =
    size === "sm" ? "h-8 w-8 text-xs" : size === "lg" ? "h-12 w-12 text-base" : "h-10 w-10 text-sm";
  const bg = AVATAR_BG[role] ?? "bg-slate-500";
  return (
    <div className={cn("shrink-0 rounded-full flex items-center justify-center font-bold text-white select-none", sz, bg)}>
      {initials(name)}
    </div>
  );
}

async function fetchMessages(): Promise<ChatMsg[]> {
  return customFetch<ChatMsg[]>("/api/chat/messages?limit=200");
}

async function fetchParticipants(): Promise<Participant[]> {
  return customFetch<Participant[]>("/api/chat/participants");
}

async function postMessage(message: string): Promise<ChatMsg> {
  return customFetch<ChatMsg>("/api/chat/messages", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (same(d, today)) return "Hoje";
  if (same(d, yesterday)) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function Chat() {
  const { user } = useAuth();
  const { markAllRead, requestPermission, notifPermission } = useChatNotifications();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastIdRef = useRef<number>(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  const loadMessages = useCallback(async (initial = false) => {
    try {
      const data = await fetchMessages();
      setMessages(data);
      const lastId = data.length > 0 ? data[data.length - 1].id : 0;
      if (initial) {
        scrollToBottom("instant");
      } else if (lastId !== lastIdRef.current) {
        scrollToBottom("smooth");
      }
      lastIdRef.current = lastId;
    } catch {
      // retry silently
    }
  }, [scrollToBottom]);

  useEffect(() => {
    markAllRead();
    loadMessages(true);
    fetchParticipants().then(setParticipants).catch(() => {});
    pollingRef.current = setInterval(() => loadMessages(), 4000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [loadMessages, markAllRead]);

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

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    const emoji = emojiData.emoji;
    const ta = inputRef.current;
    if (!ta) {
      setInput((prev) => prev + emoji);
      return;
    }
    const start = ta.selectionStart ?? input.length;
    const end = ta.selectionEnd ?? input.length;
    const newValue = input.slice(0, start) + emoji + input.slice(end);
    setInput(newValue);
    // restore cursor after emoji
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
      const msg = await postMessage(text);
      setMessages((prev) => [...prev, msg]);
      lastIdRef.current = msg.id;
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

  const lastMessageByUser: Record<number, ChatMsg> = {};
  for (const m of messages) {
    lastMessageByUser[m.senderId] = m;
  }

  return (
    <div className="flex h-full overflow-hidden bg-[#f0f2f5] dark:bg-[#111b21]">

      {/* ── LEFT PANEL ── */}
      <div className="w-[320px] flex flex-col bg-white dark:bg-[#1f2c34] border-r border-border shrink-0">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 h-16 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-border shrink-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Users className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-none">Equipe Interna</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {participants.length} {participants.length === 1 ? "membro" : "membros"}
            </p>
          </div>
          {/* Notification toggle */}
          <button
            onClick={requestPermission}
            title={
              notifPermission === "granted"
                ? "Notificações ativas"
                : notifPermission === "denied"
                ? "Notificações bloqueadas no navegador"
                : "Ativar notificações"
            }
            className="p-1.5 rounded-full hover:bg-muted transition-colors"
          >
            {notifPermission === "granted" ? (
              <Bell className="h-4 w-4 text-green-500" />
            ) : notifPermission === "denied" ? (
              <BellOff className="h-4 w-4 text-destructive" />
            ) : (
              <Bell className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </div>

        {/* Search bar visual */}
        <div className="px-3 py-2 border-b border-border bg-white dark:bg-[#1f2c34]">
          <div className="flex items-center gap-2 rounded-lg bg-[#f0f2f5] dark:bg-[#2a3942] px-3 py-2">
            <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-xs text-muted-foreground">Pesquisar</span>
          </div>
        </div>

        {/* Participants list */}
        <div className="flex-1 overflow-y-auto">
          {/* Pinned group */}
          <div className="flex items-center gap-3 px-4 py-3 bg-[#f0f9ff] dark:bg-[#182229] border-b-2 border-primary/30 cursor-default">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Users className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold truncate">Grupo Geral</p>
                {messages.length > 0 && (
                  <span className="text-[10px] text-muted-foreground ml-2 shrink-0">
                    {formatTime(messages[messages.length - 1].createdAt)}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {messages.length > 0
                  ? `${messages[messages.length - 1].sender.name}: ${messages[messages.length - 1].message}`
                  : "Nenhuma mensagem ainda"}
              </p>
            </div>
          </div>

          {/* Members */}
          <div className="pt-1">
            <p className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Membros
            </p>
            {participants.map((p) => {
              const lastMsg = lastMessageByUser[p.id];
              const isMe = p.id === user?.id;
              return (
                <div
                  key={p.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 border-b border-border/50 transition-colors",
                    isMe ? "bg-primary/5" : "hover:bg-[#f5f6f6] dark:hover:bg-[#2a3942]"
                  )}
                >
                  <div className="relative shrink-0">
                    <Avatar name={p.name} role={p.role} size="lg" />
                    {isMe && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-green-500 border-2 border-white dark:border-[#1f2c34]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate leading-none">
                      {p.name}
                      {isMe && (
                        <span className="ml-1 text-[10px] text-muted-foreground font-normal">(Você)</span>
                      )}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-semibold", ROLE_PILL[p.role] ?? "bg-gray-100 text-gray-600")}>
                        {ROLE_LABELS[p.role] ?? p.role}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{p.uf}</span>
                    </div>
                    {lastMsg && (
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">{lastMsg.message}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="flex flex-1 flex-col min-w-0">

        {/* Chat header */}
        <div className="flex items-center gap-3 px-4 h-16 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-border shrink-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Grupo Geral</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {participants.map((p) => p.name.split(" ")[0]).join(", ")}
            </p>
          </div>
        </div>

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto px-4 py-3"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            backgroundColor: "#e5ddd5",
          }}
        >
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <div className="h-16 w-16 rounded-full bg-white/80 flex items-center justify-center shadow">
                <Smile className="h-8 w-8 text-primary/40" />
              </div>
              <p className="text-sm text-gray-600 font-medium">Nenhuma mensagem ainda</p>
              <p className="text-xs text-gray-500">Seja o primeiro a escrever!</p>
            </div>
          )}

          {(() => {
            let renderLastDate = "";
            return messages.map((msg) => {
              const dateLabel = formatDateLabel(msg.createdAt);
              const showDate = dateLabel !== renderLastDate;
              renderLastDate = dateLabel;
              const isOwn = msg.senderId === user?.id;

              return (
                <div key={msg.id}>
                  {showDate && (
                    <div className="flex justify-center my-3">
                      <span className="bg-white/80 dark:bg-[#182229]/80 text-xs text-gray-600 dark:text-gray-300 px-3 py-1 rounded-full shadow-sm">
                        {dateLabel}
                      </span>
                    </div>
                  )}

                  <div className={cn("flex items-end gap-2 mb-1.5", isOwn ? "flex-row-reverse" : "flex-row")}>
                    {!isOwn && <Avatar name={msg.sender.name} role={msg.sender.role} size="sm" />}

                    <div
                      className={cn(
                        "relative max-w-[65%] rounded-2xl px-3 py-2 shadow-sm",
                        isOwn
                          ? "bg-[#d9fdd3] dark:bg-[#005c4b] rounded-br-sm text-gray-800 dark:text-white"
                          : "bg-white dark:bg-[#202c33] rounded-bl-sm text-gray-800 dark:text-white"
                      )}
                    >
                      {!isOwn && (
                        <p className="text-[11px] font-semibold mb-0.5" style={{ color: ROLE_COLOR[msg.sender.role] ?? "#1B3B6E" }}>
                          {msg.sender.name}
                          <span className="ml-1.5 font-normal text-[10px] text-gray-400">
                            ({ROLE_LABELS[msg.sender.role] ?? msg.sender.role})
                          </span>
                        </p>
                      )}
                      <p className="text-[13px] leading-snug break-words whitespace-pre-wrap pr-10">
                        {msg.message}
                      </p>
                      <span className="absolute bottom-1.5 right-2.5 text-[10px] text-gray-400">
                        {formatTime(msg.createdAt)}
                      </span>
                    </div>
                  </div>
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
            <div
              ref={emojiPickerRef}
              className="absolute bottom-full mb-2 left-3 z-50 shadow-xl rounded-xl overflow-hidden"
            >
              <EmojiPicker
                onEmojiClick={handleEmojiClick}
                theme={Theme.LIGHT}
                lazyLoadEmojis
                searchPlaceholder="Pesquisar emoji..."
                height={380}
                width={320}
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
            {/* Emoji button */}
            <button
              type="button"
              onClick={() => setShowEmoji((v) => !v)}
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors",
                showEmoji
                  ? "bg-primary text-primary-foreground"
                  : "bg-white dark:bg-[#2a3942] text-muted-foreground hover:text-primary hover:bg-white/80 shadow-sm"
              )}
              title="Emoji"
            >
              <Smile className="h-5 w-5" />
            </button>

            {/* Text input */}
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
                placeholder="Digite uma mensagem"
                disabled={sending}
                rows={1}
                maxLength={2000}
                autoComplete="off"
                className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground leading-snug overflow-hidden w-full"
                style={{ height: "24px" }}
              />
            </div>

            {/* Send button */}
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
  );
}
