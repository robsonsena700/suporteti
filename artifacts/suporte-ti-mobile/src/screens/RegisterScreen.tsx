import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRegister } from "@workspace/api-client-react";
import { ApiError } from "@workspace/api-client-react/custom-fetch";

import type { RegisterScreenProps } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { Chip } from "../components/ui/Chip";

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function formatCpf(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);
  if (d.length <= 3) return p1;
  if (d.length <= 6) return `${p1}.${p2}`;
  if (d.length <= 9) return `${p1}.${p2}.${p3}`;
  return `${p1}.${p2}.${p3}-${p4}`;
}

export default function RegisterScreen({ navigation }: RegisterScreenProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [cpf, setCpf] = useState("");
  const [establishment, setEstablishment] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [uf, setUf] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [prefersWhatsapp, setPrefersWhatsapp] = useState(false);
  const [prefersTelegram, setPrefersTelegram] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const registerMutation = useRegister();

  const requiredFilled =
    name && email && password && birthDate && cpf && establishment && contactPhone && uf && municipality && termsAccepted;

  const handleSubmit = () => {
    setErrorMessage(null);
    registerMutation.mutate(
      {
        data: {
          name,
          email: email.trim(),
          password,
          // Input e um texto simples "AAAA-MM-DD"; o tipo gerado do client
          // espera string (igual ao <input type="date"> do app web).
          birthDate,
          cpf: onlyDigits(cpf),
          establishment,
          contactPhone,
          prefersWhatsapp,
          prefersTelegram,
          termsAccepted,
          uf: uf.trim().toUpperCase(),
          municipality,
        },
      },
      {
        onSuccess: () => setSuccess(true),
        onError: (err) => {
          if (err instanceof ApiError) {
            setErrorMessage((err.data as { error?: string } | null)?.error ?? "Ocorreu um erro durante o cadastro.");
          } else {
            setErrorMessage("Não foi possível enviar seu cadastro. Verifique sua conexão.");
          }
        },
      },
    );
  };

  if (success) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.form}>
          <Text style={styles.successTitle}>Cadastro realizado</Text>
          <Text style={styles.successText}>
            Sua conta ficará pendente até aprovação do administrador.
          </Text>
          <Button label="Voltar para o login" onPress={() => navigation.navigate("Login")} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.subtitle}>
        Preencha os dados abaixo para solicitar acesso ao sistema de chamados.
      </Text>

      <View style={styles.form}>
        <TextField
          label="Nome completo"
          icon="person-outline"
          placeholder="João da Silva"
          value={name}
          onChangeText={setName}
        />
        <TextField
          label="E-mail"
          icon="mail-outline"
          placeholder="joao@orgao.gov.br"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextField label="Senha" icon="lock-closed-outline" secureToggle secureTextEntry value={password} onChangeText={setPassword} />
        <TextField
          label="Data de nascimento (AAAA-MM-DD)"
          icon="calendar-outline"
          placeholder="1990-05-20"
          value={birthDate}
          onChangeText={setBirthDate}
        />
        <TextField
          label="CPF"
          icon="card-outline"
          placeholder="000.000.000-00"
          keyboardType="number-pad"
          value={cpf}
          onChangeText={(text) => setCpf(formatCpf(text))}
        />
        <TextField
          label="Estabelecimento / Unidade de saúde"
          icon="business-outline"
          value={establishment}
          onChangeText={setEstablishment}
        />
        <TextField
          label="Telefone de contato"
          icon="call-outline"
          keyboardType="phone-pad"
          value={contactPhone}
          onChangeText={setContactPhone}
        />
        <View style={styles.row}>
          <View style={styles.flex1}>
            <TextField label="UF" icon="map-outline" autoCapitalize="characters" maxLength={2} value={uf} onChangeText={setUf} />
          </View>
          <View style={styles.flex2}>
            <TextField label="Município" icon="location-outline" value={municipality} onChangeText={setMunicipality} />
          </View>
        </View>

        <Text style={styles.sectionLabel}>Preferência de contato</Text>
        <View style={styles.chipsRow}>
          <Chip label="WhatsApp" selected={prefersWhatsapp} onPress={() => setPrefersWhatsapp((v) => !v)} />
          <Chip label="Telegram" selected={prefersTelegram} onPress={() => setPrefersTelegram((v) => !v)} />
        </View>

        <Chip
          label={termsAccepted ? "✓ Aceito os termos de uso" : "Aceito os termos de uso"}
          selected={termsAccepted}
          onPress={() => setTermsAccepted((v) => !v)}
        />

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        <Button label="Enviar solicitação" onPress={handleSubmit} loading={registerMutation.isPending} disabled={!requiredFilled} />
        <Text style={styles.backLink} onPress={() => navigation.navigate("Login")}>
          Já tenho uma conta
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: spacing.xl, backgroundColor: colors.background },
  subtitle: { color: colors.textSecondary, textAlign: "center", marginBottom: spacing.lg },
  form: { gap: spacing.lg, backgroundColor: colors.surface, padding: spacing.lg, borderRadius: radius.lg },
  row: { flexDirection: "row", gap: spacing.md },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  sectionLabel: { fontWeight: "700", color: colors.textPrimary, marginTop: spacing.sm },
  chipsRow: { flexDirection: "row", gap: spacing.sm },
  error: { color: colors.danger, textAlign: "center" },
  backLink: { color: colors.accent, textAlign: "center", fontWeight: "600" },
  successTitle: { fontSize: 20, fontWeight: "800", color: colors.textPrimary, textAlign: "center" },
  successText: { color: colors.textSecondary, textAlign: "center" },
});
