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
  realtimeStatus: "disabled" | "connecting" | "connected" | "reconnecting";
  subscribeRealtime: (listener: (event: { type: string; payload: any }) => void) => () => void;
}

const ChatNotificationContext = createContext<ChatNotificationContextType>({
  unreadCount: 0,
  dmInbox: [],
  markAllRead: () => {},
  requestPermission: async () => {},
  notifPermission: "default",
  realtimeStatus: "disabled",
  subscribeRealtime: () => () => {},
});

// ── LocalStorage helpers ──────────────────────────────────────────────────────

const KEY_GROUP = "ti_chat_group_last_id";
const KEY_DM    = "ti_chat_dm_last_id";
const KEY_DM_INBOX_CACHE = "ti_chat_dm_inbox_cache_v1";
const KEY_CHAT_LEADER = "ti_chat_notif_leader_v1";

function getStored(key: string): number {
  return parseInt(localStorage.getItem(key) || "0", 10) || 0;
}
function setStored(key: string, id: number) {
  localStorage.setItem(key, String(id));
}
function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { }
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
  GESTOR: "Gestor",
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

  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unreadRef = useRef(0);
  // On first mount, run one silent poll to set the baseline IDs so we
  // don't fire notifications for messages that already existed before login.
  const initializedRef = useRef(false);
  const metricsRef = useRef({ groupPolls: 0, groupAvgMs: 0, dmPolls: 0, dmAvgMs: 0 });
  const streamMetricsRef = useRef({ events: 0, avgLatencyMs: 0 });
  const enableStream = import.meta.env.PROD || localStorage.getItem("ti_chat_stream") === "1";
  const [streamConnected, setStreamConnected] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<"disabled" | "connecting" | "connected" | "reconnecting">(
    enableStream ? "connecting" : "disabled"
  );
  const realtimeListenersRef = useRef(new Set<(event: { type: string; payload: any }) => void>());
  const canBroadcast = typeof BroadcastChannel !== "undefined";
  const tabIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? (crypto as any).randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
  const bcRef = useRef<BroadcastChannel | null>(null);
  const [isLeader, setIsLeader] = useState(false);
  const isLeaderRef = useRef(false);
  const [leaderStatus, setLeaderStatus] = useState<"disabled" | "connecting" | "connected" | "reconnecting">("disabled");
  const lastHeartbeatAtRef = useRef(0);

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
    if (canBroadcast && !isLeaderRef.current) return;
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
    if (canBroadcast && !isLeaderRef.current) return;
    toast({
      title,
      description: desc.length > 80 ? desc.slice(0, 80) + "…" : desc,
    });
  }, [toast]);

  const broadcast = useCallback((msg: any) => {
    const bc = bcRef.current;
    if (!bc) return;
    try {
      bc.postMessage({ ...msg, source: tabIdRef.current });
    } catch { }
  }, []);

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

  // ── Poll group messages ───────────────────────────────────────────────────

  const pollGroup = useCallback(async (silent = false): Promise<boolean> => {
    if (!token || !canAccessChat) return false;
    try {
      const lastSeen = getStored(KEY_GROUP);
      const url = silent ? "/api/chat/messages?limit=200" : `/api/chat/messages?limit=200&afterId=${encodeURIComponent(String(lastSeen))}`;
      const t0 = performance.now();
      const data = await customFetch<GroupMsg[]>(url);
      const dt = performance.now() - t0;
      metricsRef.current.groupPolls += 1;
      metricsRef.current.groupAvgMs = metricsRef.current.groupAvgMs === 0 ? dt : (metricsRef.current.groupAvgMs * 0.9 + dt * 0.1);

      if (!data.length) return true;

      if (!silent && canBroadcast && isLeaderRef.current) {
        for (const m of data) {
          broadcast({
            kind: "event",
            eventName: "group_message",
            data: {
              id: m.id,
              senderId: m.senderId,
              senderName: m.sender?.name,
              senderRole: m.sender?.role,
              message: m.message,
              createdAt: (m as any).createdAt,
            },
          });
        }
      }

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
      return true;
    } catch {
      return false;
    }
  }, [token, canAccessChat, user?.id, isOnChat, fireToast, fireBrowserNotif, canBroadcast, broadcast]);

  // ── Poll DM inbox ─────────────────────────────────────────────────────────

  const pollDMs = useCallback(async (silent = false): Promise<boolean> => {
    if (!token || !canAccessChat) return false;
    try {
      const t0 = performance.now();
      const inbox = await customFetch<DMPreview[]>("/api/chat/dm-inbox");
      const dt = performance.now() - t0;
      metricsRef.current.dmPolls += 1;
      metricsRef.current.dmAvgMs = metricsRef.current.dmAvgMs === 0 ? dt : (metricsRef.current.dmAvgMs * 0.9 + dt * 0.1);
      setDmInbox(inbox);
      if (!inbox.length) return true;

      const lastSeen = getStored(KEY_DM);
      const maxId = Math.max(...inbox.map((d) => d.lastMessageId));
      const fresh = inbox.filter((d) => !d.fromMe && d.lastMessageId > lastSeen);

      if (!silent && canBroadcast && isLeaderRef.current) {
        broadcast({ kind: "dm_inbox", inbox, maxId, freshCount: fresh.length });
      }

      if (!silent) {
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
      return true;
    } catch {
      return false;
    }
  }, [token, canAccessChat, isOnChat, fireToast, fireBrowserNotif, canBroadcast, broadcast]);

  const dispatchRealtime = useCallback((eventName: string, data: any) => {
    for (const l of realtimeListenersRef.current) {
      try { l({ type: eventName, payload: data }); } catch { }
    }

    if (eventName === "group_message") {
      const lastSeen = getStored(KEY_GROUP);
      if (typeof data?.id === "number" && data.id > lastSeen) setStored(KEY_GROUP, data.id);
      if (!isOnChat && data?.senderId !== user?.id) {
        const label = ROLE_LABELS[data.senderRole] ?? data.senderRole;
        fireToast(`Grupo: ${data.senderName} (${label})`, data.message);
        fireBrowserNotif(`Grupo — ${data.senderName} (${label})`, data.message);
        setUnreadCount((p) => p + 1);
      }
      if (typeof data?.createdAt === "string") {
        const created = new Date(data.createdAt).getTime();
        const latency = Date.now() - created;
        const m = streamMetricsRef.current;
        m.events += 1;
        m.avgLatencyMs = m.avgLatencyMs === 0 ? latency : (m.avgLatencyMs * 0.9 + latency * 0.1);
      }
    }

    if (eventName === "dm_message") {
      const lastSeen = getStored(KEY_DM);
      if (typeof data?.id === "number" && data.id > lastSeen) setStored(KEY_DM, data.id);
      applyDmInboxEvent(data);
      const fromMe = data?.senderId === user?.id;
      if (!fromMe && typeof data?.id === "number" && data.id > lastSeen) {
        const label = ROLE_LABELS[data.senderRole] ?? data.senderRole;
        if (!isOnChat) {
          fireToast(`Mensagem de ${data.senderName} (${label})`, data.message);
          fireBrowserNotif(`Mensagem de ${data.senderName} (${label})`, data.message);
          setUnreadCount((p) => p + 1);
        } else {
          fireBrowserNotif(`Mensagem de ${data.senderName} (${label})`, data.message);
        }
      }
      if (typeof data?.createdAt === "string") {
        const created = new Date(data.createdAt).getTime();
        const latency = Date.now() - created;
        const m = streamMetricsRef.current;
        m.events += 1;
        m.avgLatencyMs = m.avgLatencyMs === 0 ? latency : (m.avgLatencyMs * 0.9 + latency * 0.1);
      }
    }

    if (eventName === "dm_message_edited") {
      setDmInbox((prev) => prev.map((p) => {
        if (p.lastMessageId !== data?.id) return p;
        return { ...p, lastMessage: typeof data?.message === "string" ? data.message : p.lastMessage };
      }));
    }
  }, [applyDmInboxEvent, fireToast, fireBrowserNotif, isOnChat, user?.id]);

  const subscribeRealtime = useCallback((listener: (event: { type: string; payload: any }) => void) => {
    realtimeListenersRef.current.add(listener);
    return () => {
      realtimeListenersRef.current.delete(listener);
    };
  }, []);

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
      setRealtimeStatus("connected");

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
          dispatchRealtime(eventName, data);
          if (canBroadcast && isLeaderRef.current) {
            broadcast({ kind: "event", eventName, data });
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
      setRealtimeStatus("reconnecting");
    } finally {
      setStreamConnected(false);
      if (!abort.signal.aborted) setRealtimeStatus("reconnecting");
    }
  }, [token, canAccessChat, dispatchRealtime, canBroadcast, broadcast]);

  useEffect(() => {
    isLeaderRef.current = isLeader;
  }, [isLeader]);

  useEffect(() => {
    if (!canBroadcast) return;
    const bc = new BroadcastChannel("ti_chat_notifications_v1");
    bcRef.current = bc;
    bc.onmessage = (evt) => {
      const msg = evt.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.source === tabIdRef.current) return;
      if (msg.kind === "hb" && typeof msg.ts === "number") {
        lastHeartbeatAtRef.current = msg.ts;
        if (msg.realtimeStatus) setLeaderStatus(msg.realtimeStatus);
        return;
      }
      if (msg.kind === "event" && typeof msg.eventName === "string") {
        dispatchRealtime(msg.eventName, msg.data);
        return;
      }
      if (msg.kind === "dm_inbox" && Array.isArray(msg.inbox)) {
        setDmInbox(msg.inbox as DMPreview[]);
        if (typeof msg.maxId === "number") {
          const prev = getStored(KEY_DM);
          if (msg.maxId > prev) setStored(KEY_DM, msg.maxId);
        }
        if (!isOnChat && typeof msg.freshCount === "number" && msg.freshCount > 0) {
          setUnreadCount((p) => p + msg.freshCount);
        }
      }
    };
    return () => {
      bc.close();
      bcRef.current = null;
    };
  }, [canBroadcast, dispatchRealtime, isOnChat]);

  useEffect(() => {
    if (!canBroadcast) return;
    if (!token || !canAccessChat) return;

    let stopped = false;
    const leaseMs = 10_000;
    const hbEveryMs = 4_000;

    const tryAcquire = () => {
      const now = Date.now();
      const current = readJson<{ id: string; ts: number }>(KEY_CHAT_LEADER);
      const expired = !current || typeof current.ts !== "number" || now - current.ts > leaseMs;
      const mine = current?.id === tabIdRef.current;
      if (mine || expired) {
        writeJson(KEY_CHAT_LEADER, { id: tabIdRef.current, ts: now });
        setIsLeader(true);
        lastHeartbeatAtRef.current = now;
        return;
      }
      setIsLeader(false);
    };

    tryAcquire();

    const tick = setInterval(() => {
      if (stopped) return;
      tryAcquire();
      if (isLeaderRef.current) {
        const now = Date.now();
        writeJson(KEY_CHAT_LEADER, { id: tabIdRef.current, ts: now });
        broadcast({ kind: "hb", ts: now, realtimeStatus });
      } else {
        const now = Date.now();
        if (lastHeartbeatAtRef.current && now - lastHeartbeatAtRef.current > leaseMs) {
          tryAcquire();
        }
      }
    }, hbEveryMs);

    return () => {
      stopped = true;
      clearInterval(tick);
      const current = readJson<{ id: string; ts: number }>(KEY_CHAT_LEADER);
      if (current?.id === tabIdRef.current) {
        try { localStorage.removeItem(KEY_CHAT_LEADER); } catch { }
      }
      setIsLeader(false);
    };
  }, [canBroadcast, token, canAccessChat, broadcast, realtimeStatus]);

  useEffect(() => {
    const cached = readJson<{ ts: number; inbox: DMPreview[] }>(KEY_DM_INBOX_CACHE);
    if (!cached || !Array.isArray(cached.inbox) || typeof cached.ts !== "number") return;
    if (Date.now() - cached.ts > 120_000) return;
    setDmInbox((prev) => (prev.length > 0 ? prev : cached.inbox));
  }, []);

  useEffect(() => {
    if (dmInbox.length === 0) return;
    writeJson(KEY_DM_INBOX_CACHE, { ts: Date.now(), inbox: dmInbox.slice(0, 100) });
  }, [dmInbox]);

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

    const run = async (silent = false): Promise<boolean> => {
      const [g, d] = await Promise.all([pollGroup(silent), pollDMs(silent)]);
      return !!g && !!d;
    };

    // First run is silent: sets baseline IDs without triggering notifications
    // for messages that already existed before this session started.
    if (!initializedRef.current) {
      initializedRef.current = true;
      void run(true);
    }

    let stopped = false;
    let backoffMs = 5_000;

    const loop = async () => {
      if (stopped) return;
      const ok = await run(false);
      if (stopped) return;

      if (streamConnected) {
        backoffMs = 60_000;
      } else {
        backoffMs = ok ? 5_000 : Math.min(30_000, Math.round(backoffMs * 1.6));
      }

      pollingRef.current = setTimeout(loop, backoffMs);
    };

    if (!canBroadcast || isLeader) void loop();

    return () => {
      stopped = true;
      if (pollingRef.current) clearTimeout(pollingRef.current);
      pollingRef.current = null;
    };
  }, [token, canAccessChat, pollGroup, pollDMs, streamConnected, canBroadcast, isLeader]);

  useEffect(() => {
    if (!enableStream) return;
    if (!token || !canAccessChat) return;
    let stopped = false;
    let backoffMs = 1000;

    const loop = async () => {
      setRealtimeStatus("connecting");
      while (!stopped) {
        await connectStream();
        if (stopped) return;
        setRealtimeStatus("reconnecting");
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(15_000, Math.round(backoffMs * 1.6));
      }
    };
    if (streamStartTimerRef.current) clearTimeout(streamStartTimerRef.current);
    streamStartTimerRef.current = setTimeout(() => {
      if (!stopped && (!canBroadcast || isLeaderRef.current)) loop();
    }, 250);

    return () => {
      stopped = true;
      setStreamConnected(false);
      setRealtimeStatus(enableStream ? "reconnecting" : "disabled");
      if (streamStartTimerRef.current) clearTimeout(streamStartTimerRef.current);
      streamStartTimerRef.current = null;
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
    };
  }, [enableStream, token, canAccessChat, connectStream, canBroadcast]);

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
      value={{
        unreadCount,
        dmInbox,
        markAllRead,
        requestPermission,
        notifPermission,
        realtimeStatus: enableStream ? (canBroadcast && !isLeader ? leaderStatus : realtimeStatus) : "disabled",
        subscribeRealtime,
      }}
    >
      {children}
    </ChatNotificationContext.Provider>
  );
}

export function useChatNotifications() {
  return useContext(ChatNotificationContext);
}
