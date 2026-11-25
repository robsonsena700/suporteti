import * as SecureStore from "expo-secure-store";

// Mesma chave usada pelo app web (localStorage) em artifacts/suporte-ti/src/lib/auth.tsx,
// so que aqui persistida em armazenamento seguro do dispositivo.
const TOKEN_KEY = "ti_support_token";

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // ignore
  }
}
