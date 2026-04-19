import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useChatNotifications } from "@/lib/chat-notifications";
import {
  LayoutDashboard,
  Ticket,
  BarChart3,
  Settings,
  LogOut,
  User as UserIcon,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const CHAT_ROLES = ["ADMIN", "COORDINATOR", "ANALYST"];

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { unreadCount } = useChatNotifications();

  const navigation = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, badge: 0 },
    { name: "Chamados", href: "/chamados", icon: Ticket, badge: 0 },
    ...(user?.role && CHAT_ROLES.includes(user.role)
      ? [{ name: "Chat", href: "/chat", icon: MessageSquare, badge: unreadCount }]
      : []),
    { name: "Relatorios", href: "/relatorios", icon: BarChart3, badge: 0 },
    ...(user?.role === "ADMIN"
      ? [{ name: "Configuracoes", href: "/configuracoes", icon: Settings, badge: 0 }]
      : []),
  ];

  const NAV_LABELS: Record<string, string> = {
    Dashboard: "Dashboard",
    Chamados: "Chamados",
    Chat: "Chat",
    Relatorios: "Relatórios",
    Configuracoes: "Configurações",
  };

  return (
    <div className="flex h-full w-64 flex-col bg-sidebar border-r border-sidebar-border">
      <div className="flex h-16 shrink-0 items-center px-6">
        <span className="text-lg font-bold tracking-tight text-sidebar-foreground flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground">
            TI
          </div>
          SuporteTI
        </span>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <nav className="flex-1 space-y-1 px-4 py-4">
          {navigation.map((item) => {
            const isActive = location === item.href || location.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                  "group flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors"
                )}
              >
                <div className="flex items-center">
                  <item.icon
                    className={cn(
                      isActive
                        ? "text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 group-hover:text-sidebar-accent-foreground",
                      "mr-3 h-5 w-5 flex-shrink-0"
                    )}
                    aria-hidden="true"
                  />
                  {NAV_LABELS[item.name] ?? item.name}
                </div>
                {item.badge > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white leading-none">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3 px-3 py-2 text-sm text-sidebar-foreground">
          <div className="flex-1 min-w-0">
            <p className="truncate font-medium">{user?.name}</p>
            <p className="truncate text-xs text-sidebar-foreground/70">{user?.role}</p>
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          <Button variant="ghost" size="sm" className="flex-1 justify-start" asChild>
            <Link href="/perfil">
              <UserIcon className="mr-2 h-4 w-4" />
              Perfil
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout()}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
