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

const STORAGE_KEY = "ti_chat_last_seen_id";

function getLastSeenId(): number {
  return parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
}

function setLastSeenId(id: number) {
  localStorage.setItem(STORAGE_KEY, String(id));
}

interface ChatMsg {
  id: number;
  senderId: number;
  message: string;
  createdAt: string;
  sender: { id: number; name: string; role: string };
}

export function ChatNotificationProvider({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  const [location] = useLocation();
  const { toast } = useToast();

  const [unreadCount, setUnreadCount] = useState(0);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isOnChat = location === "/chat";

  const CHAT_ROLES = ["ADMIN", "COORDINATOR", "ANALYST"];
  const canAccessChat = user && CHAT_ROLES.includes(user.role);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  }, []);

  const markAllRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const showBrowserNotification = useCallback(
    (msg: ChatMsg) => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      if (document.hasFocus() && isOnChat) return;

      const ROLE_LABELS: Record<string, string> = {
        ADMIN: "Admin",
        COORDINATOR: "Coordenador",
        ANALYST: "Analista",
      };

      const notif = new Notification(
        `${msg.sender.name} (${ROLE_LABELS[msg.sender.role] ?? msg.sender.role})`,
        {
          body: msg.message.length > 80 ? msg.message.slice(0, 80) + "…" : msg.message,
          icon: "/favicon.ico",
          tag: "chat-message",
          renotify: true,
        }
      );

      notif.onclick = () => {
        window.focus();
        notif.close();
      };
    },
    [isOnChat]
  );

  const pollMessages = useCallback(async () => {
    if (!token || !canAccessChat) return;

    try {
      const data = await customFetch<ChatMsg[]>("/api/chat/messages?limit=200");
      if (!data.length) return;

      const lastSeenId = getLastSeenId();
      const newMessages = data.filter(
        (m) => m.id > lastSeenId && m.senderId !== user?.id
      );

      if (newMessages.length === 0) return;

      const latestId = Math.max(...data.map((m) => m.id));

      if (isOnChat) {
        // On chat page: show browser notification for new messages when tab not focused
        for (const msg of newMessages) {
          showBrowserNotification(msg);
        }
        // Mark as read immediately since user can see the chat
        setLastSeenId(latestId);
        setUnreadCount(0);
      } else {
        // On other page: increment badge + show toast for last new message
        setUnreadCount((prev) => prev + newMessages.length);

        const latest = newMessages[newMessages.length - 1];
        const ROLE_LABELS: Record<string, string> = {
          ADMIN: "Admin",
          COORDINATOR: "Coordenador",
          ANALYST: "Analista",
        };
        toast({
          title: `Mensagem de ${latest.sender.name}`,
          description:
            latest.message.length > 60
              ? latest.message.slice(0, 60) + "…"
              : latest.message,
        });

        showBrowserNotification(latest);
        setLastSeenId(latestId);
      }
    } catch {
      // silent
    }
  }, [token, canAccessChat, user?.id, isOnChat, showBrowserNotification, toast]);

  // Mark all read when entering chat
  useEffect(() => {
    if (isOnChat) {
      setUnreadCount(0);
    }
  }, [isOnChat]);

  // Poll for new messages
  useEffect(() => {
    if (!token || !canAccessChat) return;

    pollMessages();
    pollingRef.current = setInterval(pollMessages, 6000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [token, canAccessChat, pollMessages]);

  // Update page title with unread count
  useEffect(() => {
    const base = "SuporteGov";
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
