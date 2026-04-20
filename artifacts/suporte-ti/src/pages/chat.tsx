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
import { Send, Users, Smile, BellOff, Bell, X, Lock, ArrowLeft, Paperclip, Download, Trash2, FileText, FileImage, Music, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { UserAvatar } from "@/components/user/user-avatar";
import { getRoleLabel } from "@/lib/role-labels";

const EmojiPicker = lazy(() => import("emoji-picker-react"));

// ── Types ────────────────────────────────────────────────────────────────────

interface GroupMsg {
  id: number;
  senderId: number;
  message: string;
  createdAt: string;
  sender: { id: number; name: string; role: string };
  attachments: ChatAttachment[];
}

interface DM {
  id: number;
  senderId: number;
  receiverId: number;
  message: string;
  createdAt: string;
  sender: { id: number; name: string; role: string };
  receiver: { id: number; name: string; role: string };
  attachments: ChatAttachment[];
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
  USER: getRoleLabel("USER"),
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

async function postGroupMessage(message: string, attachmentIds: number[]): Promise<GroupMsg> {
  return customFetch<GroupMsg>("/api/chat/messages", {
    method: "POST",
    body: JSON.stringify({ message, attachmentIds }),
  });
}

async function postDM(userId: number, message: string, attachmentIds: number[]): Promise<DM> {
  return customFetch<DM>(`/api/chat/dm/${userId}`, {
    method: "POST",
    body: JSON.stringify({ message, attachmentIds }),
  });
}

// ── Message bubble (generic) ───────────────────────────────────────────────────

function MessageBubble({
  isOwn,
  senderId,
  senderName,
  senderRole,
  message,
  createdAt,
  showSender,
  attachments,
  onDownloadAttachment,
  onDeleteAttachment,
  canDeleteAttachment,
  getPreviewState,
  onTogglePreview,
}: {
  isOwn: boolean;
  senderId: number;
  senderName: string;
  senderRole: string;
  message: string;
  createdAt: string;
  showSender: boolean;
  attachments: ChatAttachment[];
  onDownloadAttachment: (att: ChatAttachment) => void;
  onDeleteAttachment: (att: ChatAttachment) => void;
  canDeleteAttachment: (att: ChatAttachment) => boolean;
  getPreviewState: (id: number) => AttachmentPreviewState | undefined;
  onTogglePreview: (att: ChatAttachment) => void;
}) {
  return (
    <div className={cn("flex items-end gap-2 mb-1.5", isOwn ? "flex-row-reverse" : "flex-row")}>
      {!isOwn && <UserAvatar userId={senderId} name={senderName} className="h-8 w-8" />}
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
        {message ? (
          <p className="text-[13px] leading-snug break-words whitespace-pre-wrap pr-10">
            {message}
          </p>
        ) : null}

        {attachments.length > 0 ? (
          <div className={cn("mt-2 grid gap-2", message ? "" : "pr-10")}>
            {attachments.map((att) => {
              const isImage = att.mimeType.startsWith("image/");
              const isAudio = att.mimeType.startsWith("audio/");
              const Icon = isImage ? FileImage : isAudio ? Music : FileText;
              const canInlinePreview = isImage || isAudio;
              const preview = getPreviewState(att.id);
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
                      className="rounded-md p-1 text-rose-600 hover:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-400/10"
                      onClick={() => onDeleteAttachment(att)}
                      aria-label={`Excluir ${att.filename}`}
                    >
                      <Trash2 className="h-4 w-4" />
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
        <span className="absolute bottom-1.5 right-2.5 text-[10px] text-gray-400">
          {formatTime(createdAt)}
        </span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Chat() {
  const { user, token } = useAuth();
  const { markAllRead, requestPermission, notifPermission } = useChatNotifications();
  const isMobile = useIsMobile();
  const [mobilePanel, setMobilePanel] = useState<"list" | "chat">("list");

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

  const bottomRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastGroupIdRef = useRef<number>(0);
  const lastDmIdRef = useRef<number>(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setInput("");
    setError(null);
    setShowEmoji(false);
    setConversation(conv);
    if (isMobile) setMobilePanel("chat");
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
    if (!text && !hasReady) return;
    setSending(true);
    setError(null);
    try {
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

      if (conversation.type === "group") {
        const msg = await postGroupMessage(text, attachmentIds);
        setGroupMessages((p) => [...p, msg]);
        lastGroupIdRef.current = msg.id;
      } else {
        const msg = await postDM(conversation.participant.id, text, attachmentIds);
        setDmMessages((p) => [...p, msg]);
        lastDmIdRef.current = msg.id;
        refreshInbox();
      }
      setInput("");
      setDraftAttachments((prev) => {
        for (const p of prev) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
        return [];
      });
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
    return user.role === "ADMIN" || att.uploaderId === user.id;
  };

  const deleteAttachment = async (att: ChatAttachment) => {
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
    } catch {
      setError("Não foi possível excluir o anexo.");
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

  // ── Derived state ─────────────────────────────────────────────────────────

  const inboxByPartner = new Map(dmInbox.map((d) => [d.partnerId, d]));

  const lastGroupMessage = groupMessages.length > 0 ? groupMessages[groupMessages.length - 1] : null;

  const isGroupSelected = conversation.type === "group";
  const selectedParticipantId = conversation.type === "dm" ? conversation.participant.id : null;

  const currentMessages: Array<{
    id: number;
    senderId: number;
    message: string;
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
                    senderId={msg.senderId}
                    senderName={msg.senderName}
                    senderRole={msg.senderRole}
                    message={msg.message}
                    createdAt={msg.createdAt}
                    showSender={isGroupSelected}
                    attachments={msg.attachments}
                    onDownloadAttachment={downloadAttachment}
                    onDeleteAttachment={deleteAttachment}
                    canDeleteAttachment={canDeleteAttachment}
                    getPreviewState={getPreviewState}
                    onTogglePreview={togglePreview}
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

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.txt,.zip,.mp3,.wav,.m4a,.ogg"
            className="hidden"
            onChange={(e) => handlePickFiles(e.target.files)}
          />

          {draftAttachments.length > 0 ? (
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
              disabled={sending}
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
              disabled={(sending || (!input.trim() && !draftAttachments.some((a) => a.status === "ready" || a.status === "uploaded")))}
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
