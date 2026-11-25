import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetTicketQueryKey,
  getListMessagesQueryKey,
  useGetTicket,
  useListMessages,
  type Message,
} from "@workspace/api-client-react";

import type { RootStackParamList } from "../navigation/RootNavigator";
import { getApiBaseUrl } from "../lib/api-setup";
import { getToken } from "../lib/token-storage";
import { colors, PRIORITY_META, radius, spacing, STATUS_META, TYPE_META } from "../theme";
import { Badge } from "../components/ui/Badge";

type Props = NativeStackScreenProps<RootStackParamList, "TicketDetail">;

const SEND_TIMEOUT_MS = 60_000;

function formatDate(iso: string) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function isImageMime(mimeType: string | undefined) {
  return Boolean(mimeType && mimeType.startsWith("image/"));
}

export default function TicketDetailScreen({ route }: Props) {
  const { ticketId } = route.params;
  const queryClient = useQueryClient();

  const ticketQuery = useGetTicket(ticketId);
  const messagesQuery = useListMessages(ticketId);

  const [text, setText] = useState("");
  const [pendingImage, setPendingImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [sending, setSending] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    getToken().then(setAuthToken).catch(() => setAuthToken(null));
  }, []);

  const pickImage = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permissão necessária", "Permita o acesso às fotos para anexar uma imagem.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) {
      setPendingImage(result.assets[0]);
    }
  }, []);

  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permissão necessária", "Permita o acesso à câmera para fotografar o anexo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled && result.assets?.[0]) {
      setPendingImage(result.assets[0]);
    }
  }, []);

  // Mesmo padrão usado em ticket-detail.tsx do app web: fetch() cru (não o
  // hook useCreateMessage gerado) porque o cliente gerado sempre serializa o
  // corpo como JSON, mesmo para o tipo multipart com "files" — o que não
  // funciona para upload real de anexos.
  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed && !pendingImage) return;

    setSending(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const token = await getToken();
      const baseUrl = getApiBaseUrl();
      const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

      let response: Response;
      if (pendingImage) {
        const form = new FormData();
        if (trimmed) form.append("message", trimmed);
        const fileName = pendingImage.fileName || `anexo-${Date.now()}.jpg`;
        form.append(
          "files",
          {
            uri: pendingImage.uri,
            name: fileName,
            type: pendingImage.mimeType || "image/jpeg",
          } as unknown as Blob,
        );
        response = await fetch(`${baseUrl}/api/tickets/${ticketId}/messages`, {
          method: "POST",
          headers: authHeaders,
          body: form,
          signal: controller.signal,
        });
      } else {
        response = await fetch(`${baseUrl}/api/tickets/${ticketId}/messages`, {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed }),
          signal: controller.signal,
        });
      }

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Não foi possível enviar a mensagem.");
      }

      setText("");
      setPendingImage(null);
      await queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(ticketId) });
      await queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(ticketId) });
    } catch (err) {
      Alert.alert(
        "Falha ao enviar",
        err instanceof Error ? err.message : "Verifique sua conexão e tente novamente.",
      );
    } finally {
      clearTimeout(timer);
      setSending(false);
    }
  }, [text, pendingImage, ticketId, queryClient]);

  if (ticketQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (ticketQuery.isError || !ticketQuery.data) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Não foi possível carregar este chamado.</Text>
        <Pressable onPress={() => void ticketQuery.refetch()}>
          <Text style={styles.link}>Tentar novamente</Text>
        </Pressable>
      </View>
    );
  }

  const ticket = ticketQuery.data;
  const messages: Message[] = messagesQuery.data ?? [];
  // GET /tickets/:id (useGetTicket) já retorna o tipo TicketDetail, que
  // inclui os anexos enviados na abertura do chamado (NewTicketScreen envia
  // para POST /tickets/:id/attachments). Sem isto a tela escondia os anexos
  // originais do chamado, mostrando só os anexos enviados via chat.
  const ticketAttachments = ticket.attachments ?? [];
  const statusMeta = STATUS_META[ticket.status] ?? { label: ticket.status, color: colors.textSecondary, bg: colors.neutralBg };
  const priorityMeta = PRIORITY_META[ticket.priority] ?? { label: ticket.priority, color: colors.textSecondary, bg: colors.neutralBg };
  const typeMeta = TYPE_META[ticket.type] ?? { label: ticket.type };
  const baseUrl = getApiBaseUrl();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        style={styles.messageList}
        data={messages}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.messageListContent}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>
              #{ticket.id} {ticket.title}
            </Text>
            <View style={styles.badgeRow}>
              <Badge label={statusMeta.label} color={statusMeta.color} bg={statusMeta.bg} />
              <Badge label={priorityMeta.label} color={priorityMeta.color} bg={priorityMeta.bg} />
              <Badge label={typeMeta.label} color={colors.textSecondary} bg={colors.neutralBg} />
            </View>
            <Text style={styles.meta}>
              {ticket.createdBy?.name ?? "—"} • {ticket.uf} - {ticket.municipality} • {formatDate(ticket.createdAt)}
            </Text>
            {ticket.establishment ? <Text style={styles.meta}>{ticket.establishment}</Text> : null}
            <Text style={styles.description}>{ticket.description}</Text>
            <Text style={styles.meta}>
              Responsável: {ticket.assignedTo?.name ?? "Não atribuído"}
            </Text>

            {ticketAttachments.length > 0 ? (
              <View style={styles.attachmentsBlock}>
                <Text style={styles.attachmentsTitle}>Anexos ({ticketAttachments.length})</Text>
                <View style={styles.attachmentsGrid}>
                  {ticketAttachments.map((att) => {
                    const url = `${baseUrl}/api/tickets/${ticketId}/attachments/${att.id}`;
                    return isImageMime(att.mimeType) ? (
                      <Image
                        key={att.id}
                        source={{ uri: url, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined }}
                        style={styles.attachmentThumb}
                      />
                    ) : (
                      <View key={att.id} style={styles.attachmentFileRow}>
                        <Text style={styles.attachmentLabel}>{"\u{1F4CE}"} {att.filename}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <Text style={styles.sectionLabel}>Mensagens</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.messageBubble}>
            <Text style={styles.messageSender}>{item.sender?.name ?? "Usuário"}</Text>
            {item.message ? <Text style={styles.messageText}>{item.message}</Text> : null}
            {item.attachments?.length
              ? item.attachments.map((att) => (
                  <Text key={att.id} style={styles.attachmentLabel}>
                    {"\u{1F4CE}"} {att.filename}
                  </Text>
                ))
              : null}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>Nenhuma mensagem ainda.</Text>}
      />

      {pendingImage ? (
        <View style={styles.previewRow}>
          <Image source={{ uri: pendingImage.uri }} style={styles.previewImage} />
          <Pressable onPress={() => setPendingImage(null)}>
            <Text style={styles.link}>Remover anexo</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.composer}>
        <Pressable style={styles.attachButton} onPress={pickImage}>
          <Text style={styles.attachButtonText}>Galeria</Text>
        </Pressable>
        <Pressable style={styles.attachButton} onPress={takePhoto}>
          <Text style={styles.attachButtonText}>Câmera</Text>
        </Pressable>
        <TextInput
          style={styles.input}
          placeholder="Escreva uma mensagem..."
          value={text}
          onChangeText={setText}
          multiline
        />
        <Pressable
          style={[styles.sendButton, sending && styles.sendButtonDisabled]}
          onPress={() => void handleSend()}
          disabled={sending}
        >
          {sending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.sendButtonText}>Enviar</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  errorText: { color: colors.textSecondary, textAlign: "center" },
  header: { padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  title: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  meta: { color: colors.textSecondary, fontSize: 12 },
  description: { marginTop: spacing.sm, color: colors.textPrimary },
  attachmentsBlock: { marginTop: spacing.md, gap: spacing.sm },
  attachmentsTitle: { fontWeight: "700", color: colors.textPrimary, fontSize: 13 },
  attachmentsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  attachmentThumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.neutralBg },
  attachmentFileRow: { paddingVertical: spacing.xs },
  sectionLabel: { marginTop: spacing.md, fontWeight: "700", color: colors.textPrimary, fontSize: 13 },
  messageList: { flex: 1, backgroundColor: colors.background },
  messageListContent: { paddingBottom: spacing.lg, gap: spacing.sm },
  messageBubble: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginHorizontal: spacing.lg, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border },
  messageSender: { fontWeight: "700", marginBottom: 2, color: colors.textPrimary },
  messageText: { color: colors.textPrimary },
  attachmentLabel: { marginTop: spacing.xs, color: colors.accent },
  emptyText: { textAlign: "center", color: colors.textSecondary, marginTop: spacing.xxl },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  previewImage: { width: 48, height: 48, borderRadius: radius.sm },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  attachButton: { padding: spacing.sm },
  attachButtonText: { fontSize: 12, color: colors.accent, fontWeight: "600" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxHeight: 100,
    color: colors.textPrimary,
  },
  sendButton: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  sendButtonDisabled: { opacity: 0.6 },
  sendButtonText: { color: "#fff", fontWeight: "600" },
  link: { color: colors.accent, marginTop: spacing.sm },
});
