import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../lib/auth-context";
import { colors, radius, spacing } from "../theme";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";

// Equivalente mobile de src/pages/pending.tsx do app web: conta criada mas
// ainda aguardando aprovacao de um administrador (user.status === "PENDING").
export default function PendingScreen() {
  const { user, logout } = useAuth();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.iconBox}>
        <Ionicons name="time-outline" size={32} color={colors.primary} />
      </View>
      <Text style={styles.title}>Acesso Pendente</Text>
      <Text style={styles.subtitle}>
        Olá, {user?.name}. Sua conta foi criada com sucesso, mas precisa ser aprovada por um
        administrador antes de você poder acessar o sistema.
      </Text>

      <Card style={styles.infoCard}>
        <Text style={styles.infoLine}>
          <Text style={styles.infoLabel}>E-mail: </Text>
          {user?.email}
        </Text>
        <Text style={styles.infoLine}>
          <Text style={styles.infoLabel}>Região: </Text>
          {user?.municipality} - {user?.uf}
        </Text>
        <Text style={styles.infoLine}>
          <Text style={styles.infoLabel}>Status: </Text>
          Aguardando aprovação
        </Text>
      </Card>

      <Button label="Sair" variant="secondary" onPress={() => void logout()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: spacing.xl, backgroundColor: colors.background, gap: spacing.lg },
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.infoBg,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: spacing.xxl,
  },
  title: { fontSize: 22, fontWeight: "800", color: colors.textPrimary, textAlign: "center" },
  subtitle: { color: colors.textSecondary, textAlign: "center" },
  infoCard: { gap: spacing.xs },
  infoLine: { color: colors.textPrimary, fontSize: 13 },
  infoLabel: { fontWeight: "700" },
});
