import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { setAuthTokenGetter } from "@workspace/api-client-react/custom-fetch";
import { useGetMe, getGetMeQueryKey, User } from "@workspace/api-client-react";

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Inicialização imediata — garante que o getter está configurado antes de qualquer requisição
setAuthTokenGetter(() => localStorage.getItem("ti_support_token"));

function dbg(event: Record<string, unknown>) {
  const reporter = (window as any).__ti_dbg as undefined | ((payload: Record<string, unknown>) => Promise<void> | void);
  if (typeof reporter !== "function") return;
  try {
    void reporter(event);
  } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(
    () => localStorage.getItem("ti_support_token")
  );
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: user, isLoading, isError } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
      queryKey: getGetMeQueryKey(),
    },
  });

  useEffect(() => {
    dbg({
      level: "info",
      source: "auth.state",
      tokenPresent: Boolean(token),
      isLoading: Boolean(isLoading && !!token),
      isError: Boolean(isError),
      userStatus: (user as any)?.status ?? null,
      userRole: (user as any)?.role ?? null,
    });
  }, [token, isLoading, isError, user]);

  useEffect(() => {
    if (isError) {
      dbg({
        level: "warn",
        source: "auth.invalid_token",
        action: "clear_and_redirect",
      });
      // Token inválido ou expirado — limpa tudo
      localStorage.removeItem("ti_support_token");
      setAuthTokenGetter(() => null);
      setTokenState(null);
      setLocation("/");
    }
  }, [isError, setLocation]);

  const login = (newToken: string) => {
    dbg({
      level: "info",
      source: "auth.login",
      action: "set_token_and_invalidate_me",
    });
    // Configura o getter IMEDIATAMENTE antes de qualquer requisição
    localStorage.setItem("ti_support_token", newToken);
    setAuthTokenGetter(() => newToken);
    setTokenState(newToken);
    // Invalida o cache do /me para buscar com o novo token
    queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
  };

  const logout = () => {
    dbg({
      level: "info",
      source: "auth.logout",
      action: "clear_and_redirect",
    });
    localStorage.removeItem("ti_support_token");
    setAuthTokenGetter(() => null);
    setTokenState(null);
    queryClient.clear();
    setLocation("/");
  };

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        token,
        login,
        logout,
        isLoading: isLoading && !!token,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
