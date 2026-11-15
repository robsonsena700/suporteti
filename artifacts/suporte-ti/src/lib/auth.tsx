import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ApiError, setAuthTokenGetter } from "@workspace/api-client-react/custom-fetch";
import { useGetMe, getGetMeQueryKey, User, logout as logoutRequest } from "@workspace/api-client-react";

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  isLoading: boolean;
  /**
   * true quando a checagem de sessao falhou por um motivo que NAO indica
   * token invalido (timeout, sem rede, erro 5xx) — nesses casos nao
   * derrubamos a sessao do usuario, so oferecemos "tentar novamente".
   */
  isConnectionError: boolean;
  retry: () => void;
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

  const { data: user, isLoading, isError, error, refetch } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
      queryKey: getGetMeQueryKey(),
    },
  });

  // Só um 401/403 de fato significa "token invalido". Qualquer outra falha
  // (timeout, sem rede, 5xx) é passageira — tratar como "token invalido" aqui
  // derrubaria a sessão de um usuário com conexão instável (comum no mobile)
  // mesmo com um token perfeitamente válido.
  const isAuthRejection = error instanceof ApiError && (error.status === 401 || error.status === 403);
  const isConnectionError = isError && !isAuthRejection;

  useEffect(() => {
    dbg({
      level: "info",
      source: "auth.state",
      tokenPresent: Boolean(token),
      isLoading: Boolean(isLoading && !!token),
      isError: Boolean(isError),
      isConnectionError,
      errorName: error instanceof Error ? error.name : null,
      userStatus: (user as any)?.status ?? null,
      userRole: (user as any)?.role ?? null,
    });
  }, [token, isLoading, isError, isConnectionError, error, user]);

  useEffect(() => {
    if (isAuthRejection) {
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
    } else if (isConnectionError) {
      dbg({
        level: "warn",
        source: "auth.connection_error",
        action: "keep_session_offer_retry",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [isAuthRejection, isConnectionError, error, setLocation]);

  const retry = () => {
    dbg({ level: "info", source: "auth.retry", action: "refetch_me" });
    void refetch();
  };

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
    // Avisa o backend ANTES de limpar o localStorage: o customFetch le o token
    // pelo getter configurado acima, entao se a chave fosse removida primeiro a
    // requisicao sairia sem Authorization e nao revogaria nada. Sem "await" de
    // proposito: a saida do usuario nao pode travar por causa da rede. Se a
    // chamada falhar, o pior caso e o comportamento antigo (token seguia valido
    // ate expirar), e nao um erro na tela.
    void logoutRequest().catch(() => {});
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
        isConnectionError,
        retry,
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
