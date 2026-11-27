import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, customFetch } from "@workspace/api-client-react/custom-fetch";

export type PrivacyDocumentType = "POLITICA_PRIVACIDADE" | "TERMOS_USO";

export type PrivacyDocument = {
  type: PrivacyDocumentType;
  slug: string;
  title: string;
  version: number;
  effectiveDate: string;
  requiresAcknowledgement: boolean;
  legallyValidated: boolean;
  hash: string;
  content: string;
};

export type PrivacyContacts = { controller: string | null; dpoName: string | null; dpoEmail: string | null };

export type PrivacyMe = {
  pending: Array<{ type: PrivacyDocumentType; title: string; version: number; slug: string }>;
  acceptances: Array<{ documentType: PrivacyDocumentType; version: number; kind: "ACEITE_CADASTRO" | "CIENCIA"; createdAt: string }>;
};

export type PrivacyRequest = {
  id: number;
  protocol: string;
  type: string;
  typeLabel: string;
  description: string;
  status: "ABERTA" | "EM_ANALISE" | "CONCLUIDA" | "INDEFERIDA";
  response: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  user?: { id: number; name: string; email: string } | null;
  resolvedByName?: string | null;
};

export const PRIVACY_REQUEST_TYPES: Record<string, string> = {
  CONFIRMACAO: "Confirmação de que meus dados são tratados",
  ACESSO: "Acesso aos meus dados",
  CORRECAO: "Correção de dados incompletos, inexatos ou desatualizados",
  ANONIMIZACAO_BLOQUEIO_ELIMINACAO: "Anonimização, bloqueio ou eliminação de dados",
  PORTABILIDADE: "Portabilidade dos dados",
  INFORMACAO_COMPARTILHAMENTO: "Informação sobre compartilhamento",
  REVISAO_DECISAO: "Revisão de decisão",
  OPOSICAO: "Oposição a um tratamento",
  INCIDENTE: "Comunicar suspeita de incidente de segurança",
  OUTRO: "Outro assunto de privacidade",
};

export const PRIVACY_STATUS_LABELS: Record<PrivacyRequest["status"], string> = {
  ABERTA: "Aberta",
  EM_ANALISE: "Em análise",
  CONCLUIDA: "Concluída",
  INDEFERIDA: "Indeferida",
};

export const DOCUMENT_PATHS: Record<PrivacyDocumentType, string> = {
  POLITICA_PRIVACIDADE: "/politica-de-privacidade",
  TERMOS_USO: "/termos-de-uso",
};

export function privacyErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const detail = (err.data as { error?: unknown } | null)?.error;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}

/** Troca os marcadores do texto pelos contatos configurados (ou "a definir"). */
export function fillPrivacyPlaceholders(content: string, contacts: PrivacyContacts | undefined): string {
  const undefinedText = "[A DEFINIR]";
  return content
    .replace(/\{\{controlador\}\}/g, contacts?.controller ?? undefinedText)
    .replace(/\{\{encarregado\}\}/g, contacts?.dpoName ?? undefinedText)
    .replace(/\{\{contato\}\}/g, contacts?.dpoEmail ?? undefinedText);
}

export function usePrivacyDocuments() {
  return useQuery({
    queryKey: ["privacy-documents"],
    queryFn: ({ signal }) =>
      customFetch<{ documents: PrivacyDocument[]; contacts: PrivacyContacts }>("/api/privacy/documents", { signal }),
    staleTime: 10 * 60_000,
  });
}

export function usePrivacyMe(enabled: boolean) {
  return useQuery({
    queryKey: ["privacy-me"],
    queryFn: ({ signal }) => customFetch<PrivacyMe>("/api/privacy/me", { signal }),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useAcknowledgePrivacy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docs: Array<Pick<PrivacyDocument, "type" | "version" | "hash">>) =>
      customFetch<{ ok: boolean }>("/api/privacy/me/acknowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents: docs }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["privacy-me"] }),
  });
}

export function useMyPrivacyRequests(enabled = true) {
  return useQuery({
    queryKey: ["privacy-my-requests"],
    queryFn: ({ signal }) => customFetch<PrivacyRequest[]>("/api/privacy/me/requests", { signal }),
    enabled,
  });
}

export function useCreatePrivacyRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { type: string; description: string }) =>
      customFetch<PrivacyRequest>("/api/privacy/me/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["privacy-my-requests"] }),
  });
}

export function useAdminPrivacyRequests(enabled: boolean) {
  return useQuery({
    queryKey: ["privacy-admin-requests"],
    queryFn: ({ signal }) => customFetch<PrivacyRequest[]>("/api/privacy/requests", { signal }),
    enabled,
  });
}

export function useUpdatePrivacyRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: number; status: PrivacyRequest["status"]; response: string }) =>
      customFetch<PrivacyRequest>(`/api/privacy/requests/${args.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: args.status, response: args.response }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["privacy-admin-requests"] }),
  });
}

/** Baixa a cópia dos dados do titular (JSON gerado pelo servidor). */
export async function downloadMyData(): Promise<void> {
  const blob = await customFetch<Blob>("/api/privacy/me/export", { responseType: "blob", timeoutMs: 60_000 });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `meus-dados-suporteti-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
