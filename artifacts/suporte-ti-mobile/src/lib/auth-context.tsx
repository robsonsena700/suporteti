import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { getGetMeQueryKey, useGetMe, type User } from "@workspace/api-client-react";
import { ApiError } from "@workspace/api-client-react/custom-fetch";

import { clearToken, getToken, setToken as persistToken } from "./token-storage";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isConnectionError: boolean;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Enquanto nao sabemos se ha um token salvo, nao disparamos a query de
  // sessao (useGetMe) nem decidimos qual tela mostrar.
  const [tokenChecked, setTokenChecked] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      setHasToken(!!token);
      setTokenChecked(true);
    })();
  }, []);

  const { data: user, isLoading, isError, error, refetch } = useGetMe({
    query: {
      enabled: tokenChecked && hasToken,
      retry: false,
      queryKey: getGetMeQueryKey(),
    },
  });

  // Mesma distincao feita em auth.tsx do app web: so invalida a sessao em
  // rejeicao real (401/403). Qualquer outro erro (timeout, sem rede) mantem
  // o token e oferece "tentar novamente" em vez de deslogar por uma falha
  // passageira de conexao.
  const isAuthRejection =
    error instanceof ApiError && (error.status === 401 || error.status === 403);
  const isConnectionError = isError && !isAuthRejection;

  useEffect(() => {
    if (isAuthRejection) {
      void clearToken();
      setHasToken(false);
    }
  }, [isAuthRejection]);

  const login = useCallback(
    async (token: string) => {
      await persistToken(token);
      setHasToken(true);
      await refetch();
    },
    [refetch],
  );

  const logout = useCallback(async () => {
    await clearToken();
    setHasToken(false);
  }, []);

  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const resolvedUser = tokenChecked && hasToken && user ? user : null;

  return (
    <AuthContext.Provider
      value={{
        user: resolvedUser,
        isLoading: !tokenChecked || (hasToken && isLoading),
        isConnectionError,
        login,
        logout,
        retry,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth precisa ser usado dentro de um AuthProvider.");
  }
  return ctx;
}
