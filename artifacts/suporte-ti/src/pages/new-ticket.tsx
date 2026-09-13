import { useEffect, useState, useRef, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, Link } from "wouter";
import { useCreateTicket, TicketType, TicketPriority } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Paperclip, X, FileText, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Hardware subtype options ──────────────────────────────────────────────────

const HARDWARE_SUBTYPES = [
  "Formatação",
  "Recarga",
  "Troca",
  "Aquisição",
  "CPU",
  "Impressora",
  "Memória",
  "Teclado",
  "Mouse",
  "Cabo de rede",
  "Conector",
  "Tablet",
  "TV",
  "Transformador",
  "Cabo HDMI",
  "VGA",
  "USB",
  "DVI",
  "Força",
  "Outro",
];

// ── Form schema ───────────────────────────────────────────────────────────────

const ticketSchema = z.object({
  type: z.nativeEnum(TicketType),
  title: z.string().min(5, "Título muito curto (mínimo 5 caracteres)"),
  description: z.string().min(10, "Descrição muito curta (mínimo 10 caracteres)"),
  establishment: z
    .string()
    .trim()
    .min(1, "Estabelecimento / Unidade de saúde é obrigatório")
    .max(255, "Máximo de 255 caracteres"),
  priority: z.nativeEnum(TicketPriority),
  hardwareSubtype: z.string().optional(),
});

type TicketForm = z.infer<typeof ticketSchema>;

// ── Helpers ────────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB (fotos de câmera de celular costumam passar de 3 MB)
const MAX_FILES = 3;
const TICKET_DRAFT_STATE_KEY = "suporte-ti:tickets:new:draft:v1";
const TICKET_DRAFT_STATE_BACKUP_KEY = "suporte-ti:tickets:new:draft:v1:bak";
const TICKET_DRAFT_DB_NAME = "suporte-ti";
const TICKET_DRAFT_DB_VERSION = 1;
const TICKET_DRAFT_FILES_STORE = "ticketDraftFiles";

const ALLOWED_MIME = [
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp",
  "image/heic", "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
];

const ALLOWED_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt",
];
const ATTACHMENT_LOG_ENDPOINT = "/api/attachment-diagnostics/logs";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mime: string) {
  return mime.startsWith("image/");
}

function getFileExtension(name: string): string {
  const lastDot = name.lastIndexOf(".");
  return lastDot >= 0 ? name.slice(lastDot).toLowerCase() : "";
}

function describeFile(file: File): string {
  return `${file.name || "sem-nome"} (${file.type || "sem-tipo"}, ${formatBytes(file.size)})`;
}

