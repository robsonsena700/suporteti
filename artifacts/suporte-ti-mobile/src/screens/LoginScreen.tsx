import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants from "expo-constants";
import { useLogin } from "@workspace/api-client-react";
import { ApiError } from "@workspace/api-client-react/custom-fetch";

import { useAuth } from "../lib/auth-context";
import { getApiBaseUrl } from "../lib/api-setup";
import type { LoginScreenProps } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";

export default function LoginScreen({ navigation }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { login } = useAuth();
  const loginMutation = useLogin();

  const appVersion = Constants.expoConfig?.version ?? "1.0.0";
  // So pra deixar visivel durante os testes a qual backend o app esta
  // apontando (producao fixo do app.json, ou local via .env) - evita
  // confusao tipo "login nao funciona" quando na verdade esta testando
  // contra um ambiente diferente do que se imagina.
  const apiBaseUrl = getApiBaseUrl();
  const envLabel = apiBaseUrl.includes("suporteti.sotechsaude.com.br")
    ? "Produção"
    : `Desenvolvimento (${apiBaseUrl})`;

  const handleSubmit = () => {
    setErrorMessage(null);
    loginMutation.mutate(
      { data: { email: email.trim(), password } },
      {
        onSuccess: async (result) => {
          await login(result.token);
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            // Mesmo padrao do app web (login.tsx): usa a mensagem que o
            // proprio servidor manda (err.data.error), com um fallback
            // generico - evita duplicar textos de erro que podem ficar
            // desalinhados do que o backend realmente responde.
            setErrorMessage((err.data as { error?: string } | null)?.error ?? "Verifique suas credenciais.");
          } else {
            setErrorMessage("Não foi possível entrar. Verifique sua conexão.");
          }
        },
      },
    );
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.logoBox}>
          <Text style={styles.logoText}>TI</Text>
        </View>
        <Text style={styles.title}>SuporteTI</Text>
        <Text style={styles.subtitle}>Acesse o sistema de gestão de chamados</Text>

        <View style={styles.form}>
          <TextField
            label="E-mail"
            icon="mail-outline"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextField
            label="Senha"
            icon="lock-closed-outline"
            secureToggle
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <Text style={styles.forgotLink} onPress={() => navigation.navigate("ForgotPassword")}>
            Esqueci minha senha
          </Text>

          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

          <Button
            label="Entrar"
            onPress={handleSubmit}
            loading={loginMutation.isPending}
            disabled={!email || !password}
          />
        </View>

        <Text style={styles.footerText}>
          Não tem uma conta?{" "}
          <Text style={styles.footerLink} onPress={() => navigation.navigate("Register")}>
            Solicite acesso
          </Text>
        </Text>
        <Text style={styles.versionText}>Versão {appVersion} • {envLabel}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  logoBox: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryDark,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: spacing.lg,
  },
  logoText: { color: "#fff", fontSize: 22, fontWeight: "800" },
  title: { fontSize: 26, fontWeight: "800", textAlign: "center", color: colors.textPrimary },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: spacing.xl,
  },
  form: { gap: spacing.lg, backgroundColor: colors.surface, padding: spacing.lg, borderRadius: radius.lg },
  forgotLink: { color: colors.accent, fontWeight: "600", textAlign: "right", fontSize: 13 },
  error: { color: colors.danger, textAlign: "center" },
  footerText: { textAlign: "center", color: colors.textSecondary, marginTop: spacing.xl },
  footerLink: { color: colors.accent, fontWeight: "700" },
  versionText: { textAlign: "center", color: colors.textSecondary, fontSize: 12, marginTop: spacing.lg },
});
