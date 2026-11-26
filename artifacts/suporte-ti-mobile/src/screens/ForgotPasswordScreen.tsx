import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useForgotPassword } from "@workspace/api-client-react";
import { ApiError } from "@workspace/api-client-react/custom-fetch";

import type { ForgotPasswordScreenProps } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { Card } from "../components/ui/Card";

export default function ForgotPasswordScreen({ navigation }: ForgotPasswordScreenProps) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mutation = useForgotPassword();

  const handleSubmit = () => {
    setErrorMessage(null);
    mutation.mutate(
      { data: { email: email.trim() } },
      {
        // O backend sempre responde 200 aqui mesmo quando o e-mail nao esta
        // cadastrado (pra nao revelar quais contas existem) - so o SUCESSO
        // da requisicao mostra a tela "verifique seu e-mail". Uma falha real
        // (rede, 500 etc.) mostra erro de verdade, igual forgot-password.tsx
        // do app web faz no catch.
        onSuccess: () => setSent(true),
        onError: (err) => {
          setErrorMessage(
            err instanceof ApiError
              ? (err.data as { error?: string } | null)?.error ?? "Tente novamente em instantes."
              : "Não foi possível solicitar a recuperação. Verifique sua conexão.",
          );
        },
      },
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.iconBox}>
        <Text style={styles.iconText}>🔑</Text>
      </View>
      <Text style={styles.title}>Recuperar senha</Text>
      <Text style={styles.subtitle}>
        Informe seu e-mail cadastrado para receber um link de redefinição válido por 1 hora.
      </Text>

      {sent ? (
        <Card style={styles.successCard}>
          <Text style={styles.successText}>
            Se o e-mail informado estiver cadastrado, você receberá um link de redefinição em
            instantes.
          </Text>
          <Button label="Voltar para o login" variant="secondary" onPress={() => navigation.goBack()} />
        </Card>
      ) : (
        <View style={styles.form}>
          <TextField
            label="E-mail"
            icon="mail-outline"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
          <Button label="Enviar link" onPress={handleSubmit} loading={mutation.isPending} disabled={!email} />
          <Text style={styles.backLink} onPress={() => navigation.goBack()}>
            Voltar para o login
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: spacing.xl, backgroundColor: colors.background },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.infoBg,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: spacing.xl,
  },
  iconText: { fontSize: 24 },
  title: { fontSize: 22, fontWeight: "800", textAlign: "center", marginTop: spacing.md, color: colors.textPrimary },
  subtitle: {
    textAlign: "center",
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  form: { gap: spacing.lg, backgroundColor: colors.surface, padding: spacing.lg, borderRadius: radius.lg },
  backLink: { color: colors.accent, textAlign: "center", fontWeight: "600" },
  error: { color: colors.danger, textAlign: "center" },
  successCard: { gap: spacing.lg, alignItems: "center" },
  successText: { textAlign: "center", color: colors.textPrimary },
});
