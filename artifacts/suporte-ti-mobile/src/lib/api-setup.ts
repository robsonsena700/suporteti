import Constants from "expo-constants";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";

import { getToken } from "./token-storage";

let apiBaseUrl: string | null = null;

/**
 * Deve ser chamado uma unica vez, antes de qualquer tela renderizar, para
 * configurar o cliente de API compartilhado (@workspace/api-client-react)
 * com a URL base do servidor e o getter de token de autenticacao.
 */
export function configureApiClient(): void {
  // EXPO_PUBLIC_API_BASE_URL (lido de um .env local, nao versionado) tem
  // prioridade sobre o valor fixo de app.json - assim da pra apontar pro
  // backend local (dev.cjs) sem mexer no valor de producao usado em build.
  const configured =
    process.env.EXPO_PUBLIC_API_BASE_URL ||
    (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl;

  if (!configured) {
    throw new Error(
      "apiBaseUrl nao configurado (defina EXPO_PUBLIC_API_BASE_URL no .env ou expo.extra.apiBaseUrl no app.json).",
    );
  }

  apiBaseUrl = configured.replace(/\/+$/, "");
  setBaseUrl(apiBaseUrl);
  setAuthTokenGetter(() => getToken());
}

/**
 * URL base do servidor da API, para chamadas que nao passam pelo
 * customFetch (ex: uploads multipart feitos com fetch() cru).
 */
export function getApiBaseUrl(): string {
  if (!apiBaseUrl) {
    throw new Error("configureApiClient() precisa ser chamado antes de usar a API.");
  }
  return apiBaseUrl;
}
