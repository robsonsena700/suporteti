import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard,
  Ticket,
  BarChart3,
  Settings,
  LogOut,
  User as UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const navigation = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Chamados", href: "/chamados", icon: Ticket },
    { name: "Relatórios", href: "/relatorios", icon: BarChart3 },
    ...(user?.role === "ADMIN"
      ? [{ name: "Configurações", href: "/configuracoes", icon: Settings }]
      : []),
  ];

  return (
    <div className="flex h-full w-64 flex-col bg-sidebar border-r border-sidebar-border">
      <div className="flex h-16 shrink-0 items-center px-6">
        <span className="text-lg font-bold tracking-tight text-sidebar-foreground flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground">
            TI
          </div>
          SuporteGov
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
                  "group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors"
                )}
              >
                <item.icon
                  className={cn(
                    isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/70 group-hover:text-sidebar-accent-foreground",
                    "mr-3 h-5 w-5 flex-shrink-0"
                  )}
                  aria-hidden="true"
                />
                {item.name}
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
          <Button variant="ghost" size="sm" onClick={() => logout()} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
