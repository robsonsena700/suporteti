import { useCallback, useEffect, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { 
  useGetTicket, 
  useUpdateTicket, 
  useListMessages,
  useCreateMessage,
  useGetTicketRating,
  useRateTicket,
  useListUsers,
  useAssignTicket,
  getGetTicketQueryKey,
  getListMessagesQueryKey,
  getGetTicketRatingQueryKey,
  TicketStatus,
  TicketType,
  TicketPriority,
  UserRole
} from "@workspace/api-client-react";
import { StatusBadge, PriorityBadge, TypeBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Send, Star, UserCircle2, FileText, Paperclip, Download, Eye, Pencil, Save, X } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { MunicipalityCombobox } from "@/components/forms/municipality-combobox";
import { UFS, fetchMunicipalitiesByUf, getCachedMunicipalities } from "@/lib/municipalities";
import { getRoleLabel } from "@/lib/role-labels";

const TICKET_DETAIL_STATE_KEY = "suporte-ti:ticket:detail:state:v1";

type TicketDetailPersistedState = {
  actorUserId: number;
  ticketId: number;
  scrollY: number | null;
  focusedMessageId: number | null;
  draftMessage: string;
  selectedAssigneeId: string;
  assignReason: string;
  previewAttachmentId: number | null;
  savedAt: number;
};

function loadTicketDetailState(actorUserId: number | null | undefined): TicketDetailPersistedState | null {
  if (typeof window === "undefined") return null;
  if (!actorUserId) return null;
  try {
    const raw = window.localStorage.getItem(TICKET_DETAIL_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TicketDetailPersistedState;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.actorUserId !== actorUserId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveTicketDetailState(next: TicketDetailPersistedState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TICKET_DETAIL_STATE_KEY, JSON.stringify(next));
  } catch {
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Attachment {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

type AuditUserRef = { id: number; name: string; email: string; role: string } | null;
type TicketAuditLog = {
  id: number;
  ticketId: number;
  type: string;
  createdAt: string;
  detail: string | null;
  actor: AuditUserRef;
  fromAssignedTo: AuditUserRef;
  toAssignedTo: AuditUserRef;
};

type AssignableUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  assignedOpenTickets: number;
};

export default function TicketDetail() {
  const [, params] = useRoute("/chamados/:id");
  const ticketId = Number(params?.id);
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManageRole = user?.role === UserRole.ADMIN || user?.role === UserRole.ANALYST || user?.role === UserRole.COORDINATOR;
  
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAtt, setPreviewAtt] = useState<Attachment | null>(null);
  const [textPreview, setTextPreview] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [auditLogs, setAuditLogs] = useState<TicketAuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [assignReason, setAssignReason] = useState("");
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>("");
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [detailsType, setDetailsType] = useState<TicketType>("SOFTWARE");
  const [detailsPriority, setDetailsPriority] = useState<TicketPriority>(TicketPriority.MEDIUM);
  const [detailsUf, setDetailsUf] = useState<string>("");
  const [detailsMunicipality, setDetailsMunicipality] = useState<string>("");
  const [detailsEstablishment, setDetailsEstablishment] = useState<string>("");
  const [detailsHardwareSubtype, setDetailsHardwareSubtype] = useState<string>("");
  const [municipalityOptions, setMunicipalityOptions] = useState<string[]>([]);
  const [isLoadingMunicipalities, setIsLoadingMunicipalities] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [focusedMessageId, setFocusedMessageId] = useState<number | null>(null);
  const pendingRestoreRef = useRef<TicketDetailPersistedState | null>(null);
  const pendingPreviewAttachmentIdRef = useRef<number | null>(null);
  const restoreInFlightRef = useRef<boolean>(false);

  useEffect(() => {
    if (previewOpen) return;
    setPreviewAtt(null);
    setTextPreview("");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl("");
    }
  }, [previewOpen, previewUrl]);

  useEffect(() => {
    if (!Number.isFinite(ticketId) || ticketId <= 0) return;
    if (!canManageRole) return;
    let cancelled = false;
    setAuditLoading(true);
    setAuditError(null);
    customFetch<TicketAuditLog[]>(`/api/tickets/${ticketId}/audit`)
      .then((data) => {
        if (cancelled) return;
        setAuditLogs(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (cancelled) return;
        setAuditError("Não foi possível carregar a auditoria.");
        setAuditLogs([]);
      })
      .finally(() => {
        if (cancelled) return;
        setAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, canManageRole]);

  useEffect(() => {
    if (!canManageRole) return;
    let cancelled = false;
    customFetch<AssignableUser[]>("/api/users/assignable")
      .then((data) => {
        if (cancelled) return;
        setAssignableUsers(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (cancelled) return;
        setAssignableUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canManageRole]);

  const {
    data: ticket,
    isLoading,
    isError,
    error,
  } = useGetTicket(ticketId, {
    query: {
      enabled: Number.isFinite(ticketId) && ticketId > 0,
      queryKey: getGetTicketQueryKey(ticketId),
    }
  });

  const { data: messages } = useListMessages(ticketId, {
    query: {
      enabled: !!ticketId,
      queryKey: getListMessagesQueryKey(ticketId),
    }
  });

  const { data: ratingData } = useGetTicketRating(ticketId, {
    query: {
      enabled: !!ticketId && ticket?.status === TicketStatus.RESOLVED,
      queryKey: getGetTicketRatingQueryKey(ticketId),
    }
  });

  const updateMutation = useUpdateTicket();
  const messageMutation = useCreateMessage();
  const rateMutation = useRateTicket();
  const assignMutation = useAssignTicket();
  const restoreLoopStartedRef = useRef<boolean>(false);

  const attachmentApiUrl = useCallback((att: Attachment) => `/api/tickets/${ticketId}/attachments/${att.id}`, [ticketId]);

  const fetchAttachmentBlob = useCallback(async (att: Attachment) => {
    const resp = await fetch(attachmentApiUrl(att), {
      headers: { Authorization: `Bearer ${localStorage.getItem("ti_support_token")}` },
    });
    if (!resp.ok) throw new Error("Falha ao baixar anexo");
    return resp.blob();
  }, [attachmentApiUrl]);

  const downloadAttachment = useCallback(async (att: Attachment) => {
    try {
      const blob = await fetchAttachmentBlob(att);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = att.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({
        title: "Erro ao baixar anexo",
        description: "Tente novamente em instantes.",
        variant: "destructive",
      });
    }
  }, [fetchAttachmentBlob, toast]);

  const openPreview = useCallback(async (att: Attachment) => {
    setPreviewAtt(att);
    setTextPreview("");
    setPreviewOpen(true);
    try {
      if (att.mimeType === "text/plain") {
        const resp = await fetch(attachmentApiUrl(att), {
          headers: { Authorization: `Bearer ${localStorage.getItem("ti_support_token")}` },
        });
        setTextPreview(resp.ok ? await resp.text() : "Não foi possível carregar a prévia do arquivo.");
        return;
      }

      if (att.mimeType.startsWith("image/") || att.mimeType === "application/pdf") {
        const blob = await fetchAttachmentBlob(att);
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      }
    } catch {
      setTextPreview("Não foi possível carregar a prévia do arquivo.");
    }
  }, [attachmentApiUrl, fetchAttachmentBlob]);

  useEffect(() => {
    if (!ticket) return;
    if (isEditingDetails) return;
    setDetailsType(ticket.type);
    setDetailsPriority(ticket.priority);
    setDetailsUf(ticket.uf);
    setDetailsMunicipality(ticket.municipality);
    setDetailsEstablishment(ticket.establishment ?? "");
    setDetailsHardwareSubtype((ticket as any).hardwareSubtype ?? "");
  }, [ticket, isEditingDetails]);

  useEffect(() => {
    if (!ticket) return;
    if (!isEditingDetails) return;
    setDetailsType(ticket.type);
    setDetailsPriority(ticket.priority);
    setDetailsUf(ticket.uf);
    setDetailsMunicipality(ticket.municipality);
    setDetailsEstablishment(ticket.establishment ?? "");
    setDetailsHardwareSubtype((ticket as any).hardwareSubtype ?? "");
    setSelectedAssigneeId(ticket.assignedToId ? String(ticket.assignedToId) : "");
    setAssignReason("");
  }, [isEditingDetails, ticket]);

  useEffect(() => {
    if (!isEditingDetails) return;
    const uf = detailsUf.trim().toUpperCase();
    if (!uf) {
      setMunicipalityOptions([]);
      setDetailsMunicipality("");
      return;
    }

    const cached = getCachedMunicipalities(uf);
    if (cached.length > 0) {
      setMunicipalityOptions(cached);
      if (detailsMunicipality && !cached.includes(detailsMunicipality)) {
        setDetailsMunicipality("");
      }
    }

    if (typeof navigator !== "undefined" && !navigator.onLine && cached.length > 0) {
      return;
    }

    let cancelled = false;
    setIsLoadingMunicipalities(true);
    fetchMunicipalitiesByUf(uf)
      .then((data) => {
        if (cancelled) return;
        setMunicipalityOptions(data);
        if (detailsMunicipality && !data.includes(detailsMunicipality)) {
          setDetailsMunicipality("");
        }
      })
      .catch(() => {
        if (cancelled) return;
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingMunicipalities(false);
      });
    return () => { cancelled = true; };
  }, [isEditingDetails, detailsUf, detailsMunicipality]);

  const buildPersistedState = useCallback((): TicketDetailPersistedState | null => {
    if (!user) return null;
    return {
      actorUserId: user.id,
      ticketId,
      scrollY: typeof window !== "undefined" ? window.scrollY : null,
      focusedMessageId,
      draftMessage: message,
      selectedAssigneeId,
      assignReason,
      previewAttachmentId: previewOpen && previewAtt ? previewAtt.id : null,
      savedAt: Date.now(),
    };
  }, [user, ticketId, focusedMessageId, message, selectedAssigneeId, assignReason, previewOpen, previewAtt]);

  const saveNow = useCallback(() => {
    const next = buildPersistedState();
    if (!next) return;
    saveTicketDetailState(next);
  }, [buildPersistedState]);

  const applyPersisted = useCallback((next: TicketDetailPersistedState | null) => {
    if (!next) return;
    if (next.ticketId !== ticketId) return;
    setMessage(next.draftMessage || "");
    setSelectedAssigneeId(next.selectedAssigneeId || "");
    setAssignReason(next.assignReason || "");
    setFocusedMessageId(next.focusedMessageId ?? null);
    pendingRestoreRef.current = next;
    pendingPreviewAttachmentIdRef.current = next.previewAttachmentId ?? null;
    restoreInFlightRef.current = true;
    restoreLoopStartedRef.current = false;
  }, [ticketId]);

  const attemptRestoreUi = useCallback(() => {
    if (restoreLoopStartedRef.current) return;
    if (!restoreInFlightRef.current) return;
    const initial = pendingRestoreRef.current;
    if (!initial) return;

    restoreLoopStartedRef.current = true;
    const start = performance.now();
    const run = () => {
      const state = pendingRestoreRef.current;
      if (!state) {
        restoreInFlightRef.current = false;
        restoreLoopStartedRef.current = false;
        return;
      }

      if (state.scrollY != null) {
        window.scrollTo({ top: state.scrollY, behavior: "auto" });
      }

      let focusDone = true;
      if (state.focusedMessageId) {
        const el = document.getElementById(`ticket_msg_${state.focusedMessageId}`);
        if (el) {
          el.scrollIntoView({ behavior: "auto", block: "center" });
          setFocusedMessageId(state.focusedMessageId);
        } else {
          focusDone = false;
        }
      }

      const elapsed = performance.now() - start;
      const scrollDone = state.scrollY == null || Math.abs(window.scrollY - state.scrollY) <= 2;
      if ((scrollDone && focusDone) || elapsed >= 500) {
        restoreInFlightRef.current = false;
        restoreLoopStartedRef.current = false;
        return;
      }
      requestAnimationFrame(run);
    };

    requestAnimationFrame(run);
  }, []);

  useEffect(() => {
    if (!user) return;
    const state = loadTicketDetailState(user.id);
    if (!state) return;
    applyPersisted(state);
  }, [user, applyPersisted]);

  useEffect(() => {
    if (!restoreInFlightRef.current) return;
    if (!ticket) return;
    attemptRestoreUi();
  }, [ticket, messages, attemptRestoreUi]);

  useEffect(() => {
    if (!ticket) return;
    const attId = pendingPreviewAttachmentIdRef.current;
    if (!attId) return;
    const attachments = ((ticket as any).attachments ?? []) as Attachment[];
    const att = attachments.find((a) => a.id === attId);
    if (!att) return;
    pendingPreviewAttachmentIdRef.current = null;
    openPreview(att);
  }, [ticket, openPreview]);

  useEffect(() => {
    if (!user) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        saveNow();
        return;
      }
      if (document.visibilityState !== "visible") return;
      const state = loadTicketDetailState(user.id);
      if (!state) return;
      applyPersisted(state);
    };
    window.addEventListener("beforeunload", saveNow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", saveNow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user, saveNow, applyPersisted]);

  useEffect(() => {
    if (!user) return;
    const id = setTimeout(() => saveNow(), 200);
    return () => clearTimeout(id);
  }, [user, ticketId, message, selectedAssigneeId, assignReason, focusedMessageId, previewOpen, previewAtt, saveNow]);

  const handleUpdateStatus = (status: TicketStatus) => {
    updateMutation.mutate(
      { id: ticketId, data: { status } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetTicketQueryKey(ticketId), data);
          if (canManageRole) {
            customFetch<TicketAuditLog[]>(`/api/tickets/${ticketId}/audit`)
              .then((rows) => setAuditLogs(Array.isArray(rows) ? rows : []))
              .catch(() => null);
          }
          toast({ title: "Status atualizado com sucesso" });
        }
      }
    );
  };

  const handleSendMessage = () => {
    if (!message.trim()) return;
    messageMutation.mutate(
      { ticketId, data: { message: message.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(ticketId) });
          queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(ticketId) });
          if (canManageRole) {
            customFetch<TicketAuditLog[]>(`/api/tickets/${ticketId}/audit`)
              .then((data) => setAuditLogs(Array.isArray(data) ? data : []))
              .catch(() => null);
          }
          setMessage("");
        }
      }
    );
  };

  const handleRate = () => {
    if (!rating) return;
    rateMutation.mutate(
      { ticketId, data: { score: rating, feedback } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTicketRatingQueryKey(ticketId) });
          toast({ title: "Avaliação enviada com sucesso!" });
        }
      }
    );
  };

  const handleAssignToMe = () => {
    if (!user) return;
    assignMutation.mutate(
      { id: ticketId, data: { assignedToId: user.id, reason: "Atribuição manual para o próprio usuário" } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetTicketQueryKey(ticketId), data);
          if (canManageRole) {
            customFetch<TicketAuditLog[]>(`/api/tickets/${ticketId}/audit`)
              .then((rows) => setAuditLogs(Array.isArray(rows) ? rows : []))
              .catch(() => null);
          }
          toast({ title: "Chamado atribuído a você" });
        }
      }
    );
  };

  const handleReassign = () => {
    const assigneeId = Number(selectedAssigneeId);
    if (!Number.isInteger(assigneeId) || assigneeId <= 0) {
      toast({ title: "Selecione o novo responsável", variant: "destructive" });
      return;
    }
    if (assignReason.trim().length < 3) {
      toast({ title: "Informe o motivo da reatribuição (mínimo 3 caracteres)", variant: "destructive" });
      return;
    }

    assignMutation.mutate(
      { id: ticketId, data: { assignedToId: assigneeId, reason: assignReason.trim() } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetTicketQueryKey(ticketId), data);
          queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(ticketId) });
          if (canManageRole) {
            customFetch<TicketAuditLog[]>(`/api/tickets/${ticketId}/audit`)
              .then((rows) => setAuditLogs(Array.isArray(rows) ? rows : []))
              .catch(() => null);
          }
          setAssignReason("");
          setSelectedAssigneeId("");
          toast({ title: "Responsável substituído com sucesso" });
        },
        onError: (error: any) => {
          toast({
            title: "Falha ao reatribuir",
            description: error?.data?.error || "Não foi possível concluir a reatribuição.",
            variant: "destructive",
          });
        },
      },
    );
  };

  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/chamados">
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Chamado inválido</h1>
            <p className="text-muted-foreground text-sm mt-1">O ID do chamado não é válido.</p>
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    const message = (error as any)?.message || "Não foi possível carregar o chamado.";
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/chamados">
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">Erro ao carregar chamado</h1>
            <p className="text-muted-foreground text-sm mt-1">{message}</p>
          </div>
        </div>
        <Card>
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm">
              Possíveis causas: API fora do ar, falta de permissão, ou banco desatualizado (migrations pendentes).
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href="/chamados">Voltar</Link>
              </Button>
              <Button
                type="button"
                onClick={() => queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(ticketId) })}
              >
                Tentar novamente
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !ticket) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const canManage = canManageRole;
  const isCreator = ticket.createdById === user?.id;
  const isAdminOrAnalyst = user?.role === UserRole.ADMIN || user?.role === UserRole.ANALYST;
  const closedAt = new Date(ticket.updatedAt).getTime();
  const withinReopenWindow = Number.isFinite(closedAt) && (Date.now() - closedAt) <= 24 * 60 * 60 * 1000;
  const canReopenClosed = ticket.status !== TicketStatus.CLOSED || (isAdminOrAnalyst && withinReopenWindow);
  const canInteractTicket = ticket.createdById === user?.id || ticket.assignedToId === user?.id;
  const canAssignTicket = canManageRole && (ticket.assignedToId == null || ticket.assignedToId === user?.id);

  const handleSaveDetails = async () => {
    if (savingDetails) return;
    if (!detailsUf) {
      toast({ title: "Selecione a UF", variant: "destructive" });
      return;
    }
    if (!detailsMunicipality) {
      toast({ title: "Selecione o município", variant: "destructive" });
      return;
    }

    const nextAssigneeId = selectedAssigneeId ? Number(selectedAssigneeId) : null;
    const currentAssigneeId = ticket.assignedToId ?? null;

    if (isEditingDetails && canAssignTicket && nextAssigneeId !== currentAssigneeId) {
      if (!nextAssigneeId || !Number.isInteger(nextAssigneeId)) {
        toast({ title: "Selecione o responsável", variant: "destructive" });
        return;
      }
      if (assignReason.trim().length < 3) {
        toast({ title: "Informe o motivo da alteração do responsável (mínimo 3 caracteres)", variant: "destructive" });
        return;
      }
    }

    setSavingDetails(true);
    try {
      if (canAssignTicket && nextAssigneeId !== currentAssigneeId && nextAssigneeId) {
        await new Promise<void>((resolve, reject) => {
          assignMutation.mutate(
            { id: ticketId, data: { assignedToId: nextAssigneeId, reason: assignReason.trim() } },
            {
              onSuccess: (data) => {
                queryClient.setQueryData(getGetTicketQueryKey(ticketId), data);
                resolve();
              },
              onError: (err) => reject(err),
            },
          );
        });
      }

      const updated = await customFetch<any>(`/api/tickets/${ticketId}/details`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: detailsType,
          priority: detailsPriority,
          uf: detailsUf,
          municipality: detailsMunicipality,
          establishment: detailsEstablishment || null,
          hardwareSubtype: detailsType === "HARDWARE" ? (detailsHardwareSubtype || null) : null,
        }),
      });
      queryClient.setQueryData(getGetTicketQueryKey(ticketId), updated);
      if (canManageRole) {
        const rows = await customFetch<TicketAuditLog[]>(`/api/tickets/${ticketId}/audit`);
        setAuditLogs(Array.isArray(rows) ? rows : []);
      }
      toast({ title: "Detalhes atualizados com sucesso" });
      setIsEditingDetails(false);
    } catch (e: any) {
      toast({
        title: "Falha ao atualizar detalhes",
        description: e?.data?.error || e?.message || "Não foi possível salvar as alterações.",
        variant: "destructive",
      });
    } finally {
      setSavingDetails(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/chamados">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">#{ticket.id} - {ticket.title}</h1>
            <StatusBadge status={ticket.status} />
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Aberto por {ticket.createdBy.name} em {format(new Date(ticket.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            {!ticket.assignedToId && ticket.status !== TicketStatus.CLOSED && (
               <Button variant="secondary" onClick={handleAssignToMe} disabled={assignMutation.isPending}>
                 Atribuir a mim
               </Button>
            )}
            {canInteractTicket ? (
              <Select value={ticket.status} onValueChange={(v) => handleUpdateStatus(v as TicketStatus)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Atualizar status" />
                </SelectTrigger>
                <SelectContent>
                  {canReopenClosed ? <SelectItem value={TicketStatus.OPEN}>Aberto</SelectItem> : null}
                  {canReopenClosed ? <SelectItem value={TicketStatus.IN_PROGRESS}>Em Andamento</SelectItem> : null}
                  {canReopenClosed ? <SelectItem value={TicketStatus.RESOLVED}>Resolvido</SelectItem> : null}
                  <SelectItem value={TicketStatus.CLOSED}>Fechado</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
          </div>
        )}
      </div>
      {ticket.status === TicketStatus.CLOSED && !canReopenClosed && canManage ? (
        <p className="text-xs text-muted-foreground">
          Reabertura permitida apenas para Admin/Analista em até 24h após o fechamento.
        </p>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Descrição do Problema</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm">{ticket.description}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Interações</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {messages?.length ? (
                <div className="space-y-4">
                  {messages.map((msg) => {
                    const isMe = msg.senderId === user?.id;
                    return (
                      <div
                        key={msg.id}
                        id={`ticket_msg_${msg.id}`}
                        className={cn("flex gap-3", isMe ? "flex-row-reverse" : "flex-row")}
                        onClick={() => setFocusedMessageId(msg.id)}
                      >
                        <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                          <UserCircle2 className="w-5 h-5 text-secondary-foreground" />
                        </div>
                        <div className={cn("flex flex-col max-w-[80%]", isMe ? "items-end" : "items-start")}>
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="text-xs font-medium">{isMe ? "Você" : msg.sender.name}</span>
                            <span className="text-[10px] text-muted-foreground">{format(new Date(msg.createdAt), "dd/MM HH:mm")}</span>
                          </div>
                          <div className={cn(
                            "px-4 py-2 rounded-2xl text-sm whitespace-pre-wrap",
                            focusedMessageId === msg.id ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-background" : null,
                            isMe ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm"
                          )}>
                            {msg.message}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  Nenhuma mensagem registrada.
                </div>
              )}

              {!canInteractTicket ? (
                <p className="text-xs text-muted-foreground">
                  Apenas o criador do ticket e o responsável atual podem enviar mensagens. Você pode visualizar este chamado.
                </p>
              ) : null}

              {ticket.status !== TicketStatus.CLOSED && canInteractTicket ? (
                <div className="mt-4 pt-4 border-t flex gap-2">
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Digite sua mensagem..."
                    className="min-h-[80px] resize-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                  />
                  <Button 
                    className="self-end" 
                    size="icon"
                    onClick={handleSendMessage}
                    disabled={!message.trim() || messageMutation.isPending}
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg">Detalhes</CardTitle>
              {canManageRole ? (
                <div className="flex items-center gap-2">
                  {!isEditingDetails ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsEditingDetails(true)}>
                      <Pencil className="mr-2 size-4" />
                      Editar
                    </Button>
                  ) : (
                    <>
                      <Button type="button" variant="outline" size="sm" onClick={() => setIsEditingDetails(false)} disabled={savingDetails}>
                        <X className="mr-2 size-4" />
                        Cancelar
                      </Button>
                      <Button type="button" size="sm" onClick={handleSaveDetails} disabled={savingDetails}>
                        <Save className="mr-2 size-4" />
                        Salvar
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <span className="text-muted-foreground block mb-1">Tipo</span>
                {!isEditingDetails ? (
                  <TypeBadge type={ticket.type} />
                ) : (
                  <Select value={detailsType} onValueChange={(v) => setDetailsType(v as TicketType)} disabled={savingDetails}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SOFTWARE">Software</SelectItem>
                      <SelectItem value="HARDWARE">Hardware</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              {!isEditingDetails && (ticket as any).hardwareSubtype ? (
                <div>
                  <span className="text-muted-foreground block mb-1">Subcategoria</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                    {(ticket as any).hardwareSubtype}
                  </span>
                </div>
              ) : null}

              {isEditingDetails && detailsType === "HARDWARE" ? (
                <div>
                  <span className="text-muted-foreground block mb-1">Subcategoria</span>
                  <Input
                    value={detailsHardwareSubtype}
                    onChange={(e) => setDetailsHardwareSubtype(e.target.value)}
                    placeholder="Ex: Impressora, Notebook..."
                    disabled={savingDetails}
                  />
                </div>
              ) : null}

              <div>
                <span className="text-muted-foreground block mb-1">Prioridade</span>
                {!isEditingDetails ? (
                  <PriorityBadge priority={ticket.priority} />
                ) : (
                  <Select value={detailsPriority} onValueChange={(v) => setDetailsPriority(v as TicketPriority)} disabled={savingDetails}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LOW">Baixa</SelectItem>
                      <SelectItem value="MEDIUM">Média</SelectItem>
                      <SelectItem value="HIGH">Alta</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div>
                <span className="text-muted-foreground block mb-1">Localidade</span>
                {!isEditingDetails ? (
                  <p className="font-medium">{ticket.municipality} - {ticket.uf}</p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Select value={detailsUf} onValueChange={(v) => setDetailsUf(v)} disabled={savingDetails}>
                      <SelectTrigger>
                        <SelectValue placeholder="UF" />
                      </SelectTrigger>
                      <SelectContent>
                        {UFS.map((uf) => (
                          <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <MunicipalityCombobox
                      uf={detailsUf}
                      value={detailsMunicipality}
                      options={municipalityOptions}
                      loading={isLoadingMunicipalities}
                      disabled={savingDetails || !detailsUf}
                      onChange={setDetailsMunicipality}
                    />
                  </div>
                )}
              </div>

              <div>
                <span className="text-muted-foreground block mb-1">Estabelecimento / Unidade</span>
                {!isEditingDetails ? (
                  <p className="font-medium">{ticket.establishment || "Não informado"}</p>
                ) : (
                  <Input
                    value={detailsEstablishment}
                    onChange={(e) => setDetailsEstablishment(e.target.value)}
                    placeholder="Ex: Hospital Municipal..."
                    disabled={savingDetails}
                  />
                )}
              </div>

              <div>
                <span className="text-muted-foreground block mb-1">Responsável</span>
                {!isEditingDetails ? (
                  <p className="font-medium">{ticket.assignedTo ? ticket.assignedTo.name : "Não atribuído"}</p>
                ) : (
                  <div className="space-y-2">
                    <Select value={selectedAssigneeId} onValueChange={setSelectedAssigneeId} disabled={savingDetails || !canAssignTicket}>
                      <SelectTrigger>
                        <SelectValue placeholder={canAssignTicket ? "Selecione o usuário" : "Sem permissão"} />
                      </SelectTrigger>
                      <SelectContent>
                        {assignableUsers.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.name} • {getRoleLabel(u.role)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {canAssignTicket ? (
                      <div>
                        <Textarea
                          value={assignReason}
                          onChange={(e) => setAssignReason(e.target.value.slice(0, 500))}
                          placeholder="Motivo da alteração do responsável"
                          rows={3}
                          disabled={savingDetails}
                        />
                        <p className="text-xs text-muted-foreground text-right">{assignReason.length}/500</p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Para alterar o responsável, o chamado precisa estar sem responsável ou atribuído a você.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {canAssignTicket ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Substituir Atribuição</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border p-3 text-sm">
                  <p className="text-xs text-muted-foreground">Ticket</p>
                  <p className="font-medium">#{ticket.id} — {ticket.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Responsável atual: {ticket.assignedTo?.name ?? "Não atribuído"}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Novo responsável</label>
                  <Select value={selectedAssigneeId} onValueChange={setSelectedAssigneeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o usuário" />
                    </SelectTrigger>
                    <SelectContent>
                      {assignableUsers.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.name} • {u.role} • {u.assignedOpenTickets} em aberto
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Motivo da reatribuição</label>
                  <Textarea
                    value={assignReason}
                    onChange={(e) => setAssignReason(e.target.value)}
                    placeholder="Descreva o motivo da reatribuição"
                    maxLength={500}
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground text-right">{assignReason.length}/500</p>
                </div>
                <Button
                  type="button"
                  onClick={handleReassign}
                  disabled={assignMutation.isPending || ticket.status === TicketStatus.CLOSED}
                  className="w-full"
                >
                  {assignMutation.isPending ? "Salvando..." : "Confirmar substituição"}
                </Button>
                {ticket.status === TicketStatus.CLOSED ? (
                  <p className="text-xs text-muted-foreground">Tickets fechados não podem ser reatribuídos.</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}


          {/* Attachments */}
          {((ticket as any).attachments?.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Paperclip className="h-4 w-4" />
                  Anexos ({(ticket as any).attachments.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(ticket as any).attachments.map((att: Attachment) => (
                  <div
                    key={att.id}
                    className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3 hover:bg-muted/60 transition-colors group"
                  >
                    <div className="h-10 w-10 rounded bg-primary/10 flex items-center justify-center shrink-0">
                      {att.mimeType.startsWith("image/")
                        ? <span className="text-lg">🖼️</span>
                        : att.mimeType === "application/pdf"
                        ? <FileText className="h-5 w-5 text-red-500" />
                        : <Paperclip className="h-5 w-5 text-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{att.filename}</p>
                      <p className="text-xs text-muted-foreground">{formatBytes(att.size)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button type="button" variant="outline" size="icon" onClick={() => openPreview(att)} aria-label="Visualizar anexo">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <button
                        type="button"
                        onClick={() => downloadAttachment(att)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background shadow-sm hover:bg-muted/50 tap-target"
                        aria-label="Baixar anexo"
                      >
                        <Download className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                      </button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Auditoria</CardTitle>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="audit" className="border-b-0">
                    <AccordionTrigger className="py-2 hover:no-underline">
                      <div className="text-left">
                        <p className="text-sm font-semibold">Histórico de interações e mudanças</p>
                        <p className="text-xs text-muted-foreground">Mensagens, atribuições e reatribuições</p>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-2">
                      {auditLoading ? (
                        <div className="flex justify-center py-6">
                          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
                        </div>
                      ) : auditError ? (
                        <p className="text-sm text-muted-foreground">{auditError}</p>
                      ) : auditLogs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum registro de auditoria.</p>
                      ) : (
                        <div className="space-y-3">
                          {auditLogs.map((l) => (
                            <div key={l.id} className="rounded-lg border p-3 text-sm">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-medium">{l.type}</p>
                                <p className="text-xs text-muted-foreground">
                                  {format(new Date(l.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                                </p>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                {l.actor ? `${l.actor.name} (${l.actor.role})` : "—"}
                              </p>
                              {l.fromAssignedTo || l.toAssignedTo ? (
                                <p className="text-xs mt-2">
                                  Atribuição: {l.fromAssignedTo ? l.fromAssignedTo.name : "—"} → {l.toAssignedTo ? l.toAssignedTo.name : "—"}
                                </p>
                              ) : null}
                              {l.detail ? (
                                <p className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap break-words">
                                  {l.detail}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            </Card>
          ) : null}

          {ticket.status === TicketStatus.RESOLVED && isCreator && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Avalie o Atendimento</CardTitle>
              </CardHeader>
              <CardContent>
                {ratingData ? (
                  <div className="space-y-2">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star key={s} className={cn("w-5 h-5", s <= ratingData.score ? "fill-amber-400 text-amber-400" : "text-muted")} />
                      ))}
                    </div>
                    {ratingData.feedback && (
                      <p className="text-sm italic text-muted-foreground">"{ratingData.feedback}"</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex gap-2 justify-center">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button
                          key={s}
                          onClick={() => setRating(s)}
                          className="hover:scale-110 transition-transform"
                        >
                          <Star className={cn("w-8 h-8", s <= rating ? "fill-amber-400 text-amber-400" : "text-muted")} />
                        </button>
                      ))}
                    </div>
                    <Textarea 
                      placeholder="Deixe um comentário (opcional)" 
                      className="resize-none text-sm"
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                    />
                    <Button 
                      className="w-full" 
                      onClick={handleRate}
                      disabled={!rating || rateMutation.isPending}
                    >
                      Enviar Avaliação
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl w-[95vw] p-0 overflow-hidden">
          <div className="p-4 border-b">
            <DialogHeader>
              <DialogTitle className="text-base">{previewAtt?.filename ?? "Pré-visualização"}</DialogTitle>
            </DialogHeader>
          </div>
          <div className="bg-muted/20 p-4">
            {previewAtt ? (
              previewAtt.mimeType.startsWith("image/") ? (
                <img
                  src={previewUrl}
                  alt={previewAtt.filename}
                  className="max-h-[70vh] w-full object-contain rounded-md bg-background"
                />
              ) : previewAtt.mimeType === "application/pdf" ? (
                <iframe
                  title={previewAtt.filename}
                  src={previewUrl}
                  className="w-full h-[70vh] rounded-md bg-background"
                />
              ) : previewAtt.mimeType === "text/plain" ? (
                <pre className="whitespace-pre-wrap break-words text-sm rounded-md bg-background p-4 max-h-[70vh] overflow-auto">
                  {textPreview || "Carregando..."}
                </pre>
              ) : (
                <div className="rounded-md bg-background p-4 text-sm">
                  <p className="text-muted-foreground">
                    Pré-visualização não disponível para este tipo de arquivo. Faça o download para abrir no seu dispositivo.
                  </p>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => previewAtt && downloadAttachment(previewAtt)}
                      className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted/50 tap-target"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Baixar arquivo
                    </button>
                  </div>
                </div>
              )
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
