import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/layout/app-layout";

// Pages
import Login from "@/pages/login";
import Register from "@/pages/register";
import Pending from "@/pages/pending";
import Dashboard from "@/pages/dashboard";
import Tickets from "@/pages/tickets";
import NewTicket from "@/pages/new-ticket";
import TicketDetail from "@/pages/ticket-detail";
import Reports from "@/pages/reports";
import Settings from "@/pages/settings";
import Profile from "@/pages/profile";
import Chat from "@/pages/chat";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component, ...rest }: any) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) return null; // handled by AppLayout

  return (
    <Route
      {...rest}
      component={(props) => {
        // Redirections logic handled in AppLayout slightly, but let's be strict here
        if (!user) {
          window.location.href = "/";
          return null;
        }
        if (user.status === "PENDING" && window.location.pathname !== "/pendente") {
          window.location.href = "/pendente";
          return null;
        }
        if (rest.adminOnly && user.role !== "ADMIN") {
          window.location.href = "/dashboard";
          return null;
        }
        return <Component {...props} />;
      }}
    />
  );
}

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Login} />
        <Route path="/registro" component={Register} />
        
        <ProtectedRoute path="/pendente" component={Pending} />
        <ProtectedRoute path="/dashboard" component={Dashboard} />
        <ProtectedRoute path="/chamados" component={Tickets} />
        <ProtectedRoute path="/chamados/novo" component={NewTicket} />
        <ProtectedRoute path="/chamados/:id" component={TicketDetail} />
        <ProtectedRoute path="/chat" component={Chat} />
        <ProtectedRoute path="/relatorios" component={Reports} />
        <ProtectedRoute path="/configuracoes" component={Settings} adminOnly />
        <ProtectedRoute path="/perfil" component={Profile} />

        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
