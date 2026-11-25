import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  getListResolvedTicketsQueryKey,
  getListTicketsQueryKey,
  ListTicketsType,
  useListResolvedTickets,
  useListTickets,
  type Ticket,
} from "@workspace/api-client-react";

import type { TicketsScreenProps } from "../navigation/RootNavigator";
import { useAuth } from "../lib/auth-context";
import { colors, PRIORITY_META, radius, spacing, STATUS_META, TYPE_META } from "../theme";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Chip } from "../components/ui/Chip";
import { TextField } from "../components/ui/TextField";
import { Button } from "../components/ui/Button";

type TabKey = "SOFTWARE" | "HARDWARE" | "RESOLVED";

const TABS: { key: TabKey; label: string }[] = [
  { key: "SOFTWARE", label: "Sistema" },
  { key: "HARDWARE", label: "Equipamentos" },
  { key: "RESOLVED", label: "Resolvidos" },
];

function formatDate(iso: string) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export default function TicketsScreen({ navigation, route }: TicketsScreenProps) {
  const { user } = useAuth();
  // Mesma regra do app web: somente quem pode gerenciar vê "Meus chamados" (o
  // backend devolve 403 se mine=true for enviado por um USER comum, que já só
  // vê os próprios chamados por padrão); "Sem coordenador" é restrito a
  // ADMIN/ANALYST.
  const canManageRole =
    user?.role === "ADMIN" || user?.role === "ANALYST" || user?.role === "COORDINATOR" || user?.role === "GESTOR";
  const canSeeNoCoordinatorFilter = user?.role === "ADMIN" || user?.role === "ANALYST";

  const initialFilter = route.params?.initialFilter;
  const [tab, setTab] = useState<TabKey>("SOFTWARE");
  const [search, setSearch] = useState("");
  const [mine, setMine] = useState(canManageRole && initialFilter === "mine");
  const [noCoordinator, setNoCoordinator] = useState(canSeeNoCoordinatorFilter && initialFilter === "noCoordinator");

  const openParams = {
    type: tab === "RESOLVED" ? undefined : (tab as ListTicketsType),
    mine: mine || undefined,
    noCoordinator: noCoordinator || undefined,
  };
  const resolvedParams = { mine: mine || undefined, noCoordinator: noCoordinator || undefined };

  const openQuery = useListTickets(openParams, {
    query: { enabled: tab !== "RESOLVED", queryKey: getListTicketsQueryKey(openParams) },
  });
  const resolvedQuery = useListResolvedTickets(resolvedParams, {
    query: { enabled: tab === "RESOLVED", queryKey: getListResolvedTicketsQueryKey(resolvedParams) },
  });

  const activeQuery = tab === "RESOLVED" ? resolvedQuery : openQuery;
  const tickets: Ticket[] = activeQuery.data ?? [];

  const filteredTickets = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tickets;
    return tickets.filter(
      (t) =>
        t.title.toLowerCase().includes(term) ||
        String(t.id).includes(term) ||
        (t.establishment ?? "").toLowerCase().includes(term),
    );
  }, [tickets, search]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chamados</Text>
        <Pressable onPress={() => navigation.navigate("NewTicket")} style={styles.newButton}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.newButtonText}>Novo</Text>
        </Pressable>
      </View>

      <View style={styles.tabsRow}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.filtersBlock}>
        <TextField
          label=""
          icon="search-outline"
          placeholder="Buscar por título, nº ou unidade"
          value={search}
          onChangeText={setSearch}
        />
        {(canManageRole || canSeeNoCoordinatorFilter) ? (
          <View style={styles.chipsRow}>
            {canManageRole ? (
              <Chip label="Meus chamados" selected={mine} onPress={() => setMine((v) => !v)} />
            ) : null}
            {canSeeNoCoordinatorFilter ? (
              <Chip label="Sem coordenador" selected={noCoordinator} onPress={() => setNoCoordinator((v) => !v)} />
            ) : null}
          </View>
        ) : null}
      </View>

      {activeQuery.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : activeQuery.isError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Não foi possível carregar os chamados.</Text>
          <Button label="Tentar novamente" variant="secondary" onPress={() => activeQuery.refetch()} />
        </View>
      ) : (
        <FlatList
          data={filteredTickets}
          keyExtractor={(item) => String(item.id)}
          refreshing={activeQuery.isRefetching}
          onRefresh={() => activeQuery.refetch()}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.emptyText}>Nenhum chamado encontrado.</Text>}
          renderItem={({ item }) => {
            const statusMeta = STATUS_META[item.status] ?? { label: item.status, color: colors.textSecondary, bg: colors.neutralBg };
            const priorityMeta = PRIORITY_META[item.priority] ?? { label: item.priority, color: colors.textSecondary, bg: colors.neutralBg };
            const typeMeta = TYPE_META[item.type] ?? { label: item.type };
            const noCoordinatorOwner = item.ownerHasCoordinator === false;
            const isGestorTicket = item.createdBy?.role === "GESTOR";
            return (
              <Pressable onPress={() => navigation.navigate("TicketDetail", { ticketId: item.id })}>
                <Card style={[styles.ticketCard, noCoordinatorOwner && styles.ticketCardNoCoordinator]}>
                  <View style={styles.ticketHeaderRow}>
                    <Text style={styles.ticketId}>#{item.id}</Text>
                    <Badge label={statusMeta.label} color={statusMeta.color} bg={statusMeta.bg} />
                  </View>
                  <Text style={styles.ticketTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.ticketMeta}>
                    {item.createdBy?.name ?? "—"} • {item.uf} - {item.municipality}
                  </Text>
                  <Text style={styles.ticketMeta}>
                    {typeMeta.label} • {item.establishment ?? "—"}
                  </Text>
                  {noCoordinatorOwner || isGestorTicket ? (
                    <View style={styles.tagsRow}>
                      {noCoordinatorOwner ? (
                        <View style={styles.noCoordinatorBadge}>
                          <Text style={styles.noCoordinatorBadgeText}>Sem coordenador</Text>
                        </View>
                      ) : null}
                      {isGestorTicket ? (
                        <View style={styles.gestorBadge}>
                          <Text style={styles.gestorBadgeText}>Chamado do Gestor associado</Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  <View style={styles.ticketFooterRow}>
                    <Badge label={priorityMeta.label} color={priorityMeta.color} bg={priorityMeta.bg} />
                    {item.imageAttachmentsCount ? (
                      <View style={styles.attachmentBadge}>
                        <Ionicons name="attach-outline" size={12} color={colors.textSecondary} />
                        <Text style={styles.attachmentText}>{item.imageAttachmentsCount}</Text>
                      </View>
                    ) : null}
                    <Text style={styles.ticketDate}>{formatDate(item.createdAt)}</Text>
                  </View>
                  <View style={styles.assignedRow}>
                    <Text style={styles.assignedLabel}>Responsável</Text>
                    <Text style={styles.assignedValue} numberOfLines={1}>{item.assignedTo?.name ?? "Não atribuído"}</Text>
                  </View>
                </Card>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  headerTitle: { fontSize: 22, fontWeight: "800", color: colors.textPrimary },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  newButtonText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  tabsRow: { flexDirection: "row", paddingHorizontal: spacing.lg, marginTop: spacing.md, gap: spacing.sm },
  tab: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: "center", backgroundColor: colors.surface },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  tabTextActive: { color: "#fff" },
  filtersBlock: { paddingHorizontal: spacing.lg, marginTop: spacing.md, gap: spacing.sm },
  chipsRow: { flexDirection: "row", gap: spacing.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  errorText: { color: colors.textSecondary, textAlign: "center" },
  listContent: { padding: spacing.lg, gap: spacing.md },
  emptyText: { textAlign: "center", color: colors.textSecondary, marginTop: spacing.xxl },
  ticketCard: { gap: spacing.xs, marginBottom: spacing.md },
  ticketHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  ticketId: { color: colors.textSecondary, fontWeight: "700", fontSize: 12 },
  ticketTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  ticketMeta: { color: colors.textSecondary, fontSize: 12 },
  ticketFooterRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  attachmentBadge: { flexDirection: "row", alignItems: "center", gap: 2 },
  attachmentText: { color: colors.textSecondary, fontSize: 12 },
  ticketDate: { color: colors.textSecondary, fontSize: 11, marginLeft: "auto" },
  ticketCardNoCoordinator: { borderWidth: 1, borderColor: colors.warning },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  noCoordinatorBadge: { backgroundColor: colors.warningBg, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  noCoordinatorBadgeText: { color: colors.warning, fontSize: 11, fontWeight: "700" },
  gestorBadge: { backgroundColor: colors.infoBg, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  gestorBadgeText: { color: colors.info, fontSize: 11, fontWeight: "700" },
  assignedRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xs, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  assignedLabel: { color: colors.textSecondary, fontSize: 11 },
  assignedValue: { color: colors.textPrimary, fontSize: 12, fontWeight: "600", maxWidth: "60%" },
});
