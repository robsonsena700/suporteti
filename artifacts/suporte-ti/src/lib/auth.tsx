import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useLocation } from "wouter";
import { setAuthTokenGetter } from "@workspace/api-client-react/custom-fetch";
import { useGetMe, User } from "@workspace/api-client-react";

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Initial token setup for api client
const initialToken = localStorage.getItem("ti_support_token");
if (initialToken) {
  setAuthTokenGetter(() => initialToken);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(initialToken);
  const [, setLocation] = useLocation();

  const { data: user, isLoading, isError, error } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
    },
  });

  useEffect(() => {
    setAuthTokenGetter(() => token);
    if (token) {
      localStorage.setItem("ti_support_token", token);
    } else {
      localStorage.removeItem("ti_support_token");
    }
  }, [token]);

  useEffect(() => {
    if (isError) {
      setTokenState(null);
      setLocation("/");
    }
  }, [isError, setLocation]);

  const login = (newToken: string) => {
    setTokenState(newToken);
  };

  const logout = () => {
    setTokenState(null);
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
