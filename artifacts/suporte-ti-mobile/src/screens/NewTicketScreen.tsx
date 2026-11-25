import React, { useCallback, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useQueryClient } from "@tanstack/react-query";
import {
  TicketPriority,
  TicketType,
  getListTicketsQueryKey,
  useCreateTicket,
} from "@workspace/api-client-react";

import type { NewTicketScreenProps } from "../navigation/RootNavigator";
import { getApiBaseUrl } from "../lib/api-setup";
import { getToken } from "../lib/token-storage";
import { colors, radius, spacing } from "../theme";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { TextField } from "../components/ui/TextField";
import { Button } from "../components/ui/Button";

type TicketTypeValue = (typeof TicketType)[keyof typeof TicketType];
type TicketPriorityValue = (typeof TicketPriority)[keyof typeof TicketPriority];

// O backend só reconhece estes 2 tipos de chamado (SOFTWARE/HARDWARE); não
// existe um 3º tipo "Acesso & Senha" como em alguns mockups de referência.
const TYPE_OPTIONS: { value: TicketTypeValue; label: string }[] = [
  { value: TicketType.SOFTWARE, label: "Sistema" },
  { value: TicketType.HARDWARE, label: "Equipamentos" },
];

const PRIORITY_OPTIONS: { value: TicketPriorityValue; label: string; color: string }[] = [
  { value: TicketPriority.LOW, label: "Baixa", color: colors.success },
  { value: TicketPriority.MEDIUM, label: "Média", color: colors.warning },
  { value: TicketPriority.HIGH, label: "Alta", color: colors.danger },
];

// Mesmo limite do backend (ticket-attachments.ts: MAX_SIZE = 8 * 1024 * 1024,
// upload.array("files", MAX_FILES) com MAX_FILES = 3).
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_FILES = 3;
const UPLOAD_TIMEOUT_MS = 60_000;

// Mesma lista de subtipos de hardware do app web (new-ticket.tsx).
const HARDWARE_SUBTYPES = [
  "Formatação",
  "Recarga",
  "Troca",
  "Aquisição",
  "CPU",
  "Impressora",
  "Memória",
  "Teclado",
  "Mouse",
  "Cabo de rede",
  "Conector",
  "Tablet",
  "TV",
  "Transformador",
  "Cabo HDMI",
  "VGA",
  "USB",
  "DVI",
  "Força",
  "Outro",
];

