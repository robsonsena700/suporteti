import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { useAuth } from "./auth";
import { useToast } from "@/hooks/use-toast";

interface ChatNotificationContextType {
  unreadCount: number;
  dmInbox: DMPreview[];
  markAllRead: () => void;
  requestPermission: () => Promise<void>;
  notifPermission: NotificationPermission | "unsupported";
}

const ChatNotificationContext = createContext<ChatNotificationContextType>({
  unreadCount: 0,
  dmInbox: [],
  markAllRead: () => {},
  requestPermission: async () => {},
  notifPermission: "default",
});

// ── LocalStorage helpers ──────────────────────────────────────────────────────

const KEY_GROUP = "ti_chat_group_last_id";
const KEY_DM    = "ti_chat_dm_last_id";

function getStored(key: string): number {
  return parseInt(localStorage.getItem(key) || "0", 10) || 0;
}
function setStored(key: string, id: number) {
  localStorage.setItem(key, String(id));
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface GroupMsg {
  id: number;
  senderId: number;
  message: string;
  sender: { id: number; name: string; role: string };
}

interface DMPreview {
  partnerId: number;
  partnerName: string;
  partnerRole: string;
  lastMessage: string;
  lastMessageAt: string;
  lastMessageId: number;
  fromMe: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  COORDINATOR: "Coordenador",
  ANALYST: "Analista",
};

// ── Provider ──────────────────────────────────────────────────────────────────

export function ChatNotificationProvider({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  const [location] = useLocation();
  const { toast } = useToast();

  const [unreadCount, setUnreadCount] = useState(0);
  const [dmInbox, setDmInbox] = useState<DMPreview[]>([]);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unreadRef = useRef(0);
  // On first mount, run one silent poll to set the baseline IDs so we
  // don't fire notifications for messages that already existed before login.
  const initializedRef = useRef(false);
  const metricsRef = useRef({ groupPolls: 0, groupAvgMs: 0, dmPolls: 0, dmAvgMs: 0 });
  const streamMetricsRef = useRef({ events: 0, avgLatencyMs: 0 });
  const [streamConnected, setStreamConnected] = useState(false);

  const isOnChat = location === "/chat";
  const CHAT_ROLES = ["ADMIN", "COORDINATOR", "ANALYST"];
  const canAccessChat = !!(user && CHAT_ROLES.includes(user.role));

  // Keep unreadRef in sync
  useEffect(() => { unreadRef.current = unreadCount; }, [unreadCount]);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  }, []);

  const markAllRead = useCallback(() => {
    setUnreadCount(0);
    unreadRef.current = 0;
  }, []);

  // ── Browser notification ──────────────────────────────────────────────────

  const fireBrowserNotif = useCallback((title: string, body: string) => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    // Only fire browser notif when tab is not focused
    if (document.hasFocus()) return;

    const notif = new Notification(title, {
      body: body.length > 80 ? body.slice(0, 80) + "…" : body,
      icon: "/favicon.ico",
      tag: "chat-message",
    });
    notif.onclick = () => { window.focus(); notif.close(); };
  }, []);

  // ── In-app toast ──────────────────────────────────────────────────────────

  const fireToast = useCallback((title: string, desc: string) => {
    toast({
      title,
      description: desc.length > 80 ? desc.slice(0, 80) + "…" : desc,
    });
  }, [toast]);

  // ── Poll group messages ───────────────────────────────────────────────────

  const pollGroup = useCallback(async (silent = false) => {
    if (!token || !canAccessChat) return;
    try {
      const lastSeen = getStored(KEY_GROUP);
      const url = silent ? "/api/chat/messages?limit=200" : `/api/chat/messages?limit=200&afterId=${encodeURIComponent(String(lastSeen))}`;
      const t0 = performance.now();
      const data = await customFetch<GroupMsg[]>(url);
      const dt = performance.now() - t0;
      metricsRef.current.groupPolls += 1;
      metricsRef.current.groupAvgMs = metricsRef.current.groupAvgMs === 0 ? dt : (metricsRef.current.groupAvgMs * 0.9 + dt * 0.1);

      if (!data.length) return;

      const maxId = Math.max(lastSeen, ...data.map((m) => m.id));

      if (!silent) {
        const fresh = data.filter((m) => m.senderId !== user?.id);
        if (fresh.length > 0 && !isOnChat) {
          const latest = fresh[fresh.length - 1];
          const label = ROLE_LABELS[latest.sender.role] ?? latest.sender.role;
          fireToast(`Grupo: ${latest.sender.name} (${label})`, latest.message);
          fireBrowserNotif(`Grupo — ${latest.sender.name} (${label})`, latest.message);
          setUnreadCount((p) => p + fresh.length);
        }
      }

      if (maxId > lastSeen) setStored(KEY_GROUP, maxId);
    } catch { /* silent */ }
  }, [token, canAccessChat, user?.id, isOnChat, fireToast, fireBrowserNotif]);

  // ── Poll DM inbox ─────────────────────────────────────────────────────────

  const pollDMs = useCallback(async (silent = false) => {
    if (!token || !canAccessChat) return;
    try {
      const t0 = performance.now();
      const inbox = await customFetch<DMPreview[]>("/api/chat/dm-inbox");
      const dt = performance.now() - t0;
      metricsRef.current.dmPolls += 1;
      metricsRef.current.dmAvgMs = metricsRef.current.dmAvgMs === 0 ? dt : (metricsRef.current.dmAvgMs * 0.9 + dt * 0.1);
      setDmInbox(inbox);
      if (!inbox.length) return;

      const lastSeen = getStored(KEY_DM);
      const maxId = Math.max(...inbox.map((d) => d.lastMessageId));

      if (!silent) {
        const fresh = inbox.filter((d) => !d.fromMe && d.lastMessageId > lastSeen);
        if (fresh.length > 0) {
          if (!isOnChat) {
            for (const dm of fresh) {
              const label = ROLE_LABELS[dm.partnerRole] ?? dm.partnerRole;
              fireToast(`Mensagem de ${dm.partnerName} (${label})`, dm.lastMessage);
              fireBrowserNotif(`Mensagem de ${dm.partnerName} (${label})`, dm.lastMessage);
            }
            setUnreadCount((p) => p + fresh.length);
          } else {
            // On chat — browser notif only (user might be in a different conversation)
            for (const dm of fresh) {
              const label = ROLE_LABELS[dm.partnerRole] ?? dm.partnerRole;
              fireBrowserNotif(`Mensagem de ${dm.partnerName} (${label})`, dm.lastMessage);
            }
          }
        }
      }

      if (maxId > lastSeen) setStored(KEY_DM, maxId);
    } catch { /* silent */ }
  }, [token, canAccessChat, isOnChat, fireToast, fireBrowserNotif]);

  const applyDmInboxEvent = useCallback((payload: {
    id: number;
    senderId: number;
    senderName: string;
    senderRole: string;
    receiverId: number;
    receiverName: string;
    receiverRole: string;
    message: string;
    createdAt: string;
  }) => {
    if (!user) return;
    const fromMe = payload.senderId === user.id;
    const partnerId = fromMe ? payload.receiverId : payload.senderId;
    const partnerName = fromMe ? payload.receiverName : payload.senderName;
    const partnerRole = fromMe ? payload.receiverRole : payload.senderRole;

    setDmInbox((prev) => {
      const next: DMPreview[] = [
        {
          partnerId,
          partnerName,
          partnerRole,
          lastMessage: payload.message,
          lastMessageAt: payload.createdAt,
          lastMessageId: payload.id,
          fromMe,
        },
        ...prev.filter((p) => p.partnerId !== partnerId),
      ];
      next.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
      return next;
    });
  }, [user]);

  const connectStream = useCallback(async () => {
    if (!token || !canAccessChat) return;

    const abort = new AbortController();
    streamAbortRef.current = abort;

    try {
      const resp = await fetch("/api/chat/stream", {
        headers: { Authorization: `Bearer ${token}` },
        signal: abort.signal,
      });
      if (!resp.ok || !resp.body) throw new Error("stream_unavailable");
      setStreamConnected(true);

      const decoder = new TextDecoder();
      let buffer = "";

      const flush = (chunk: string) => {
        buffer += chunk;
        while (true) {
          const idx = buffer.indexOf("\n\n");
          if (idx === -1) break;
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          const lines = block.split("\n").map((l) => l.trimEnd());
          let eventName = "";
          let dataStr = "";
          for (const line of lines) {
            if (line.startsWith("event:")) eventName = line.slice("event:".length).trim();
            if (line.startsWith("data:")) dataStr += line.slice("data:".length).trim();
          }
          if (!eventName || !dataStr) continue;
          if (eventName === "ping" || eventName === "hello") continue;

          let data: any;
          try { data = JSON.parse(dataStr); } catch { continue; }

          if (eventName === "group_message") {
            const lastSeen = getStored(KEY_GROUP);
            if (typeof data.id === "number" && data.id > lastSeen) setStored(KEY_GROUP, data.id);
            if (!isOnChat && data.senderId !== user?.id) {
              const label = ROLE_LABELS[data.senderRole] ?? data.senderRole;
              fireToast(`Grupo: ${data.senderName} (${label})`, data.message);
              fireBrowserNotif(`Grupo — ${data.senderName} (${label})`, data.message);
              setUnreadCount((p) => p + 1);
            }
            if (typeof data.createdAt === "string") {
              const created = new Date(data.createdAt).getTime();
              const latency = Date.now() - created;
              const m = streamMetricsRef.current;
              m.events += 1;
              m.avgLatencyMs = m.avgLatencyMs === 0 ? latency : (m.avgLatencyMs * 0.9 + latency * 0.1);
            }
          }

          if (eventName === "dm_message") {
            const lastSeen = getStored(KEY_DM);
            if (typeof data.id === "number" && data.id > lastSeen) setStored(KEY_DM, data.id);
            applyDmInboxEvent(data);
            const fromMe = data.senderId === user?.id;
            if (!fromMe && data.id > lastSeen) {
              const label = ROLE_LABELS[data.senderRole] ?? data.senderRole;
              if (!isOnChat) {
                fireToast(`Mensagem de ${data.senderName} (${label})`, data.message);
                fireBrowserNotif(`Mensagem de ${data.senderName} (${label})`, data.message);
                setUnreadCount((p) => p + 1);
              } else {
                fireBrowserNotif(`Mensagem de ${data.senderName} (${label})`, data.message);
              }
            }
            if (typeof data.createdAt === "string") {
              const created = new Date(data.createdAt).getTime();
              const latency = Date.now() - created;
              const m = streamMetricsRef.current;
              m.events += 1;
              m.avgLatencyMs = m.avgLatencyMs === 0 ? latency : (m.avgLatencyMs * 0.9 + latency * 0.1);
            }
          }

          if (eventName === "dm_message_edited") {
            pollDMs(true);
          }
        }
      };

      const reader = resp.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        flush(decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      if (abort.signal.aborted) return;
      setStreamConnected(false);
    } finally {
      setStreamConnected(false);
    }
  }, [token, canAccessChat, isOnChat, user?.id, fireToast, fireBrowserNotif, applyDmInboxEvent, pollDMs]);

  // ── Mark all read when entering chat ─────────────────────────────────────

  useEffect(() => {
    if (isOnChat) {
      setUnreadCount(0);
      unreadRef.current = 0;
    }
  }, [isOnChat]);

  // ── Polling loop ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!token || !canAccessChat) return;

    const run = (silent = false) => { pollGroup(silent); pollDMs(silent); };

    // First run is silent: sets baseline IDs without triggering notifications
    // for messages that already existed before this session started.
    if (!initializedRef.current) {
      initializedRef.current = true;
      run(true);
    }

    const intervalMs = streamConnected ? 5000 : 1000;
    pollingRef.current = setInterval(() => run(false), intervalMs);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [token, canAccessChat, pollGroup, pollDMs, streamConnected]);

  useEffect(() => {
    if (!token || !canAccessChat) return;
    let stopped = false;
    let backoffMs = 1000;

    const loop = async () => {
      while (!stopped) {
        await connectStream();
        if (stopped) return;
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(15_000, Math.round(backoffMs * 1.6));
      }
    };
    if (streamStartTimerRef.current) clearTimeout(streamStartTimerRef.current);
    streamStartTimerRef.current = setTimeout(() => {
      if (!stopped) loop();
    }, 250);

    return () => {
      stopped = true;
      setStreamConnected(false);
      if (streamStartTimerRef.current) clearTimeout(streamStartTimerRef.current);
      streamStartTimerRef.current = null;
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
    };
  }, [token, canAccessChat, connectStream]);

  useEffect(() => {
    if (!token || !canAccessChat) return;
    const id = setInterval(() => {
      const m = metricsRef.current;
      if (m.groupPolls + m.dmPolls === 0) return;
      if (import.meta.env.DEV) {
        console.debug("[chat-notifications] avgMs", {
          group: Math.round(m.groupAvgMs),
          dmInbox: Math.round(m.dmAvgMs),
        });
      }
    }, 15000);
    return () => clearInterval(id);
  }, [token, canAccessChat]);

  useEffect(() => {
    if (!token || !canAccessChat) return;
    const id = setInterval(() => {
      const m = streamMetricsRef.current;
      if (m.events === 0) return;
      if (import.meta.env.DEV) {
        console.debug("[chat-notifications] stream avgLatencyMs", Math.round(m.avgLatencyMs));
      }
    }, 15000);
    return () => clearInterval(id);
  }, [token, canAccessChat]);

  // ── Update page title ─────────────────────────────────────────────────────

  useEffect(() => {
    const base = "SuporteTI";
    document.title = unreadCount > 0 ? `(${unreadCount}) ${base}` : base;
  }, [unreadCount]);

  return (
    <ChatNotificationContext.Provider
      value={{ unreadCount, dmInbox, markAllRead, requestPermission, notifPermission }}
    >
      {children}
    </ChatNotificationContext.Provider>
  );
}

export function useChatNotifications() {
  return useContext(ChatNotificationContext);
}
