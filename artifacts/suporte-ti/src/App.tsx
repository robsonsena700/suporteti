import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ChatNotificationProvider } from "@/lib/chat-notifications";
import { AppLayout } from "@/components/layout/app-layout";
import { Suspense, lazy, useEffect } from "react";

// Pages
const Login = lazy(() => import("@/pages/login"));
const Register = lazy(() => import("@/pages/register"));
const Pending = lazy(() => import("@/pages/pending"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Tickets = lazy(() => import("@/pages/tickets"));
const NewTicket = lazy(() => import("@/pages/new-ticket"));
const TicketDetail = lazy(() => import("@/pages/ticket-detail"));
const TicketReceipt = lazy(() => import("@/pages/ticket-receipt"));
const Reports = lazy(() => import("@/pages/reports"));
const Settings = lazy(() => import("@/pages/settings"));
const Profile = lazy(() => import("@/pages/profile"));
const Chat = lazy(() => import("@/pages/chat"));
const PriorityPreview = lazy(() => import("@/pages/priority-preview"));
const NotFound = lazy(() => import("@/pages/not-found"));

const queryClient = new QueryClient();

function Redirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation(to);
  }, [setLocation, to]);
  return null;
}

function ProtectedRoute({ component: Component, ...rest }: any) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) return null; // handled by AppLayout

  return (
    <Route
      {...rest}
      component={(props) => {
        // Redirections logic handled in AppLayout slightly, but let's be strict here
        if (!user) {
          return <Redirect to="/" />;
        }
        if (user.status === "PENDING" && window.location.pathname !== "/pendente") {
          return <Redirect to="/pendente" />;
        }
        if (!user.birthDate && window.location.pathname !== "/perfil") {
          return <Redirect to="/perfil" />;
        }
        if (rest.adminOnly && user.role !== "ADMIN") {
          return <Redirect to="/dashboard" />;
        }
        return <Component {...props} />;
      }}
    />
  );
}

function Router() {
  return (
    <AppLayout>
      <Suspense
        fallback={
          <div className="min-h-[50vh] flex items-center justify-center">
            <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        }
      >
        <Switch>
          <Route path="/" component={Login} />
          <Route path="/registro" component={Register} />
          
          <ProtectedRoute path="/pendente" component={Pending} />
          <ProtectedRoute path="/dashboard" component={Dashboard} />
          <ProtectedRoute path="/chamados" component={Tickets} />
          <ProtectedRoute path="/chamados/novo" component={NewTicket} />
          <ProtectedRoute path="/chamados/:id/comprovante" component={TicketReceipt} />
          <ProtectedRoute path="/chamados/:id" component={TicketDetail} />
          <ProtectedRoute path="/chat" component={Chat} />
          <ProtectedRoute path="/relatorios" component={Reports} adminOnly />
          <ProtectedRoute path="/configuracoes" component={Settings} />
          <ProtectedRoute path="/perfil" component={Profile} />
          <Route path="/preview/prioridades" component={PriorityPreview} />
  
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <ChatNotificationProvider>
              <Router />
            </ChatNotificationProvider>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
