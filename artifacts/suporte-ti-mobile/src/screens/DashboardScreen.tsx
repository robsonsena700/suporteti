import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  getGetRecentActivityQueryKey,
  getGetReportSummaryQueryKey,
  useGetRecentActivity,
  useGetReportSummary,
} from "@workspace/api-client-react";

import type { DashboardScreenProps } from "../navigation/RootNavigator";
import { useAuth } from "../lib/auth-context";
import { colors, radius, spacing } from "../theme";
import { Card } from "../components/ui/Card";

function StatCard({
  icon,
  label,
  value,
  color,
  bg,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number | string;
  color: string;
  bg: string;
}) {
  return (
    <Card style={styles.statCard}>
      <View style={[styles.statIconBox, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.round(hours / 24);
  return `há ${days}d`;
}

export default function DashboardScreen({ navigation }: DashboardScreenProps) {
  const { user, logout } = useAuth();
  const summaryQuery = useGetReportSummary(undefined, {
    query: { refetchOnMount: true, queryKey: getGetReportSummaryQueryKey() },
  });
  const activityQuery = useGetRecentActivity(undefined, {
    query: { refetchOnMount: true, queryKey: getGetRecentActivityQueryKey() },
  });

  const summary = summaryQuery.data;
  const activity = activityQuery.data ?? [];
  const refreshing = summaryQuery.isFetching || activityQuery.isFetching;

  const onRefresh = () => {
    summaryQuery.refetch();
    activityQuery.refetch();
  };

  // Mesma regra de permissão usada em TicketsScreen: evita abrir um atalho
  // que o backend rejeitaria (403) para o papel do usuário atual.
  const canSeeMineFilter =
    user?.role === "ADMIN" || user?.role === "ANALYST" || user?.role === "COORDINATOR" || user?.role === "GESTOR";
  const canSeeNoCoordinatorFilter = user?.role === "ADMIN" || user?.role === "ANALYST";

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.greeting}>Olá, {user?.name?.split(" ")[0] ?? "bem-vindo"} 👋</Text>
          <Text style={styles.subtitle}>Aqui está um resumo dos chamados de TI</Text>
        </View>
        <Pressable onPress={() => void logout()} style={styles.logoutButton} hitSlop={8}>
          <Ionicons name="log-out-outline" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.statsGrid}>
        <StatCard icon="file-tray-full-outline" label="Total" value={summary?.totalTickets ?? "–"} color={colors.primary} bg={colors.neutralBg} />
        <StatCard icon="time-outline" label="Em aberto" value={summary?.openTickets ?? "–"} color={colors.info} bg={colors.infoBg} />
        <StatCard icon="construct-outline" label="Em andamento" value={summary?.inProgressTickets ?? "–"} color={colors.warning} bg={colors.warningBg} />
        <StatCard icon="checkmark-done-outline" label="Resolvidos" value={summary?.resolvedTickets ?? "–"} color={colors.success} bg={colors.successBg} />
        <StatCard icon="close-circle-outline" label="Cancelados" value={summary?.closedTickets ?? "–"} color={colors.textSecondary} bg={colors.neutralBg} />
      </View>

      {(canSeeMineFilter || canSeeNoCoordinatorFilter) ? (
        <>
          <Text style={styles.sectionTitle}>Filtros rápidos</Text>
          <View style={styles.quickFilters}>
            {canSeeMineFilter ? (
              <Card style={styles.quickFilterCard}>
                <Text
                  style={styles.quickFilterText}
                  onPress={() => navigation.navigate("Tickets", { initialFilter: "mine" })}
                >
                  📋 Meus chamados
                </Text>
              </Card>
            ) : null}
            {canSeeNoCoordinatorFilter ? (
              <Card style={styles.quickFilterCard}>
                <Text
                  style={styles.quickFilterText}
                  onPress={() => navigation.navigate("Tickets", { initialFilter: "noCoordinator" })}
                >
                  🧭 Sem coordenador
                </Text>
              </Card>
            ) : null}
          </View>
        </>
      ) : null}

      <Text style={styles.sectionTitle}>Atividade recente</Text>
      <Card>
        {activity.length === 0 ? (
          <Text style={styles.emptyText}>Nenhuma atividade recente.</Text>
        ) : (
          activity.slice(0, 8).map((item, index) => (
            <View key={item.id} style={[styles.activityRow, index > 0 && styles.activityRowBorder]}>
              <View style={styles.activityDot} />
              <View style={styles.flex1}>
                <Text style={styles.activityText}>
                  <Text style={styles.activityUser}>{item.userName}</Text> {item.action} em{" "}
                  <Text
                    style={styles.activityTicket}
                    onPress={() => navigation.navigate("TicketDetail", { ticketId: item.ticketId })}
                  >
                    {item.ticketTitle}
                  </Text>
                </Text>
                <Text style={styles.activityTime}>{timeAgo(item.createdAt)}</Text>
              </View>
            </View>
          ))
        )}
      </Card>

      <Text style={styles.sectionTitle}>Desempenho Geral</Text>
      <Card style={styles.performanceCard}>
        <View style={styles.performanceRow}>
          <Ionicons name="star-outline" size={16} color={colors.warning} />
          <Text style={styles.performanceLabel}>Avaliação Média</Text>
        </View>
        <View style={styles.performanceValueRow}>
          <Text style={styles.performanceValue}>
            {summary?.avgRating ? summary.avgRating.toFixed(1) : "–"}
          </Text>
          <Text style={styles.performanceUnit}>/ 5.0</Text>
        </View>

        <View style={[styles.performanceRow, styles.performanceRowSpaced]}>
          <Ionicons name="hourglass-outline" size={16} color={colors.info} />
          <Text style={styles.performanceLabel}>Tempo Médio de Resolução</Text>
        </View>
        <View style={styles.performanceValueRow}>
          <Text style={styles.performanceValue}>
            {summary?.avgResolutionHours ? Math.round(summary.avgResolutionHours) : "–"}
          </Text>
          <Text style={styles.performanceUnit}>horas</Text>
        </View>

        {(user?.role === "ADMIN" || user?.role === "COORDINATOR") && (
          <View style={styles.usersRow}>
            <Text style={styles.usersLabel}>Usuários do Sistema</Text>
            <View style={styles.usersValueRow}>
              <Text style={styles.usersValue}>{summary?.totalUsers ?? 0}</Text>
              {summary?.pendingUsers ? (
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingBadgeText}>{summary.pendingUsers} pendentes</Text>
                </View>
              ) : null}
            </View>
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  greeting: { fontSize: 22, fontWeight: "800", color: colors.textPrimary },
  subtitle: { color: colors.textSecondary, marginTop: -spacing.sm },
  logoutButton: { padding: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.pill },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  statCard: { width: "47%", gap: spacing.sm },
  statIconBox: { width: 32, height: 32, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: 24, fontWeight: "800", color: colors.textPrimary },
  statLabel: { color: colors.textSecondary, fontSize: 12 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  quickFilters: { flexDirection: "row", gap: spacing.md },
  quickFilterCard: { flex: 1 },
  quickFilterText: { fontWeight: "600", color: colors.textPrimary },
  emptyText: { color: colors.textSecondary, textAlign: "center", paddingVertical: spacing.md },
  activityRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.sm },
  activityRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  activityDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginTop: 6 },
  flex1: { flex: 1 },
  activityText: { color: colors.textPrimary, fontSize: 13, lineHeight: 18 },
  activityUser: { fontWeight: "700" },
  activityTicket: { fontWeight: "700", color: colors.accent },
  activityTime: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  performanceCard: { gap: spacing.xs },
  performanceRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  performanceRowSpaced: { marginTop: spacing.md },
  performanceLabel: { fontWeight: "600", color: colors.textPrimary, fontSize: 13 },
  performanceValueRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs },
  performanceValue: { fontSize: 28, fontWeight: "800", color: colors.textPrimary },
  performanceUnit: { color: colors.textSecondary, fontSize: 12 },
  usersRow: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  usersLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  usersValueRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  usersValue: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  pendingBadge: { backgroundColor: colors.dangerBg, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  pendingBadgeText: { color: colors.danger, fontSize: 12, fontWeight: "600" },
});
