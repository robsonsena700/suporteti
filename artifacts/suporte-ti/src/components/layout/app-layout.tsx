import { useAuth } from "@/lib/auth";
import { Sidebar } from "./sidebar";
import { ReactNode, useState } from "react";
import { useLocation } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import { AppFooter } from "@/components/layout/app-footer";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  // If loading auth or not logged in and trying to access protected routes
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const isPublicRoute = location === "/" || location === "/registro";
  const isPendingRoute = location === "/pendente";
  const isReceiptRoute = location.includes("/comprovante");

  if (isPublicRoute || isPendingRoute || isReceiptRoute) {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  const isFullScreen = location === "/chat";

  return (
    <div className="flex h-screen bg-background overflow-hidden safe-area-px safe-area-py">
      {!isMobile ? (
        <Sidebar />
      ) : (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <span className="hidden" />
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-[85vw] max-w-[360px]">
            <Sidebar onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      )}
      <div className="flex flex-1 flex-col overflow-hidden">
        {isMobile && !isFullScreen ? (
          <header className="flex items-center gap-3 px-4 h-14 border-b bg-background mobile-landscape-compact">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Abrir menu"
              onClick={() => setOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">SuporteTI</p>
              <p className="text-xs text-muted-foreground truncate">{user?.name}</p>
            </div>
          </header>
        ) : null}
        <main className="flex-1 overflow-hidden">
          {isFullScreen ? (
            <div className="h-full">{children}</div>
          ) : (
            <div className="h-full overflow-y-auto">
              <div className="container mx-auto px-4 py-6 sm:p-8">
                {children}
              </div>
              <AppFooter />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
