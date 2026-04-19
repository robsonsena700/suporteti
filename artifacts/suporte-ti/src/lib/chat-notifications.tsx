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
  markAllRead: () => void;
  requestPermission: () => Promise<void>;
  notifPermission: NotificationPermission | "unsupported";
}

const ChatNotificationContext = createContext<ChatNotificationContextType>({
  unreadCount: 0,
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
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unreadRef = useRef(0);
  // On first mount, run one silent poll to set the baseline IDs so we
  // don't fire notifications for messages that already existed before login.
  const initializedRef = useRef(false);

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
      const data = await customFetch<GroupMsg[]>("/api/chat/messages?limit=200");
      if (!data.length) return;

      const lastSeen = getStored(KEY_GROUP);
      const maxId = Math.max(...data.map((m) => m.id));

      if (!silent) {
        const fresh = data.filter((m) => m.id > lastSeen && m.senderId !== user?.id);
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
      const inbox = await customFetch<DMPreview[]>("/api/chat/dm-inbox");
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

    pollingRef.current = setInterval(() => run(false), 5000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [token, canAccessChat, pollGroup, pollDMs]);

  // ── Update page title ─────────────────────────────────────────────────────

  useEffect(() => {
    const base = "SuporteTI";
    document.title = unreadCount > 0 ? `(${unreadCount}) ${base}` : base;
  }, [unreadCount]);

  return (
    <ChatNotificationContext.Provider
      value={{ unreadCount, markAllRead, requestPermission, notifPermission }}
    >
      {children}
    </ChatNotificationContext.Provider>
  );
}

export function useChatNotifications() {
  return useContext(ChatNotificationContext);
}
