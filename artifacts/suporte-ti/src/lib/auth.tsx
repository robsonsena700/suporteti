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
    },
  });

  useEffect(() => {
    if (isError) {
      // Token inválido ou expirado — limpa tudo
      localStorage.removeItem("ti_support_token");
      setAuthTokenGetter(() => null);
      setTokenState(null);
      setLocation("/");
    }
  }, [isError, setLocation]);

  const login = (newToken: string) => {
    // Configura o getter IMEDIATAMENTE antes de qualquer requisição
    localStorage.setItem("ti_support_token", newToken);
    setAuthTokenGetter(() => newToken);
    setTokenState(newToken);
    // Invalida o cache do /me para buscar com o novo token
    queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
  };

  const logout = () => {
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