export default function NewTicketScreen({ navigation }: NewTicketScreenProps) {
  const queryClient = useQueryClient();
  const createMutation = useCreateTicket();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [establishment, setEstablishment] = useState("");
  const [type, setType] = useState<TicketTypeValue>(TicketType.SOFTWARE);
  const [hardwareSubtype, setHardwareSubtype] = useState("");
  const [priority, setPriority] = useState<TicketPriorityValue>(TicketPriority.MEDIUM);
  const [images, setImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Mesma regra de new-ticket.tsx do app web: anexo opcional para chamados
  // do tipo Sistema, obrigatório para os demais (Equipamentos/Hardware).
  const attachmentRequired = type !== TicketType.SOFTWARE;
  const canAddMoreFiles = images.length < MAX_FILES;

  const pickImage = useCallback(async () => {
    if (images.length >= MAX_FILES) {
      Alert.alert("Limite atingido", `Máximo de ${MAX_FILES} arquivos permitidos.`);
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permissão necessária", "Permita o acesso às fotos para anexar uma imagem.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: MAX_FILES - images.length,
    });
    if (!result.canceled && result.assets?.length) {
      const accepted: ImagePicker.ImagePickerAsset[] = [];
      for (const asset of result.assets) {
        if (asset.fileSize && asset.fileSize > MAX_FILE_SIZE) continue;
        accepted.push(asset);
      }
      if (accepted.length < result.assets.length) {
        Alert.alert("Arquivo muito grande", "Algumas imagens passam de 8 MB e foram ignoradas.");
      }
      setImages((prev) => [...prev, ...accepted].slice(0, MAX_FILES));
    }
  }, [images.length]);

  const takePhoto = useCallback(async () => {
    if (images.length >= MAX_FILES) {
      Alert.alert("Limite atingido", `Máximo de ${MAX_FILES} arquivos permitidos.`);
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permissão necessária", "Permita o acesso à câmera para fotografar o anexo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > MAX_FILE_SIZE) {
        Alert.alert("Arquivo muito grande", "Escolha uma imagem de até 8 MB.");
        return;
      }
      setImages((prev) => [...prev, asset].slice(0, MAX_FILES));
    }
  }, [images.length]);

  const uploadAttachments = useCallback(
    async (ticketId: number) => {
      if (images.length === 0) return;
      const token = await getToken();
      const baseUrl = getApiBaseUrl();
      const form = new FormData();
      images.forEach((asset, index) => {
        form.append(
          "files",
          {
            uri: asset.uri,
            name: asset.fileName || `anexo-${Date.now()}-${index}.jpg`,
            type: asset.mimeType || "image/jpeg",
          } as unknown as Blob,
        );
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
      try {
        const resp = await fetch(`${baseUrl}/api/tickets/${ticketId}/attachments`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
          signal: controller.signal,
        });
        if (!resp.ok) {
          const data = await resp.json().catch(() => null);
          throw new Error(data?.error || "Chamado criado, mas os anexos não puderam ser enviados.");
        }
      } finally {
        clearTimeout(timer);
      }
    },
    [images],
  );

  const handleSubmit = useCallback(() => {
    if (!title.trim() || !description.trim() || !establishment.trim()) {
      Alert.alert("Campos obrigatórios", "Preencha título, descrição e estabelecimento.");
      return;
    }
    if (title.trim().length < 5) {
      Alert.alert("Título muito curto", "O título deve ter pelo menos 5 caracteres.");
      return;
    }
    if (description.trim().length < 10) {
      Alert.alert("Descrição muito curta", "A descrição deve ter pelo menos 10 caracteres.");
      return;
    }
    if (attachmentRequired && images.length === 0) {
      Alert.alert("Anexo obrigatório", "Chamados de equipamentos exigem ao menos um anexo.");
      return;
    }

    setSubmitting(true);
    createMutation.mutate(
      {
        data: {
          title: title.trim(),
          description: description.trim(),
          establishment: establishment.trim(),
          type,
          priority,
          ...(type === TicketType.HARDWARE && hardwareSubtype.trim()
            ? { hardwareSubtype: hardwareSubtype.trim() }
            : {}),
        },
      },
      {
        onSuccess: async (ticket) => {
          try {
            await uploadAttachments(ticket.id);
          } catch (err) {
            Alert.alert("Aviso", err instanceof Error ? err.message : "Não foi possível enviar o(s) anexo(s).");
          }
          await queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
          setSubmitting(false);
          navigation.replace("TicketDetail", { ticketId: ticket.id });
        },
        onError: (err) => {
          setSubmitting(false);
          Alert.alert("Não foi possível abrir o chamado", err instanceof Error ? err.message : "Tente novamente.");
        },
      },
    );
  }, [
    title,
    description,
    establishment,
    type,
    hardwareSubtype,
    priority,
    attachmentRequired,
    images,
    createMutation,
    uploadAttachments,
    queryClient,
    navigation,
  ]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Detalhes do chamado</Text>
        <TextField label="Título" placeholder="Resumo do problema" value={title} onChangeText={setTitle} />
        <TextField
          label="Descrição"
          placeholder="Detalhe o que está acontecendo"
          value={description}
          onChangeText={setDescription}
          multiline
          style={styles.textArea}
        />
        <TextField
          label="Estabelecimento"
          placeholder="Unidade / estabelecimento"
          value={establishment}
          onChangeText={setEstablishment}
        />
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Tipo</Text>
        <View style={styles.chipsRow}>
          {TYPE_OPTIONS.map((opt) => (
            <Chip key={opt.value} label={opt.label} selected={type === opt.value} onPress={() => setType(opt.value)} />
          ))}
        </View>
        {type === TicketType.HARDWARE ? (
          <View>
            <Text style={styles.fieldLabel}>Subtipo (opcional)</Text>
            <View style={styles.chipsRow}>
              {HARDWARE_SUBTYPES.map((s) => (
                <Chip key={s} label={s} selected={hardwareSubtype === s} onPress={() => setHardwareSubtype((v) => (v === s ? "" : s))} />
              ))}
            </View>
          </View>
        ) : null}
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Prioridade</Text>
        <View style={styles.chipsRow}>
          {PRIORITY_OPTIONS.map((opt) => (
            <Chip
              key={opt.value}
              label={opt.label}
              selected={priority === opt.value}
              selectedColor={opt.color}
              onPress={() => setPriority(opt.value)}
            />
          ))}
        </View>
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>
          Anexo {attachmentRequired ? "(obrigatório para equipamentos)" : "(opcional para sistema)"}
        </Text>
        {images.length > 0 ? (
          <View style={styles.previewGrid}>
            {images.map((img, index) => (
              <View key={img.assetId ?? `${img.uri}-${index}`} style={styles.previewItem}>
                <Image source={{ uri: img.uri }} style={styles.previewImage} />
                <Text style={styles.removeLink} onPress={() => setImages((prev) => prev.filter((_, i) => i !== index))}>
                  Remover
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <Text style={styles.filesCount}>{images.length}/{MAX_FILES} arquivo(s) anexado(s)</Text>
        {canAddMoreFiles ? (
          <View style={styles.chipsRow}>
            <Pressable style={styles.secondaryButton} onPress={pickImage}>
              <Text style={styles.secondaryButtonText}>Escolher da galeria</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={takePhoto}>
              <Text style={styles.secondaryButtonText}>Tirar foto</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.limitText}>Limite de {MAX_FILES} arquivos atingido.</Text>
        )}
      </Card>

      <Button label="Abrir chamado" onPress={handleSubmit} loading={submitting} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background, paddingBottom: spacing.xxl },
  section: { gap: spacing.md },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  textArea: { minHeight: 90, textAlignVertical: "top" },
  chipsRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  previewImage: { width: 64, height: 64, borderRadius: radius.md },
  removeLink: { color: colors.danger, fontWeight: "600" },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  secondaryButtonText: { color: colors.primary, fontWeight: "600", fontSize: 13 },
  fieldLabel: { color: colors.textSecondary, fontWeight: "600", fontSize: 13, marginBottom: spacing.sm },
  previewGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  previewItem: { alignItems: "center", gap: spacing.xs },
  filesCount: { color: colors.textSecondary, fontSize: 12 },
  limitText: { color: colors.warning, fontSize: 12, fontWeight: "600" },
});
