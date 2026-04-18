import { useAuth } from "@/lib/auth";
import { Sidebar } from "./sidebar";
import { ReactNode } from "react";
import { useLocation } from "wouter";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

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

  if (isPublicRoute || isPendingRoute) {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          <div className="container mx-auto p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