function getAttachmentFileContext(file: File) {
  return {
    name: file.name || null,
    size: file.size,
    type: file.type || null,
    lastModified: file.lastModified,
    extension: getFileExtension(file.name),
    webkitRelativePath: "webkitRelativePath" in file ? (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? null : null,
  };
}

function getAttachmentSessionId(): string {
  try {
    const key = "suporte-ti:attachment:debug-session";
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const next = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.sessionStorage.setItem(key, next);
    return next;
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function logAttachmentToConsole(level: "info" | "warn" | "error", event: string, context: Record<string, unknown>) {
  const payload = {
    source: "attachment-debug",
    event,
    timestamp: new Date().toISOString(),
    ...context,
  };
  if (level === "error") {
    console.error("[attachment-debug]", payload);
  } else if (level === "warn") {
    console.warn("[attachment-debug]", payload);
  } else {
    console.log("[attachment-debug]", payload);
  }
}

function sendAttachmentLog(level: "info" | "warn" | "error", event: string, context: Record<string, unknown>) {
  try {
    const token = window.localStorage.getItem("ti_support_token");
    if (!token) return;
    void fetch(ATTACHMENT_LOG_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        level,
        event,
        sessionId: getAttachmentSessionId(),
        context,
      }),
      keepalive: true,
    }).catch((err) => {
      console.error("[attachment-debug] failed-to-send-backend-log", {
        event,
        message: err instanceof Error ? err.message : String(err),
      });
    });
  } catch (err) {
    console.error("[attachment-debug] unexpected-log-dispatch-error", {
      event,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function isAllowedFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  if (ALLOWED_MIME.includes(file.type)) return true;
  if (!file.type || file.type === "application/octet-stream") {
    return ALLOWED_EXTENSIONS.includes(getFileExtension(file.name));
  }
  return ALLOWED_EXTENSIONS.includes(getFileExtension(file.name));
}

type TicketDraftFileMeta = {
  key: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  dataUrl?: string;
};

type TicketDraftState = {
  version: 1;
  actorUserId: number;
  savedAt: number;
  form: TicketForm;
  files: TicketDraftFileMeta[];
};

type DraftFileRecord = TicketDraftFileMeta & {
  draftId: string;
  buffer: ArrayBuffer;
};

function toDraftId(actorUserId: number): string {
  return String(actorUserId);
}

function makeFileKey(f: File): string {
  return `${f.name}::${f.size}::${f.lastModified}::${f.type}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function openDraftDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("indexedDB_unavailable"));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TICKET_DRAFT_DB_NAME, TICKET_DRAFT_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TICKET_DRAFT_FILES_STORE)) {
        const store = db.createObjectStore(TICKET_DRAFT_FILES_STORE, { keyPath: "key" });
        store.createIndex("draftId", "draftId", { unique: false });
      } else {
        const tx = req.transaction;
        const store = tx?.objectStore(TICKET_DRAFT_FILES_STORE);
        if (store && !store.indexNames.contains("draftId")) {
          store.createIndex("draftId", "draftId", { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb_open_failed"));
  });
}

function idbTx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TICKET_DRAFT_FILES_STORE, mode);
    const store = tx.objectStore(TICKET_DRAFT_FILES_STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb_request_failed"));
  });
}

async function idbPutDraftFile(db: IDBDatabase, rec: DraftFileRecord): Promise<void> {
  await idbTx(db, "readwrite", (s) => s.put(rec));
}

async function idbGetDraftFile(db: IDBDatabase, key: string): Promise<DraftFileRecord | null> {
  const res = await idbTx<DraftFileRecord | undefined>(db, "readonly", (s) => s.get(key));
  return res ?? null;
}

async function idbDeleteDraftFilesNotIn(db: IDBDatabase, draftId: string, keepKeys: Set<string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TICKET_DRAFT_FILES_STORE, "readwrite");
    const store = tx.objectStore(TICKET_DRAFT_FILES_STORE);
    const idx = store.index("draftId");
    const cursorReq = idx.openCursor(IDBKeyRange.only(draftId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const key = String(cursor.primaryKey);
      if (!keepKeys.has(key)) {
        cursor.delete();
      }
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error("indexeddb_cursor_failed"));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb_tx_failed"));
  });
}

function safeParseDraft(raw: string | null, actorUserId: number): TicketDraftState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TicketDraftState;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== 1) return null;
    if (parsed.actorUserId !== actorUserId) return null;
    if (!parsed.form || typeof parsed.form !== "object") return null;
    if (!Array.isArray(parsed.files)) return null;
    for (const f of parsed.files) {
      if (!f || typeof f !== "object") return null;
      if (typeof (f as any).key !== "string") return null;
      if (typeof (f as any).name !== "string") return null;
      if (typeof (f as any).type !== "string") return null;
      if (typeof (f as any).size !== "number") return null;
      if (typeof (f as any).lastModified !== "number") return null;
      if ((f as any).dataUrl != null && typeof (f as any).dataUrl !== "string") return null;
    }
    if (typeof parsed.form.title !== "string") return null;
    if (typeof parsed.form.description !== "string") return null;
    if (typeof parsed.form.establishment !== "string") return null;
    if (parsed.form.type !== TicketType.SOFTWARE && parsed.form.type !== TicketType.HARDWARE) return null;
    if (parsed.form.priority !== TicketPriority.LOW && parsed.form.priority !== TicketPriority.MEDIUM && parsed.form.priority !== TicketPriority.HIGH) return null;
    if (parsed.form.hardwareSubtype != null && typeof parsed.form.hardwareSubtype !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDraftStateWithBackup(next: TicketDraftState): void {
  if (typeof window === "undefined") return;
  try {
    const current = window.localStorage.getItem(TICKET_DRAFT_STATE_KEY);
    if (current) window.localStorage.setItem(TICKET_DRAFT_STATE_BACKUP_KEY, current);
    window.localStorage.setItem(TICKET_DRAFT_STATE_KEY, JSON.stringify(next));
  } catch {
  }
}

function loadDraftStateWithBackup(actorUserId: number): TicketDraftState | null {
  if (typeof window === "undefined") return null;
  const primary = safeParseDraft(window.localStorage.getItem(TICKET_DRAFT_STATE_KEY), actorUserId);
  if (primary) return primary;
  return safeParseDraft(window.localStorage.getItem(TICKET_DRAFT_STATE_BACKUP_KEY), actorUserId);
}

function clearDraftState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TICKET_DRAFT_STATE_KEY);
    window.localStorage.removeItem(TICKET_DRAFT_STATE_BACKUP_KEY);
  } catch {
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewTicket() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const createMutation = useCreateTicket();
  const [isMobile] = useState(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    return window.matchMedia("(max-width: 767px)").matches
      || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  });

  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const nativeFileListenerAttachedRef = useRef(false);
  const nativeCameraListenerAttachedRef = useRef(false);
  const selectedFilesRef = useRef<File[]>([]);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [autoSaveDetail, setAutoSaveDetail] = useState<string>("");
  const saveTimerRef = useRef<number | null>(null);
  const saveSeqRef = useRef<number>(0);
  const lastSavedAtRef = useRef<number | null>(null);
  const restoringRef = useRef<boolean>(false);
  const filePickerActiveRef = useRef<boolean>(false);
  const filePickerResetTimerRef = useRef<number | null>(null);
  const filePickerProbeTimerRef = useRef<number | null>(null);
  const filePickerProbesScheduledRef = useRef<number>(0);
  const lastProcessedSelectionRef = useRef<{ key: string; at: number } | null>(null);

  const form = useForm<TicketForm>({
    resolver: zodResolver(ticketSchema),
    mode: "onChange",
    defaultValues: {
      type: TicketType.SOFTWARE,
      title: "",
      description: "",
      establishment: user?.establishment ?? "",
      priority: TicketPriority.LOW,
      hardwareSubtype: undefined,
    },
  });

  const selectedType = form.watch("type");
  const selectedPriority = form.watch("priority");

  const reportAttachmentEvent = useCallback((
    level: "info" | "warn" | "error",
    event: string,
    context: Record<string, unknown> = {},
  ) => {
    const payload = {
      route: "/chamados/novo",
      userId: user?.id ?? null,
      userRole: user?.role ?? null,
      isMobile,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      href: typeof window !== "undefined" ? window.location.href : null,
      ...context,
    };
    logAttachmentToConsole(level, event, payload);
    sendAttachmentLog(level, event, payload);
  }, [isMobile, user?.id, user?.role]);

  useEffect(() => {
    reportAttachmentEvent("info", "attachment.page.mounted", {});
  }, [reportAttachmentEvent]);

  useEffect(() => {
    reportAttachmentEvent("info", "attachment.platform_detection", {
      isMobile,
    });
  }, [isMobile, reportAttachmentEvent]);

  useEffect(() => {
    if (user?.establishment) {
      form.setValue("establishment", user.establishment, { shouldValidate: true });
    }
  }, [user?.establishment, form]);

  useEffect(() => {
    if (selectedType !== TicketType.SOFTWARE && selectedType !== TicketType.HARDWARE) {
      form.setValue("type", TicketType.SOFTWARE, { shouldValidate: true, shouldDirty: false });
      form.setValue("hardwareSubtype", undefined, { shouldValidate: false, shouldDirty: false });
    }
  }, [selectedType, form]);

  useEffect(() => {
    if (
      selectedPriority !== TicketPriority.LOW &&
      selectedPriority !== TicketPriority.MEDIUM &&
      selectedPriority !== TicketPriority.HIGH
    ) {
      form.setValue("priority", TicketPriority.LOW, { shouldValidate: true, shouldDirty: false });
    }
  }, [selectedPriority, form]);

  useEffect(() => {
    return () => {
      for (const url of filePreviews) {
        if (url) URL.revokeObjectURL(url);
      }
    };
  }, [filePreviews]);

  const runAutoSave = useCallback(async (reason?: string) => {
    if (!user?.id) return;
    if (restoringRef.current) return;
    setAutoSaveStatus("saving");
    if (reason) setAutoSaveDetail(reason);
    const seq = ++saveSeqRef.current;
    try {
      const actorUserId = user.id;
      const draftId = toDraftId(actorUserId);
      const values = form.getValues();
      const safeType =
        values.type === TicketType.SOFTWARE || values.type === TicketType.HARDWARE
          ? values.type
          : TicketType.SOFTWARE;
      const safePriority =
        values.priority === TicketPriority.LOW ||
        values.priority === TicketPriority.MEDIUM ||
        values.priority === TicketPriority.HIGH
          ? values.priority
          : TicketPriority.LOW;
      const normalized: TicketForm = {
        type: safeType,
        title: values.title ?? "",
        description: values.description ?? "",
        establishment: values.establishment ?? "",
        priority: safePriority,
        hardwareSubtype: safeType === TicketType.HARDWARE ? values.hardwareSubtype : undefined,
      };

      let metas: TicketDraftFileMeta[] = files.map((f) => ({
        key: `${draftId}::${makeFileKey(f)}`,
        name: f.name,
        type: f.type,
        size: f.size,
        lastModified: f.lastModified,
      }));

      try {
        const db = await openDraftDb();
        const keepKeys = new Set(metas.map((m) => m.key));
        await Promise.all(
          files.map(async (f) => {
            const metaKey = `${draftId}::${makeFileKey(f)}`;
            const existing = await idbGetDraftFile(db, metaKey);
            if (existing && existing.size === f.size && existing.lastModified === f.lastModified && existing.type === f.type && existing.name === f.name) {
              return;
            }
            const buffer = await f.arrayBuffer();
            const rec: DraftFileRecord = {
              draftId,
              key: metaKey,
              name: f.name,
              type: f.type,
              size: f.size,
              lastModified: f.lastModified,
              buffer,
            };
            await idbPutDraftFile(db, rec);
          })
        );
        await idbDeleteDraftFilesNotIn(db, draftId, keepKeys);
      } catch {
        metas = await Promise.all(
          files.map(async (f) => {
            const buffer = await f.arrayBuffer();
            const dataUrl = `data:${f.type};base64,${arrayBufferToBase64(buffer)}`;
            return {
              key: `${draftId}::${makeFileKey(f)}`,
              name: f.name,
              type: f.type,
              size: f.size,
              lastModified: f.lastModified,
              dataUrl,
            };
          })
        );
      }

      const next: TicketDraftState = {
        version: 1,
        actorUserId,
        savedAt: Date.now(),
        form: normalized,
        files: metas,
      };
      saveDraftStateWithBackup(next);
      lastSavedAtRef.current = next.savedAt;
      if (seq === saveSeqRef.current) {
        setAutoSaveStatus("saved");
        setAutoSaveDetail("Salvo automaticamente");
      }
    } catch {
      if (seq === saveSeqRef.current) {
        setAutoSaveStatus("error");
        setAutoSaveDetail("Falha ao salvar automaticamente");
      }
    }
  }, [user?.id, form, files]);

  const scheduleAutoSave = useCallback((reason?: string) => {
    if (!user?.id) return;
    if (restoringRef.current) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setAutoSaveStatus("saving");
    if (reason) setAutoSaveDetail(reason);
    saveTimerRef.current = window.setTimeout(() => {
      void runAutoSave();
    }, 250);
  }, [user?.id, runAutoSave]);

  const restoreDraft = useCallback(async () => {
    if (!user?.id) return;
    if (restoringRef.current) return;

    restoringRef.current = true;
    const state = loadDraftStateWithBackup(user.id);
    if (!state) {
      restoringRef.current = false;
      return;
    }
    if (lastSavedAtRef.current != null && state.savedAt <= lastSavedAtRef.current) {
      restoringRef.current = false;
      return;
    }

    try {
      form.reset(state.form, { keepDefaultValues: true });
      const restoredFiles: File[] = [];
      const newPreviews: string[] = [];

      let restoredFromIdb = false;
      try {
        const db = await openDraftDb();
        for (const meta of state.files) {
          const rec = await idbGetDraftFile(db, meta.key);
          if (!rec) continue;
          if (rec.size !== meta.size || rec.type !== meta.type || rec.name !== meta.name) continue;
          const file = new File([rec.buffer], rec.name, { type: rec.type, lastModified: rec.lastModified });
          restoredFiles.push(file);
          newPreviews.push(isImage(file.type) ? URL.createObjectURL(file) : "");
        }
        restoredFromIdb = true;
      } catch {
      }

      if (!restoredFromIdb) {
        for (const meta of state.files) {
          if (!meta.dataUrl) continue;
          const prefix = `data:${meta.type};base64,`;
          const raw = meta.dataUrl.startsWith(prefix) ? meta.dataUrl.slice(prefix.length) : null;
          if (!raw) continue;
          const buffer = base64ToArrayBuffer(raw);
          if (buffer.byteLength !== meta.size) continue;
          const file = new File([buffer], meta.name, { type: meta.type, lastModified: meta.lastModified });
          restoredFiles.push(file);
          newPreviews.push(isImage(file.type) ? URL.createObjectURL(file) : "");
        }
      }

      // Restaurar o rascunho é assíncrono (lê o IndexedDB). Se, enquanto isso
      // rodava, o usuário já selecionou um arquivo (ex.: no Android, ao
      // voltar da câmera com a página recarregada por falta de memória, o
      // navegador reenvia a seleção da câmera para o input assim que a
      // página termina de montar — quase sempre mais rápido que essa leitura
      // do IndexedDB), não sobrescreva a seleção atual com o rascunho antigo.
      if (selectedFilesRef.current.length > 0) {
        reportAttachmentEvent("warn", "attachment.draft.restore_skipped_due_to_pending_selection", {
          pendingCount: selectedFilesRef.current.length,
        });
        restoringRef.current = false;
        return;
      }

      for (const url of filePreviews) {
        if (url) URL.revokeObjectURL(url);
      }
      setFiles(restoredFiles);
      setFilePreviews(newPreviews);
      lastSavedAtRef.current = state.savedAt;
      setAutoSaveStatus("saved");
      setAutoSaveDetail("Rascunho recuperado");
    } catch {
      setAutoSaveStatus("error");
      setAutoSaveDetail("Falha ao recuperar rascunho");
    } finally {
      restoringRef.current = false;
    }
  }, [user?.id, form, filePreviews]);

  useEffect(() => {
    if (!user?.id) return;
    void restoreDraft();
    // Sem `restoreDraft` nas deps de propósito: essa função muda de
    // identidade toda vez que `filePreviews` muda (precisa do valor atual
    // para revogar URLs antigas), então se ficasse na lista de deps este
    // efeito re-executaria a cada anexo adicionado/removido, tentando
    // restaurar o rascunho de novo no meio da sessão. Só deve rodar quando
    // o usuário muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const onVisibilityChange = () => {
      if (filePickerActiveRef.current) {
        reportAttachmentEvent("info", "attachment.autosave.skipped_file_picker_active", {
          visibilityState: document.visibilityState,
        });
        return;
      }
      if (document.visibilityState === "hidden") {
        void runAutoSave("Salvando...");
        return;
      }
    };
    const onBeforeUnload = () => { void runAutoSave("Salvando..."); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [user?.id, restoreDraft, runAutoSave]);

  useEffect(() => {
    const sub = form.watch(() => scheduleAutoSave());
    return () => sub.unsubscribe();
  }, [form, scheduleAutoSave]);

  useEffect(() => {
    scheduleAutoSave();
  }, [files, scheduleAutoSave]);

  // ── File handling ─────────────────────────────────────────────────────────

  const addFiles = useCallback((incoming: File[], origin: string) => {
    reportAttachmentEvent("info", "attachment.files.received", {
      origin,
      incomingCount: incoming.length,
      incomingFiles: incoming.map(getAttachmentFileContext),
      currentStateCount: files.length,
    });
    const errors: string[] = [];
    const accepted: File[] = [];

    for (const f of incoming) {
      if (files.length + accepted.length >= MAX_FILES) {
        errors.push(`Máximo de ${MAX_FILES} arquivos permitidos.`);
        reportAttachmentEvent("warn", "attachment.files.limit_reached", {
          origin,
          currentStateCount: files.length,
          attemptedFile: getAttachmentFileContext(f),
        });
        break;
      }
      if (!isAllowedFile(f)) {
        errors.push(`"${describeFile(f)}": tipo de arquivo não permitido.`);
        reportAttachmentEvent("warn", "attachment.files.rejected_type", {
          origin,
          file: getAttachmentFileContext(f),
        });
        continue;
      }
      if (f.size > MAX_FILE_SIZE) {
        errors.push(`"${describeFile(f)}": arquivo muito grande (máx. 8 MB).`);
        reportAttachmentEvent("warn", "attachment.files.rejected_size", {
          origin,
          file: getAttachmentFileContext(f),
          maxFileSize: MAX_FILE_SIZE,
        });
        continue;
      }
      accepted.push(f);
    }

    setFileErrors(errors);
    if (errors.length > 0) {
      toast({
        title: "Alguns arquivos não puderam ser adicionados",
        description: errors[0],
        variant: "destructive",
      });
    }
    if (!accepted.length) return;

    const newFiles = [...files, ...accepted].slice(0, MAX_FILES);
    reportAttachmentEvent("info", "attachment.files.accepted", {
      origin,
      acceptedCount: accepted.length,
      acceptedFiles: accepted.map(getAttachmentFileContext),
      finalCount: newFiles.length,
    });
    selectedFilesRef.current = newFiles;
    setFiles(newFiles);

    // Generate previews
    const previews = [...filePreviews];
    for (const f of accepted.slice(0, MAX_FILES - files.length)) {
      if (isImage(f.type)) {
        previews.push(URL.createObjectURL(f));
      } else {
        previews.push("");
      }
    }
    setFilePreviews(previews);
  }, [files, filePreviews, reportAttachmentEvent, toast]);

  const removeFile = (idx: number) => {
    reportAttachmentEvent("info", "attachment.files.removed", {
      index: idx,
      removedFile: files[idx] ? getAttachmentFileContext(files[idx]) : null,
    });
    if (filePreviews[idx]) URL.revokeObjectURL(filePreviews[idx]);
    setFiles((p) => {
      const next = p.filter((_, i) => i !== idx);
      selectedFilesRef.current = next;
      return next;
    });
    setFilePreviews((p) => p.filter((_, i) => i !== idx));
    setFileErrors([]);
  };

  const handleSelectedFiles = (selected: File[]) => {
    if (filePickerResetTimerRef.current) {
      window.clearTimeout(filePickerResetTimerRef.current);
      filePickerResetTimerRef.current = null;
    }
    filePickerActiveRef.current = false;
    selectedFilesRef.current = selected;
    reportAttachmentEvent("info", "attachment.input.selection_detected", {
      selectedCount: selected.length,
      selectedFiles: selected.map(getAttachmentFileContext),
      inputValuePresent: Boolean(fileInputRef.current?.value),
    });
    if (selected.length === 0) {
      setFileErrors(["Nenhum arquivo foi retornado pelo seletor do dispositivo."]);
      toast({
        title: "Nenhum arquivo selecionado",
        description: "O dispositivo não retornou um arquivo válido para anexar.",
        variant: "destructive",
      });
      reportAttachmentEvent("error", "attachment.input.empty_selection", {
        inputValue: fileInputRef.current?.value ?? null,
      });
      return;
    }

    // No mobile o mesmo <input type="file"> costuma disparar até 3 eventos
    // para UMA única seleção do usuário (evento "input" nativo, "change"
    // nativo e o onChange do React — todos ficam anexados de propósito como
    // fallback, porque nem todo navegador dispara os três de forma
    // confiável). Sem essa checagem, a mesma foto entrava 2-3x na lista e
    // sozinha consumia o limite de MAX_FILES.
    const selectionKey = selected.map((f) => `${f.name}|${f.size}|${f.lastModified}`).join(",");
    const lastProcessed = lastProcessedSelectionRef.current;
    if (lastProcessed && lastProcessed.key === selectionKey && Date.now() - lastProcessed.at < 4000) {
      reportAttachmentEvent("info", "attachment.input.duplicate_event_ignored", {
        selectionKey,
        msSinceLastProcessed: Date.now() - lastProcessed.at,
      });
      return;
    }
    lastProcessedSelectionRef.current = { key: selectionKey, at: Date.now() };

    addFiles(selected, "input-selection");
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    reportAttachmentEvent("info", "attachment.input.change_event", {
      inputValue: e.target.value || null,
      hasFiles: Boolean(e.target.files && e.target.files.length > 0),
      fileCount: e.target.files?.length ?? 0,
    });
    handleSelectedFiles(e.target.files ? Array.from(e.target.files) : []);
    if (!isMobile) {
      e.target.value = "";
    }
  };

  const onCameraInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    reportAttachmentEvent("info", "attachment.camera.change_event", {
      inputValue: e.target.value || null,
      hasFiles: Boolean(e.target.files && e.target.files.length > 0),
      fileCount: e.target.files?.length ?? 0,
    });
    handleSelectedFiles(e.target.files ? Array.from(e.target.files) : []);
  };

  useEffect(() => {
    if (nativeFileListenerAttachedRef.current) return;
    let timer: number | null = null;
    let input: HTMLInputElement | null = null;
    let attempts = 0;

    const onNativeFileEvent = (eventType: "change" | "input") => {
      if (!input) return;
      const list = input.files ? Array.from(input.files) : [];
      reportAttachmentEvent("info", `attachment.input.native_${eventType}_event`, {
        fileCount: list.length,
        inputValue: input.value || null,
        files: list.map(getAttachmentFileContext),
      });
      if (list.length > 0) {
        handleSelectedFiles(list);
      }
    };

    const onNativeChange = () => onNativeFileEvent("change");
    const onNativeInput = () => onNativeFileEvent("input");

    const tryAttach = () => {
      attempts += 1;
      input = fileInputRef.current;
      reportAttachmentEvent("info", "attachment.input.native_listener_attempt", {
        attempt: attempts,
        inputPresent: Boolean(input),
      });
      if (!input) {
        if (attempts < 8) {
          timer = window.setTimeout(tryAttach, 200);
        }
        return;
      }

      input.addEventListener("change", onNativeChange, true);
      input.addEventListener("input", onNativeInput, true);
      nativeFileListenerAttachedRef.current = true;
      reportAttachmentEvent("info", "attachment.input.native_listener_attached", {
        inputMultiple: input.multiple,
        inputAccept: input.accept,
      });
    };

    tryAttach();

    return () => {
      if (timer) window.clearTimeout(timer);
      if (input) {
        input.removeEventListener("change", onNativeChange, true);
        input.removeEventListener("input", onNativeInput, true);
      }
      nativeFileListenerAttachedRef.current = false;
    };
  }, [handleSelectedFiles, reportAttachmentEvent]);

  useEffect(() => {
    if (nativeCameraListenerAttachedRef.current) return;
    let timer: number | null = null;
    let input: HTMLInputElement | null = null;
    let attempts = 0;

    const onNativeCameraEvent = (eventType: "change" | "input") => {
      if (!input) return;
      const list = input.files ? Array.from(input.files) : [];
      reportAttachmentEvent("info", `attachment.camera.native_${eventType}_event`, {
        fileCount: list.length,
        inputValue: input.value || null,
        files: list.map(getAttachmentFileContext),
      });
      if (list.length > 0) {
        handleSelectedFiles(list);
      }
    };

    const onNativeChange = () => onNativeCameraEvent("change");
    const onNativeInput = () => onNativeCameraEvent("input");

    const tryAttach = () => {
      attempts += 1;
      input = cameraInputRef.current;
      reportAttachmentEvent("info", "attachment.camera.native_listener_attempt", {
        attempt: attempts,
        inputPresent: Boolean(input),
      });
      if (!input) {
        if (attempts < 8) {
          timer = window.setTimeout(tryAttach, 200);
        }
        return;
      }

      input.addEventListener("change", onNativeChange, true);
      input.addEventListener("input", onNativeInput, true);
      nativeCameraListenerAttachedRef.current = true;
      reportAttachmentEvent("info", "attachment.camera.native_listener_attached", {
        inputMultiple: input.multiple,
        inputAccept: input.accept,
      });
    };

    tryAttach();

    return () => {
      if (timer) window.clearTimeout(timer);
      if (input) {
        input.removeEventListener("change", onNativeChange, true);
        input.removeEventListener("input", onNativeInput, true);
      }
      nativeCameraListenerAttachedRef.current = false;
    };
  }, [handleSelectedFiles, reportAttachmentEvent]);

  const scheduleFileInputProbe = useCallback((origin: string) => {
    if (!filePickerActiveRef.current) return;
    if (filePickerProbeTimerRef.current) {
      window.clearTimeout(filePickerProbeTimerRef.current);
      filePickerProbeTimerRef.current = null;
    }

    filePickerProbesScheduledRef.current = 0;

    const runProbe = (delayMs: number) => {
      filePickerProbeTimerRef.current = window.setTimeout(() => {
        if (!filePickerActiveRef.current) return;
        filePickerProbesScheduledRef.current += 1;
        const input = fileInputRef.current;
        const probedFiles = input?.files ? Array.from(input.files) : [];
        reportAttachmentEvent("info", "attachment.input.probe", {
          origin,
          attempt: filePickerProbesScheduledRef.current,
          delayMs,
          inputPresent: Boolean(input),
          inputValuePresent: Boolean(input?.value),
          probedCount: probedFiles.length,
          probedFiles: probedFiles.map(getAttachmentFileContext),
        });
        if (probedFiles.length > 0) {
          handleSelectedFiles(probedFiles);
          return;
        }
        if (filePickerProbesScheduledRef.current < 3) {
          runProbe(filePickerProbesScheduledRef.current === 1 ? 250 : 900);
          return;
        }
        reportAttachmentEvent("warn", "attachment.input.probe_exhausted", {
          origin,
          attempts: filePickerProbesScheduledRef.current,
        });
      }, delayMs);
    };

    runProbe(0);
  }, [handleSelectedFiles, reportAttachmentEvent]);

  useEffect(() => {
    const onWindowFocus = () => {
      if (!filePickerActiveRef.current) return;
      scheduleFileInputProbe("window-focus");
    };
    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, [scheduleFileInputProbe]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (!filePickerActiveRef.current) return;
      if (document.visibilityState !== "visible") return;
      scheduleFileInputProbe("visibility-visible");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [scheduleFileInputProbe]);

  const beginFilePickerSession = () => {
    const input = fileInputRef.current;
    reportAttachmentEvent("info", "attachment.picker.open_requested", {
      activeElement: typeof document !== "undefined" ? document.activeElement?.tagName ?? null : null,
      inputAccept: input?.accept ?? null,
      inputMultiple: input?.multiple ?? null,
    });
    filePickerActiveRef.current = true;
    if (filePickerResetTimerRef.current) {
      window.clearTimeout(filePickerResetTimerRef.current);
    }
    filePickerResetTimerRef.current = window.setTimeout(() => {
      filePickerActiveRef.current = false;
      filePickerResetTimerRef.current = null;
    }, 12000);
  };

  const openFilePicker = () => {
    const input = fileInputRef.current;
    if (!input) return;
    beginFilePickerSession();
    try {
      if (typeof (input as HTMLInputElement & { showPicker?: () => void }).showPicker === "function") {
        reportAttachmentEvent("info", "attachment.picker.show_picker", { strategy: "showPicker" });
        (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
        return;
      }
    } catch {
      reportAttachmentEvent("error", "attachment.picker.show_picker_failed", {});
    }
    reportAttachmentEvent("info", "attachment.picker.dom_click", { strategy: "input.click" });
    input.click();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files), "drop");
  };

  const clearDraftAndForm = async () => {
    const ok = window.confirm("Deseja limpar o formulário? Esta ação remove também o rascunho salvo localmente.");
    if (!ok) return;
    for (const url of filePreviews) {
      if (url) URL.revokeObjectURL(url);
    }
    selectedFilesRef.current = [];
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setFiles([]);
    setFilePreviews([]);
    setFileErrors([]);
    form.reset({
      type: TicketType.SOFTWARE,
      title: "",
      description: "",
      establishment: user?.establishment ?? "",
      priority: TicketPriority.LOW,
      hardwareSubtype: undefined,
    });
    clearDraftState();
    try {
      if (user?.id) {
        const db = await openDraftDb();
        const draftId = toDraftId(user.id);
        await idbDeleteDraftFilesNotIn(db, draftId, new Set());
      }
    } catch {
    }
    setAutoSaveStatus("idle");
    setAutoSaveDetail("Formulário limpo");
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const onSubmit = async (data: TicketForm) => {
    const inputFiles = fileInputRef.current?.files ? Array.from(fileInputRef.current.files) : [];
    const effectiveFiles = files.length > 0 ? files : selectedFilesRef.current.length > 0 ? selectedFilesRef.current : inputFiles;

    reportAttachmentEvent("info", "attachment.submit.started", {
      stateFilesCount: files.length,
      selectedFilesRefCount: selectedFilesRef.current.length,
      inputFilesCount: inputFiles.length,
      effectiveFilesCount: effectiveFiles.length,
      effectiveFiles: effectiveFiles.map(getAttachmentFileContext),
    });

    if (files.length === 0 && effectiveFiles.length > 0) {
      selectedFilesRef.current = effectiveFiles;
      setFiles(effectiveFiles);
      setFilePreviews(effectiveFiles.map((f) => (isImage(f.type) ? URL.createObjectURL(f) : "")));
      reportAttachmentEvent("info", "attachment.submit.state_rehydrated_from_input", {
        effectiveFilesCount: effectiveFiles.length,
      });
    }

    if (effectiveFiles.length === 0) {
      setFileErrors(["Envie ao menos 1 anexo obrigatório antes de abrir o chamado."]);
      reportAttachmentEvent("error", "attachment.submit.missing_attachment", {
        stateFilesCount: files.length,
        selectedFilesRefCount: selectedFilesRef.current.length,
        inputFilesCount: inputFiles.length,
      });
      toast({
        title: "Anexo obrigatório",
        description: "Adicione pelo menos 1 arquivo anexo para prosseguir.",
        variant: "destructive",
      });
      return;
    }

    // Clear subtype if not hardware
    const payload = {
      title: data.title,
      description: data.description,
      establishment: data.establishment,
      type: data.type,
      priority: data.priority,
      hardwareSubtype: data.type === TicketType.HARDWARE ? data.hardwareSubtype : undefined,
    };

    createMutation.mutate(
      { data: payload },
      {
        onSuccess: async (ticket) => {
          reportAttachmentEvent("info", "attachment.ticket_create.success", {
            ticketId: ticket.id,
            effectiveFilesCount: effectiveFiles.length,
          });
          // Upload attachments if any
          if (effectiveFiles.length > 0) {
            setUploading(true);
            try {
              const formData = new FormData();
              effectiveFiles.forEach((f) => formData.append("files", f));
              reportAttachmentEvent("info", "attachment.upload.request_started", {
                ticketId: ticket.id,
                files: effectiveFiles.map(getAttachmentFileContext),
              });
              const uploadResponse = await fetch(`/api/tickets/${ticket.id}/attachments`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${localStorage.getItem("ti_support_token")}`,
                },
                body: formData,
              });
              let serverErrorMessage: string | null = null;
              if (!uploadResponse.ok) {
                try {
                  const body = await uploadResponse.clone().json();
                  if (body && typeof body.error === "string") serverErrorMessage = body.error;
                } catch {
                  // resposta não veio em JSON; segue sem detalhe extra
                }
              }
              reportAttachmentEvent(uploadResponse.ok ? "info" : "error", "attachment.upload.response_received", {
                ticketId: ticket.id,
                status: uploadResponse.status,
                ok: uploadResponse.ok,
                serverErrorMessage,
              });
              if (!uploadResponse.ok) {
                throw new Error(serverErrorMessage || `attachments_upload_failed_${uploadResponse.status}`);
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              reportAttachmentEvent("error", "attachment.upload.exception", {
                ticketId: ticket.id,
                message,
                stack: err instanceof Error ? err.stack ?? null : null,
              });
              const isKnownServerMessage = err instanceof Error && !message.startsWith("attachments_upload_failed_");
              toast({
                title: "Chamado criado, mas erro nos anexos",
                description: isKnownServerMessage
                  ? `${message} O chamado foi aberto; você pode adicionar os anexos depois.`
                  : "O chamado foi aberto. Você pode adicionar os anexos depois.",
                variant: "destructive",
              });
            } finally {
              setUploading(false);
            }
          }

          toast({
            title: "Chamado criado com sucesso",
            description: `Protocolo #${ticket.id} gerado.`,
          });
          clearDraftState();
          try {
            if (user?.id) {
              const db = await openDraftDb();
              const draftId = toDraftId(user.id);
              await idbDeleteDraftFilesNotIn(db, draftId, new Set());
            }
          } catch {
          }
          const ticketUrl = `/chamados/${ticket.id}`;
          const receiptUrl = `/chamados/${ticket.id}/comprovante?autoprint=1`;
          if (isMobile) {
            setLocation(ticketUrl);
            return;
          }
          const opened = window.open(receiptUrl, "_blank", "noopener,noreferrer");
          if (!opened) {
            setLocation(receiptUrl);
            return;
          }

          setLocation(ticketUrl);
        },
        onError: () => {
          reportAttachmentEvent("error", "attachment.ticket_create.error", {
            payload,
          });
          toast({
            title: "Erro ao criar chamado",
            description: "Tente novamente em instantes.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const isSubmitting = createMutation.isPending || uploading;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/chamados">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Novo Chamado</h1>
          <p className="text-muted-foreground mt-1">
            Preencha os dados abaixo para relatar um incidente ou solicitar serviço.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  {autoSaveStatus === "saving"
                    ? autoSaveDetail || "Salvando automaticamente..."
                    : autoSaveStatus === "saved"
                    ? autoSaveDetail || (lastSavedAtRef.current ? `Salvo automaticamente` : "Salvo automaticamente")
                    : autoSaveStatus === "error"
                    ? autoSaveDetail || "Falha ao salvar automaticamente"
                    : autoSaveDetail || " "}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={clearDraftAndForm}>
                  Limpar
                </Button>
              </div>

              {/* 1 — Tipo de Solicitação */}
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>1. Tipo de Solicitação</FormLabel>
                    <Select
                      onValueChange={(v) => {
                        if (v !== TicketType.SOFTWARE && v !== TicketType.HARDWARE) return;
                        field.onChange(v);
                        form.setValue("hardwareSubtype", undefined, { shouldValidate: false, shouldDirty: false });
                      }}
                      value={
                        field.value === TicketType.SOFTWARE || field.value === TicketType.HARDWARE
                          ? field.value
                          : TicketType.SOFTWARE
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={TicketType.SOFTWARE}>Sistema</SelectItem>
                        <SelectItem value={TicketType.HARDWARE}>Equipamentos</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Hardware subtype — conditional */}
              {selectedType === TicketType.HARDWARE && (
                <FormField
                  control={form.control}
                  name="hardwareSubtype"
                  render={({ field }) => (
                    <FormItem className="-mt-2 ml-4 pl-4 border-l-2 border-primary/20">
                      <FormLabel className="text-sm text-muted-foreground">Subcategoria de Hardware</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a subcategoria" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="max-h-60 overflow-y-auto">
                          {HARDWARE_SUBTYPES.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* 2 — Título */}
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>2. Título resumido</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Monitor não liga após reinicialização" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 3 — Descrição */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>3. Descrição detalhada</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Descreva o problema passo a passo, incluindo o que foi feito, quando ocorreu e qualquer mensagem de erro exibida..."
                        className="min-h-[140px] resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 4 — Prioridade */}
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>4. Prioridade</FormLabel>
                    <Select
                      onValueChange={(v) => {
                        if (
                          v !== TicketPriority.LOW &&
                          v !== TicketPriority.MEDIUM &&
                          v !== TicketPriority.HIGH
                        ) return;
                        field.onChange(v);
                      }}
                      value={
                        field.value === TicketPriority.LOW ||
                        field.value === TicketPriority.MEDIUM ||
                        field.value === TicketPriority.HIGH
                          ? field.value
                          : TicketPriority.LOW
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a prioridade" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={TicketPriority.LOW}>
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-[var(--priority-low-bg)] inline-block" />
                            Baixa
                          </span>
                        </SelectItem>
                        <SelectItem value={TicketPriority.MEDIUM}>
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-[var(--priority-medium-bg)] inline-block" />
                            Média
                          </span>
                        </SelectItem>
                        <SelectItem value={TicketPriority.HIGH}>
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-[var(--priority-high-bg)] inline-block" />
                            Alta
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 5 — Estabelecimento / Unidade de saúde */}
              <FormField
                control={form.control}
                name="establishment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>5. Estabelecimento / Unidade de saúde</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        maxLength={255}
                        placeholder="Digite o estabelecimento / unidade de saúde"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value)}
                      />
                    </FormControl>
                    <div className="text-xs text-muted-foreground flex justify-between">
                      <span>Obrigatório</span>
                      <span>{(field.value?.length ?? 0)}/255</span>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 6 — Anexos */}
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium leading-none mb-1">6. Anexo <span className="text-destructive">*</span></p>
                  <p className="text-xs text-muted-foreground">
                    Imagens ou documentos. Obrigatório ao menos 1 arquivo. Máximo {MAX_FILES} arquivos de até 3 MB cada.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {files.length}/{MAX_FILES} arquivo(s) anexado(s)
                  </p>
                </div>

                {/* Drop zone */}
                {files.length < MAX_FILES && (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    className={cn(
                      "border-2 border-dashed rounded-lg p-6 text-center cursor-default sm:cursor-pointer transition-colors select-none",
                      dragOver
                        ? "border-primary bg-primary/5"
                        : "border-muted-foreground/25 hover:border-primary/40 hover:bg-muted/30",
                    )}
                  >
                    <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      <span className="sm:hidden">Selecione os arquivos no campo abaixo</span>
                      <span className="hidden sm:inline">Arraste arquivos aqui ou use o botão para selecionar</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      JPG, PNG, GIF, WEBP, HEIC, PDF, DOC, XLS, TXT — máx. 8 MB por arquivo
                    </p>
                    <div className="mt-4 flex justify-center">
                      <div className="w-full max-w-sm text-left">
                        <label htmlFor="ticket-attachments-input" className="mb-2 block text-sm font-medium sm:hidden">
                          Selecionar arquivo
                        </label>
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11 px-5 hidden sm:inline-flex"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openFilePicker();
                          }}
                        >
                          <Paperclip className="h-4 w-4" />
                          Selecionar arquivos
                        </Button>
                        <input
                          id="ticket-attachments-input"
                          ref={fileInputRef}
                          type="file"
                          multiple={false}
                          accept={[
                            // Imagens — sem isso, o seletor nativo do celular (que não
                            // suporta arrastar-e-soltar como o desktop) não oferece
                            // fotos/galeria como opção, só os tipos de documento abaixo.
                            "image/jpeg",
                            "image/png",
                            "image/gif",
                            "image/webp",
                            "image/bmp",
                            "image/heic",
                            "image/heif",
                            ".jpg",
                            ".jpeg",
                            ".png",
                            ".gif",
                            ".webp",
                            ".bmp",
                            ".heic",
                            ".heif",
                            // Documentos
                            "application/pdf",
                            "application/msword",
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                            "application/vnd.ms-excel",
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            "text/plain",
                            ".pdf",
                            ".doc",
                            ".docx",
                            ".xls",
                            ".xlsx",
                            ".txt",
                          ].join(",")}
                          className={cn(
                            "rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground",
                            "mt-2 block w-full sm:sr-only"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            beginFilePickerSession();
                          }}
                          onChange={onFileInput}
                        />
                        {isMobile ? (
                          <div className="mt-4">
                            <label htmlFor="ticket-camera-input" className="mb-2 block text-sm font-medium">
                              Tirar foto (câmera)
                            </label>
                            <input
                              id="ticket-camera-input"
                              ref={cameraInputRef}
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                reportAttachmentEvent("info", "attachment.camera.open_requested", {});
                              }}
                              onChange={onCameraInput}
                            />
                            <p className="mt-1 text-xs text-muted-foreground">
                              Se a galeria não retornar arquivo no Android, use a câmera para gerar a imagem como arquivo real.
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}

                {/* File list */}
                {files.length > 0 && (
                  <div className="space-y-2">
                    {files.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                        {isImage(f.type) && filePreviews[i] ? (
                          <img
                            src={filePreviews[i]}
                            alt={f.name}
                            className="h-12 w-12 rounded object-cover shrink-0 border"
                          />
                        ) : (
                          <div className="h-12 w-12 rounded bg-primary/10 flex items-center justify-center shrink-0">
                            {f.type === "application/pdf"
                              ? <FileText className="h-6 w-6 text-primary" />
                              : <Paperclip className="h-6 w-6 text-primary" />}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{f.name}</p>
                          <p className="text-xs text-muted-foreground">{formatBytes(f.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="p-1 rounded-full hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Errors */}
                {fileErrors.length > 0 && (
                  <div className="space-y-1">
                    {fileErrors.map((e, i) => (
                      <p key={i} className="text-xs text-destructive">{e}</p>
                    ))}
                  </div>
                )}

                {files.length >= MAX_FILES && (
                  <p className="text-xs text-muted-foreground">
                    Limite de {MAX_FILES} arquivos atingido.
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-4 pt-2">
                <Button variant="outline" asChild>
                  <Link href="/chamados">Cancelar</Link>
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting
                    ? uploading ? "Enviando anexos..." : "Salvando..."
                    : "Abrir Chamado"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
