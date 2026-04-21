import { useAuth } from "@/lib/auth";

function formatLastLogin(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function AppFooter() {
  const { user } = useAuth();
  const buildTime = new Date(__APP_BUILD_TIME__).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <footer className="border-t bg-background">
      <div className="container mx-auto px-4 py-3 sm:px-8">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-1 text-xs text-muted-foreground">
          <div>Versão {__APP_VERSION__}</div>
          <div>Ambiente: {__APP_ENV__ === "production" ? "Produção" : "Desenvolvimento"}</div>
          <div>Build: {buildTime}</div>
          <div>Último login: {formatLastLogin((user as any)?.lastLoginAt)}</div>
        </div>
      </div>
    </footer>
  );
}

