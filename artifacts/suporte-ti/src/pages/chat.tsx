import { useState, useEffect, useRef, FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMsg {
  id: number;
  senderId: number;
  message: string;
  createdAt: string;
  sender: { id: number; name: string; role: string };
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  COORDINATOR: "Coordenador",
  ANALYST: "Analista",
};

const ROLE_COLORS: Record<string, string> = {
  ADMIN: "bg-red-100 text-red-700",
  COORDINATOR: "bg-purple-100 text-purple-700",
  ANALYST: "bg-blue-100 text-blue-700",
};

async function fetchMessages(): Promise<ChatMsg[]> {
  return customFetch<ChatMsg[]>("/api/chat/messages?limit=200");
}

async function sendMessage(message: string): Promise<ChatMsg> {
  return customFetch<ChatMsg>("/api/chat/messages", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export default function Chat() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastIdRef = useRef<number>(0);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
  };

  const loadMessages = async (initial = false) => {
    try {
      const data = await fetchMessages();
      setMessages(data);
      if (initial) {
        scrollToBottom("instant");
      } else if (data.length > 0 && data[data.length - 1].id !== lastIdRef.current) {
        scrollToBottom("smooth");
      }
      if (data.length > 0) {
        lastIdRef.current = data[data.length - 1].id;
      }
    } catch {
      // Silently retry on polling
    }
  };

  useEffect(() => {
    loadMessages(true);
    pollingRef.current = setInterval(() => loadMessages(), 5000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setError(null);
    try {
      const msg = await sendMessage(text);
      setMessages((prev) => [...prev, msg]);
      lastIdRef.current = msg.id;
      setInput("");
      setTimeout(() => scrollToBottom("smooth"), 50);
    } catch {
      setError("Nao foi possivel enviar a mensagem. Tente novamente.");
    } finally {
      setSending(false);
    }
  };

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  let lastDate = "";

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="border-b px-6 py-4 shrink-0">
        <h1 className="text-xl font-bold text-primary">Chat Interno</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Canal de comunicacao entre Administradores, Coordenadores e Analistas
        </p>
      </div>

      <ScrollArea className="flex-1 px-6 py-4 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            Nenhuma mensagem ainda. Inicie a conversa!
          </div>
        )}
        {messages.map((msg) => {
          const msgDate = formatDate(msg.createdAt);
          const showDate = msgDate !== lastDate;
          lastDate = msgDate;
          const isOwn = msg.senderId === user?.id;

          return (
            <div key={msg.id}>
              {showDate && (
                <div className="flex items-center gap-2 my-4">
                  <div className="flex-1 border-t" />
                  <span className="text-xs text-muted-foreground px-2">{msgDate}</span>
                  <div className="flex-1 border-t" />
                </div>
              )}
              <div className={cn("flex gap-3 mb-4", isOwn ? "flex-row-reverse" : "flex-row")}>
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold select-none",
                    isOwn
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {msg.sender.name.charAt(0).toUpperCase()}
                </div>
                <div className={cn("flex flex-col max-w-[65%]", isOwn && "items-end")}>
                  <div
                    className={cn(
                      "flex items-center gap-2 mb-1 flex-wrap",
                      isOwn && "flex-row-reverse"
                    )}
                  >
                    <span className="text-sm font-medium leading-none">{msg.sender.name}</span>
                    <span
                      className={cn(
                        "text-xs px-1.5 py-0.5 rounded font-medium",
                        ROLE_COLORS[msg.sender.role] ?? "bg-gray-100 text-gray-700"
                      )}
                    >
                      {ROLE_LABELS[msg.sender.role] ?? msg.sender.role}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatTime(msg.createdAt)}</span>
                  </div>
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-2 text-sm break-words whitespace-pre-wrap",
                      isOwn
                        ? "bg-primary text-primary-foreground rounded-tr-sm"
                        : "bg-muted text-foreground rounded-tl-sm"
                    )}
                  >
                    {msg.message}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </ScrollArea>

      <div className="border-t px-6 py-4 shrink-0">
        {error && <p className="text-xs text-destructive mb-2">{error}</p>}
        <form onSubmit={handleSend} className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Digite sua mensagem..."
            disabled={sending}
            className="flex-1"
            maxLength={2000}
            autoComplete="off"
          />
          <Button type="submit" disabled={!input.trim() || sending} size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
